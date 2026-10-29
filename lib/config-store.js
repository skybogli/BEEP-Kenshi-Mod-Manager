const fs = require('fs');
const path = require('path');

const CONFIG_NAME = 'config.json';

function getConfigPath(userDataPath) {
  return path.join(userDataPath, CONFIG_NAME);
}

function loadConfig(userDataPath) {
  const configPath = getConfigPath(userDataPath);
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Migrate old configs without category data
    if (!config.categories) config.categories = [];
    if (!config.modCategories) config.modCategories = {};
    if (!config.modOrders) config.modOrders = {};
    return config;
  } catch {
    return null;
  }
}

function saveConfig(userDataPath, config) {
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  fs.writeFileSync(getConfigPath(userDataPath), JSON.stringify(config, null, 2), 'utf8');
}

// ===== Mod Packs =====

const PACKS_DIR = 'modpacks';

function getPacksDir(userDataPath) {
  return path.join(userDataPath, PACKS_DIR);
}

function loadPacks(userDataPath) {
  const dir = getPacksDir(userDataPath);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return data;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// A pack's file is named after it, only what Windows can't have in a file name changed. (Older
// versions turned every letter but a-z / 0-9 into '_', so Korean names ran into each other.)
function packFileBase(name) {
  let s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!s || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
  return s;
}

// The pack files there, with the pack name each one holds.
function packFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((file) => {
    try { return { file, name: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).name }; }
    catch { return { file, name: null }; }
  });
}

// Saving a name that exists replaces that pack (whatever its file is called); a file that
// holds another pack (a name differing only in case, …) is left alone: this one gets "name (2)".
function savePack(userDataPath, pack) {
  const dir = getPacksDir(userDataPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const p of packFiles(dir)) if (p.name === pack.name) fs.unlinkSync(path.join(dir, p.file));
  const base = packFileBase(pack.name);
  let file = base + '.json';
  for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${base} (${i}).json`;
  fs.writeFileSync(path.join(dir, file), JSON.stringify(pack, null, 2), 'utf8');
}

function deletePack(userDataPath, packName) {
  const dir = getPacksDir(userDataPath);
  for (const p of packFiles(dir)) if (p.name === packName) fs.unlinkSync(path.join(dir, p.file));
}

// An auto preset (auto: true in its file) to the Recycle Bin; trash = shell.trashItem.
async function trashAutoPack(userDataPath, packName, trash) {
  const dir = getPacksDir(userDataPath);
  for (const p of packFiles(dir)) {
    if (p.name !== packName) continue;
    const file = path.join(dir, p.file);
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).auto === true) await trash(file); } catch { /* left there */ }
  }
}

module.exports = { loadConfig, saveConfig, loadPacks, savePack, deletePack, trashAutoPack };
