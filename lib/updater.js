const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

// This edition's own releases (the original's would install over it without the added features).
// Empty: the app has no repository yet — no update check at all.
const REPO = 'skybogli/BEEP-Kenshi-Mod-Manager';
const CURRENT_VERSION = require('../package.json').version;
const AGENT = 'kenshi-mod-manager';

function enabled() {
  return !!REPO;
}

/**
 * Check GitHub releases for a newer version.
 * Returns { hasUpdate, currentVersion, latestVersion, downloadUrl, size, releaseUrl } or null on error
 * ({ disabled: true } when there is no repository).
 */
function checkForUpdate() {
  if (!REPO) return Promise.resolve({ disabled: true, hasUpdate: false, currentVersion: CURRENT_VERSION });
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}/releases/latest`,
      method: 'GET',
      headers: { 'User-Agent': AGENT },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestTag = (release.tag_name || '').replace(/^v/, '');
          const hasUpdate = compareVersions(latestTag, CURRENT_VERSION) > 0;

          // Pick the asset for THIS OS. The old code took the first .zip, but GitHub lists the
          // Linux zip before the Windows one, so every Windows in-app update pulled the Linux build
          // and the auto-extract overwrote the install with Linux binaries (bricking the app).
          // (Windows: a zip named win… / x64…; never one named linux / mac.)
          const assets = (release.assets || []).filter((a) => a.browser_download_url);
          let asset = null;
          if (process.platform === 'win32') {
            const zips = assets.filter((a) => a.name.toLowerCase().endsWith('.zip') && !/linux|mac|darwin/i.test(a.name));
            asset = zips.find((a) => /win/i.test(a.name)) || zips.find((a) => /x64/i.test(a.name)) || null;
          } else if (process.platform === 'linux') {
            asset = assets.find((a) => /linux/i.test(a.name));
          }

          resolve({
            hasUpdate,
            currentVersion: CURRENT_VERSION,
            latestVersion: latestTag,
            downloadUrl: asset ? asset.browser_download_url : null,
            size: asset ? asset.size : 0,
            releaseUrl: release.html_url || `https://github.com/${REPO}/releases/latest`,
            releaseName: release.name || `v${latestTag}`,
            body: release.body || '',
          });
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ===== Download, check, install =====
// A running app keeps its own files open (resources\app.asar), so they can't be replaced in
// place. The update is downloaded (with progress, onProgress({ phase, got, total, attempt })) and
// unpacked into the temp folder while the app runs; then a small PowerShell script waits until
// the app has quit, copies the new files over it, checks them and starts the app again. The
// outcome is written to update-state.json (userData) so the next start knows whether it worked:
// a version that failed to install is not offered again by itself (no restart loop).

const TRIES = 3;
const STALL_MS = 30000;
const EXTRACT_MS = 10 * 60 * 1000;

let current = null; // { cancelled, req, phase } of the update in progress

function cancelUpdate() {
  if (!current || current.phase !== 'download') return false;
  current.cancelled = true;
  try { current.req?.destroy(); } catch { /* gone */ }
  return true;
}

function busy() {
  return current ? current.phase : null;
}

// One attempt: resolves { ok, got, total } / { error, retry } / { cancelled }.
function downloadOnce(url, zipPath, onProgress, attempt) {
  return new Promise((resolve) => {
    const proto = url.startsWith('https') ? https : require('http');
    const req = proto.get(url, { headers: { 'User-Agent': AGENT } }, (res) => {
      // Follow redirects (GitHub sends the file from another host)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadOnce(new URL(res.headers.location, url).toString(), zipPath, onProgress, attempt).then(resolve);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        resolve({ error: `HTTP ${res.statusCode}`, retry: res.statusCode >= 500 });
        return;
      }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      let last = 0;
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; clearTimeout(stall); resolve(r); } };
      const file = fs.createWriteStream(zipPath);
      let stall = setTimeout(() => req.destroy(new Error('the connection stalled')), STALL_MS);
      res.on('data', (chunk) => {
        got += chunk.length;
        clearTimeout(stall);
        stall = setTimeout(() => req.destroy(new Error('the connection stalled')), STALL_MS);
        const now = Date.now();
        if (now - last > 150) { last = now; onProgress({ phase: 'download', got, total, attempt }); }
      });
      res.pipe(file);
      const fail = (err) => { file.destroy(); done(current?.cancelled ? { cancelled: true } : { error: err?.message || 'the connection was lost', retry: true }); };
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('the connection was lost')));
      file.on('error', (err) => done({ error: err.message }));
      file.on('finish', () => {
        onProgress({ phase: 'download', got, total, attempt });
        done({ ok: true, got, total });
      });
    });
    if (current) current.req = req;
    req.on('error', (err) => resolve(current?.cancelled ? { cancelled: true } : { error: err.message, retry: true }));
  });
}

