// Del with undo (the same file in the ARK, Factorio and Kenshi managers).
// Deleted mod files don't go to the Recycle Bin at once: they are moved aside where neither
// the game nor the app looks — into a ".mm-deleted" folder next to them ("hold"), or renamed
// with a ".mm-deleted" suffix ("suffix") — so Undo can put them back. When the app closes
// (or, after a crash, at the next start) they go to the Recycle Bin. The list of moved files
// is kept in pending-delete.json in the app's user data folder.

const fs = require('fs');
const path = require('path');

const HOLD_DIR = '.mm-deleted';

function exists(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

module.exports = function softDelete(userDataDir, shell) {
  const listFile = path.join(userDataDir, 'pending-delete.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(listFile, 'utf8')); } catch { return []; } };
  const write = (list) => {
    try { fs.mkdirSync(userDataDir, { recursive: true }); fs.writeFileSync(listFile, JSON.stringify(list)); } catch { /* ignore */ }
  };

  // items: [{ path, mode: 'hold' | 'suffix' }] -> { moved: [{ from, to }], errors }
  function hide(items) {
    const moved = [];
    const errors = [];
    for (const it of items) {
      try {
        if (!exists(it.path)) continue;
        let to;
        if (it.mode === 'suffix') to = it.path + '.mm-deleted';
        else {
          const dir = path.join(path.dirname(it.path), HOLD_DIR);
          fs.mkdirSync(dir, { recursive: true });
          to = path.join(dir, path.basename(it.path));
        }
        if (exists(to)) to += '-' + Date.now();
        fs.renameSync(it.path, to);
        moved.push({ from: it.path, to });
      } catch (err) {
        errors.push({ path: it.path, error: err.message });
      }
    }
    write([...read(), ...moved]);
    return { moved, errors };
  }

  // Undo: put the files back where they were. -> { restored, missing, errors } (paths):
  // restored = back (or already there again, e.g. Steam downloaded it anew — the set-aside
  // copy then still goes to the Recycle Bin); missing = the set-aside copy is gone (deleted
  // by hand), so it can't come back.
  function restore(moved) {
    const restored = [];
    const missing = [];
    const errors = [];
    const done = new Set();
    for (const m of moved || []) {
      try {
        if (exists(m.from)) restored.push(m.from);
        else if (exists(m.to)) { fs.renameSync(m.to, m.from); restored.push(m.from); done.add(m.to); }
        else { missing.push(m.from); done.add(m.to); }
      } catch (err) {
        errors.push({ path: m.from, error: err.message });
      }
    }
    write(read().filter((m) => !done.has(m.to)));
    return { restored, missing, errors };
  }

  // Everything still set aside goes to the Recycle Bin.
  async function finalize() {
    const list = read();
    for (const m of list) {
      try { if (exists(m.to)) await shell.trashItem(m.to); } catch { /* left for next time */ }
    }
    for (const dir of new Set(list.map((m) => path.dirname(m.to)).filter((d) => path.basename(d) === HOLD_DIR))) {
      try { fs.rmdirSync(dir); } catch { /* not empty or gone */ }
    }
    write(list.filter((m) => exists(m.to)));
  }

  return { hide, restore, finalize, pending: () => read().length };
};
