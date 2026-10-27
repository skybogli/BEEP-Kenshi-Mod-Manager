// RE_Kenshi, started the way its own readme says (Plugins_x64.cfg is left alone):
//   리켄시 실행 — RE_Kenshi\kenshi_x64.exe (the game exe RE_Kenshi ships, which loads it), started in
//                 the game folder with the game folder on PATH; without that exe, the game's own exe
//                 (its "Plugin=RE_Kenshi" line loads it)
//   켄시 실행   — the game's own exe with --norekenshi
// Older versions of the manager turned the plugin line off for a plain start and back on after;
// a start left like that is still put back once (restoreAtStart).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const LINE = /^([ \t]*)#?[ \t]*Plugin[ \t]*=[ \t]*RE_Kenshi[ \t]*(\r?)$/m;
const MARKER = 'rekenshi-restore.json';

function cfgPath(gamePath) {
  return path.join(gamePath, 'Plugins_x64.cfg');
}

// RE_Kenshi's own game exe (RE_Kenshi\kenshi_x64.exe), or '' (any letter case).
function reExe(gamePath) {
  try {
    const dir = fs.readdirSync(gamePath).find((n) => n.toLowerCase() === 're_kenshi');
    if (!dir) return '';
    const exe = fs.readdirSync(path.join(gamePath, dir)).find((n) => n.toLowerCase() === 'kenshi_x64.exe');
    return exe ? path.join(gamePath, dir, exe) : '';
  } catch { return ''; }
}

// { installed, on, exe }: RE_Kenshi is there (its dll or its exe); its plugin line is on; its exe.
function status(gamePath) {
  const exe = gamePath ? reExe(gamePath) : '';
  const installed = !!gamePath && (fs.existsSync(path.join(gamePath, 'RE_Kenshi.dll')) || !!exe);
  let on = false;
  try {
    const m = fs.readFileSync(cfgPath(gamePath), 'utf8').match(LINE);
    on = !!m && !m[0].trimStart().startsWith('#');
  } catch { /* no file */ }
  return { installed, on, exe };
}

// Turn the plugin line on / off. Returns { success, error? }.
function setPlugin(gamePath, on) {
  const p = cfgPath(gamePath);
  try {
    const text = fs.readFileSync(p, 'utf8');
    let next = text;
    if (LINE.test(text)) next = text.replace(LINE, (_m, indent, cr) => `${indent}${on ? '' : '# '}Plugin=RE_Kenshi${cr}`);
    else if (on) {
      // No line at all: before the first plugin (RE_Kenshi goes first), or at the end.
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      next = /^Plugin=/m.test(text) ? text.replace(/^Plugin=/m, `Plugin=RE_Kenshi${eol}Plugin=`)
        : text + (text === '' || text.endsWith('\n') ? '' : eol) + `Plugin=RE_Kenshi${eol}`;
    }
    if (next === text) return { success: true };
    if (!fs.existsSync(p + '.beep-backup')) fs.copyFileSync(p, p + '.beep-backup');
    fs.writeFileSync(p, next);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function running(exeName, done) {
  execFile('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], { windowsHide: true }, (err, out) => {
    done(!err && String(out).toLowerCase().includes(exeName.toLowerCase()));
  });
}

function restore(userData) {
  const marker = path.join(userData, MARKER);
  try {
    const { gamePath } = JSON.parse(fs.readFileSync(marker, 'utf8'));
    setPlugin(gamePath, true);
  } catch { /* nothing to restore */ }
  try { fs.unlinkSync(marker); } catch { /* gone */ }
}

// After a plain start: once the game has quit (or never showed up within a minute), turn
// RE_Kenshi back on.
function watch(userData, exeName) {
  const started = Date.now();
  let seen = false;
  const timer = setInterval(() => running(exeName, (isRunning) => {
    if (isRunning) { seen = true; return; }
    if (seen || Date.now() - started > 60000) {
      clearInterval(timer);
      restore(userData);
    }
  }), 5000);
}

// What to start: { exe, args, cwd, env }. mode 'rekenshi' / 'vanilla'; exePath = the game's own exe.
function launchSpec(gamePath, mode, exePath) {
  const st = status(gamePath);
  if (!st.installed || !mode) return { exe: exePath, args: [], cwd: gamePath, env: process.env };
  if (mode === 'vanilla') return { exe: exePath, args: ['--norekenshi'], cwd: gamePath, env: process.env };
  if (!st.exe) return { exe: exePath, args: [], cwd: gamePath, env: process.env };
  // the game folder first on PATH, so RE_Kenshi's exe finds the game's DLLs
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = [gamePath, path.dirname(st.exe), env[key]].filter(Boolean).join(path.delimiter);
  return { exe: st.exe, args: [], cwd: gamePath, env };
}

// At the manager's start: a plain start the last time that wasn't put back yet.
function restoreAtStart(userData) {
  const marker = path.join(userData, MARKER);
  if (!fs.existsSync(marker)) return;
  let exeName = 'kenshi_x64.exe';
  try { exeName = JSON.parse(fs.readFileSync(marker, 'utf8')).exeName || exeName; } catch { /* default */ }
  running(exeName, (isRunning) => (isRunning ? watch(userData, exeName) : restore(userData)));
}

module.exports = { status, setPlugin, launchSpec, restoreAtStart };