// PowerShell with a script file and arguments (no quoting in a command line).
function scriptFile(name, script) {
  const ps1 = path.join(os.tmpdir(), `${AGENT}-${name}.ps1`);
  fs.writeFileSync(ps1, '﻿' + script, 'utf8');
  return ps1;
}
function powershell(name, script, args, timeout) {
  return new Promise((resolve) => {
    const ps1 = scriptFile(name, script);
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...args], { timeout, windowsHide: true }, (err, stdout, stderr) => {
      try { fs.unlinkSync(ps1); } catch { /* gone */ }
      resolve(err ? { error: (String(stderr).trim() || err.message || '').split('\n').pop().trim() } : { ok: true, out: String(stdout).trim() });
    });
  });
}

// Unpack into the temp folder and print the folder that holds the app (its exe and
// resources\app.asar: the zip may have the build folder inside).
const UNPACK_PS = `
param([string]$zip, [string]$tmp, [string]$exe)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
$hit = Get-ChildItem -LiteralPath $tmp -Recurse -Depth 2 -Filter $exe | Where-Object { Test-Path -LiteralPath (Join-Path $_.DirectoryName 'resources\\app.asar') } | Select-Object -First 1
if (-not $hit) { throw "the update has no $exe with resources\\app.asar" }
$hit.DirectoryName
`;

// After the app has quit: copy the new files over it (a file still in use: try again), check
// app.asar, write the outcome, start the app.
const APPLY_PS = `
param([string]$paramsFile)
$ErrorActionPreference = 'Stop'
$p = Get-Content -LiteralPath $paramsFile -Raw -Encoding UTF8 | ConvertFrom-Json
Remove-Item -LiteralPath $paramsFile -Force -ErrorAction SilentlyContinue
$src = $p.src; $dest = $p.dest; $exe = $p.exe; $state = $p.state; $from = $p.from; $to = $p.to; $tmp = $p.tmp; $zip = $p.zip
$exePath = Join-Path $dest $exe
function Running { @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath }).Count -gt 0 }
$waited = 0
while ((Running) -and $waited -lt 120) { Start-Sleep -Milliseconds 500; $waited += 0.5 }
$ok = $false; $err = ''
for ($i = 1; $i -le 20 -and -not $ok; $i++) {
  try {
    Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force
    $a = Get-Item -LiteralPath (Join-Path $src 'resources\\app.asar')
    $b = Get-Item -LiteralPath (Join-Path $dest 'resources\\app.asar')
    if ($a.Length -ne $b.Length) { throw 'app.asar was not replaced' }
    $ok = $true
  } catch { $err = $_.Exception.Message; Start-Sleep -Seconds 1 }
}
$out = @{ from = $from; to = $to; ok = $ok; error = $err; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
[IO.File]::WriteAllText($state, $out)
# started again as it was started (e.g. its own --user-data-dir)
$list = @($p.argv | Where-Object { $_ })
if ($list.Count) { Start-Process -FilePath $exePath -WorkingDirectory $dest -ArgumentList (($list | ForEach-Object { '"' + ($_ -replace '"', '\\"') + '"' }) -join ' ') }
else { Start-Process -FilePath $exePath -WorkingDirectory $dest }
Start-Sleep -Seconds 2
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
`;

/**
 * Download the update and get it ready (Windows). Returns { success, staged } / { success: false,
 * error } / { success: false, cancelled }. installAfterQuit(staged, …) then installs it once the
 * app quits.
 */
