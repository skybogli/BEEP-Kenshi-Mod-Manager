// Backups the translator makes: '<file>.bak' (the original, before the first in-place edit) and
// dated ones '<file>_yyMMddHHmmss.bak' (the newest 10 kept per file).
const fs = require('fs');
const path = require('path');

const KEEP = 10;
const DATED_RE = /_(\d{12})(?:_(\d+))?\.bak$/;

const pad = (n) => String(n).padStart(2, '0');
function stamp(fmt, d = new Date()) {
  const v = { yy: pad(d.getFullYear() % 100), yyyy: String(d.getFullYear()), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) };
  return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (k) => v[k]);
}

function datedPath(file) {
  const st = stamp('yyMMddHHmmss');
  let bak = `${file}_${st}.bak`;
  for (let n = 2; fs.existsSync(bak); n++) bak = `${file}_${st}_${n}.bak`;
  return bak;
}

// Copy an existing file to a dated backup ('' when there's no file).
function backupExisting(file) {
  if (!fs.existsSync(file)) return '';
  const bak = datedPath(file);
  fs.copyFileSync(file, bak);
  return bak;
}

// [{ path, kind: 'original' | 'dated', when }] — the original first, then the newest first
function list(target, includeOriginal = true) {
  const out = [];
  if (includeOriginal && fs.existsSync(target + '.bak')) {
    let when = '';
    try { when = stamp('yyyy-MM-dd HH:mm:ss', fs.statSync(target + '.bak').mtime); } catch { /* no time */ }
    out.push({ path: target + '.bak', kind: 'original', when });
  }
  const folder = path.dirname(target);
  const base = path.basename(target);
  let names = [];
  try { names = fs.readdirSync(folder); } catch { /* no folder */ }
  const dated = [];
  for (const n of names) {
    const m = DATED_RE.exec(n);
    if (!m || n.slice(0, m.index) !== base) continue;
    const st = m[1];
    dated.push({ key: [st, Number(m[2] || 1)], item: { path: path.join(folder, n), kind: 'dated', when: `20${st.slice(0, 2)}-${st.slice(2, 4)}-${st.slice(4, 6)} ${st.slice(6, 8)}:${st.slice(8, 10)}:${st.slice(10, 12)}` } });
  }
  dated.sort((a, b) => (a.key[0] < b.key[0] ? 1 : a.key[0] > b.key[0] ? -1 : b.key[1] - a.key[1]));
  return out.concat(dated.map((d) => d.item));
}

// Keep the current file as a dated backup; older dated backups past KEEP are removed.
function saveDated(file, keep = KEEP) {
  if (!fs.existsSync(file)) return '';
  const bak = datedPath(file);
  fs.copyFileSync(file, bak);
  for (const old of list(file, false).slice(keep)) { try { fs.unlinkSync(old.path); } catch { /* stays */ } }
  return bak;
}

// Put a backup back; the file as it was just before is kept as a dated backup (its path returned).
function restore(target, bak) {
  if (!fs.existsSync(bak)) throw new Error('백업 파일을 찾을 수 없습니다: ' + bak);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.restore_tmp';
  fs.copyFileSync(bak, tmp); // copied first, so cleaning old backups can't remove it
  try {
    const pre = saveDated(target);
    fs.renameSync(tmp, target);
    return pre;
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* left */ }
  }
}

module.exports = { stamp, datedPath, backupExisting, list, saveDated, restore, KEEP };
