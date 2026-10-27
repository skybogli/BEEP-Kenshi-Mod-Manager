// Steam's record of the Workshop items it has installed for Kenshi:
// steamapps/workshop/appworkshop_233860.acf (next to content/233860, the Workshop folder).
// A mod folder deleted outside Steam stays listed there as installed, and Steam then never
// downloads it again — not even after unsubscribing and subscribing. forget(ids) takes the
// entries of mods whose folder is gone out of that file, after a backup copy in the app's
// user data folder (steam-backup, the last 10 kept).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP_ID = '233860';
const KEEP_BACKUPS = 10;

function acfPath(steamModsPath) {
  if (!steamModsPath) return null;
  const p = path.join(steamModsPath, '..', '..', `appworkshop_${APP_ID}.acf`);
  return fs.existsSync(p) ? p : null;
}

// The id blocks of one section ("WorkshopItemsInstalled" / "WorkshopItemDetails"):
// [{ id, start, end }] as offsets into text.
function sectionEntries(text, name) {
  const head = new RegExp(`\\n\\t"${name}"\\r?\\n\\t\\{\\r?\\n`).exec(text);
  if (!head) return [];
  const from = head.index + head[0].length;
  const close = /\n\t\}\r?\n/g;
  close.lastIndex = from - 1;
  const end = close.exec(text);
  const body = text.slice(from, end ? end.index + 1 : text.length);
  const out = [];
  const re = /\t\t"(\d+)"\r?\n\t\t\{\r?\n[^{}]*?\t\t\}\r?\n/g;
  let m;
  while ((m = re.exec(body))) out.push({ id: m[1], start: from + m.index, end: from + m.index + m[0].length });
  return out;
}

function steamRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
    return /steam\.exe/i.test(out);
  } catch {
    return false;
  }
}

module.exports = function steamWorkshopRecord(userDataDir) {
  // ids: Workshop ids to take out; only those whose folder is gone are touched.
  // -> { removed, steamRunning, backup } or { error }
  function forget(steamModsPath, ids) {
    const file = acfPath(steamModsPath);
    if (!file) return { removed: [], steamRunning: false, noFile: true };
    const gone = new Set((ids || []).filter((id) => /^\d+$/.test(id) && !fs.existsSync(path.join(steamModsPath, id))));
    if (!gone.size) return { removed: [], steamRunning: false };
    try {
      const text = fs.readFileSync(file, 'utf8');
      const hits = [...sectionEntries(text, 'WorkshopItemsInstalled'), ...sectionEntries(text, 'WorkshopItemDetails')]
        .filter((e) => gone.has(e.id))
        .sort((a, b) => b.start - a.start);
      if (!hits.length) return { removed: [], steamRunning: false };
      const dir = path.join(userDataDir, 'steam-backup');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = path.join(dir, `appworkshop_${APP_ID}_${stamp}.acf`);
      fs.copyFileSync(file, backup);
      for (const old of fs.readdirSync(dir).filter((f) => f.endsWith('.acf')).sort().slice(0, -KEEP_BACKUPS)) {
        try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ }
      }
      let out = text;
      for (const h of hits) out = out.slice(0, h.start) + out.slice(h.end);
      const tmp = file + '.mm-tmp';
      fs.writeFileSync(tmp, out, 'utf8');
      fs.renameSync(tmp, file);
      return { removed: [...new Set(hits.map((h) => h.id))], steamRunning: steamRunning(), backup };
    } catch (err) {
      return { error: err.message };
    }
  }

  // Ids Steam lists as installed.
  function listed(steamModsPath) {
    const file = acfPath(steamModsPath);
    if (!file) return [];
    try { return sectionEntries(fs.readFileSync(file, 'utf8'), 'WorkshopItemsInstalled').map((e) => e.id); } catch { return []; }
  }

  return { forget, listed };
};