async function prepareUpdate(downloadUrl, onProgress = () => {}) {
  // Safety net: the in-app apply is Windows-only and must NEVER put a non-Windows build over the
  // install. Refuse anything but a Windows zip.
  const fileName = (downloadUrl || '').split('?')[0].split('/').pop().toLowerCase();
  if (process.platform !== 'win32' || !fileName.endsWith('.zip') || /linux|mac|darwin/.test(fileName)) {
    return { success: false, error: 'Automatic install is only supported on Windows. Please download the update manually.' };
  }
  if (current) return { success: false, error: 'An update is already in progress.' };
  current = { cancelled: false, req: null, phase: 'download' };
  const zipPath = path.join(os.tmpdir(), `${AGENT}-update.zip`);
  const tmpDir = path.join(os.tmpdir(), `${AGENT}-update`);
  const drop = () => { try { fs.unlinkSync(zipPath); } catch { /* none */ } };
  try {
    let r = null;
    for (let attempt = 1; attempt <= TRIES; attempt++) {
      r = await downloadOnce(downloadUrl, zipPath, onProgress, attempt);
      if (r.ok || r.cancelled || !r.retry || current.cancelled) break;
      if (attempt < TRIES) onProgress({ phase: 'retry', attempt: attempt + 1, tries: TRIES, error: r.error });
    }
    if (current.cancelled || r.cancelled) { drop(); return { success: false, cancelled: true }; }
    if (!r.ok) { drop(); return { success: false, error: r.error }; }
    // only a whole zip goes on
    const size = fs.statSync(zipPath).size;
    if (!size || (r.total && size !== r.total)) { drop(); return { success: false, error: `the download is incomplete (${size} of ${r.total} bytes)` }; }

    current.phase = 'unpack';
    current.req = null;
    onProgress({ phase: 'unpack' });
    const res = await powershell('unpack', UNPACK_PS, ['-zip', zipPath, '-tmp', tmpDir, '-exe', path.basename(process.execPath)], EXTRACT_MS);
    if (!res.ok) { drop(); return { success: false, error: 'the update could not be unpacked: ' + res.error }; }
    return { success: true, staged: { src: res.out.split('\n').pop().trim(), tmp: tmpDir, zip: zipPath } };
  } finally {
    current = null;
  }
}

// Start the script that waits for the app to quit and installs the update; the caller quits.
// (PowerShell started detached — no console — quits at once without running anything, and one
// that isn't detached goes when the app does: so cmd's `start` gives it its own, hidden, window.
// Everything it needs is in a JSON file: only two quoted paths on the command line.)
function installAfterQuit(staged, appPath, userData, toVersion) {
  const ps1 = scriptFile('apply', APPLY_PS);
  const paramsFile = path.join(os.tmpdir(), `${AGENT}-update-params.json`);
  fs.writeFileSync(paramsFile, JSON.stringify({
    src: staged.src, dest: appPath, exe: path.basename(process.execPath), state: path.join(userData, 'update-state.json'),
    from: CURRENT_VERSION, to: toVersion, tmp: staged.tmp, zip: staged.zip, argv: process.argv.slice(1),
  }), 'utf8');
  const cmd = `"start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ps1}" "${paramsFile}""`;
  spawn('cmd.exe', ['/d', '/s', '/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
}

// At start: what the last update did. { updated: '1.2.115' } when this is the version it
// installed, { failed: '1.2.115', error } when the files couldn't be replaced (that version is
// then not offered again by itself until a newer one comes), null otherwise.
function lastUpdate(userData) {
  const file = path.join(userData, 'update-state.json');
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
  if (compareVersions(CURRENT_VERSION, s.to || '0') >= 0) {
    try { fs.unlinkSync(file); } catch { /* gone */ }
    return s.from && s.from !== CURRENT_VERSION ? { updated: CURRENT_VERSION } : null;
  }
  return { failed: s.to, error: s.error || '' };
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

module.exports = { enabled, checkForUpdate, prepareUpdate, installAfterQuit, cancelUpdate, busy, lastUpdate, compareVersions, REPO };
