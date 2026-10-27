// A mod list someone exported, opened in its own window (파일 → 내보내기 파일 보기…): the main
// screen's page again (renderer/index.html, preload-viewer.js), its categories, places and
// on/off from the file; my installed mods that the file names look as they do in my list, the
// ones I don't have are placeholders in their place. Nothing of mine is changed: the page's
// saves go nowhere (preload-viewer.js); "다른 이름으로 저장" writes a new export file.
// Up to MAX windows; the same file again brings its window to the front.
const fs = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain, dialog, screen } = require('electron');

const MAX = 4;
const POOL = '__vw_pool__'; // my mods the file doesn't name: a hidden category ("내 모드 추가")
let mainWin = null;
let userData = '';
let iconPath = '';
let loadConfig = () => null;
let nextId = 1;
const views = new Map(); // id -> { win, file, content, allowClose, cancelled }

const samePath = (a, b) => path.resolve(a || '').toLowerCase() === path.resolve(b || '').toLowerCase();
const viewOf = (sender) => [...views.values()].find((v) => !v.win.isDestroyed() && v.win.webContents === sender);

// The export file, as the page's parseImportText (renderer/editing.js) reads it.
function parseList(content) {
  const raw = String(content || '').replace(/^﻿/, '').split('\n').map((l) => l.trim());
  let data = {};
  const dataLine = raw.find((l) => l.startsWith('# BEEP-DATA '));
  if (dataLine) { try { data = JSON.parse(dataLine.slice('# BEEP-DATA '.length)); } catch { /* ignore */ } }
  const lines = raw.filter((l) => l && !l.startsWith('#'));
  const isBeep = lines.some((l) => l.startsWith('[')) && lines.some((l) => l.includes('|'));
  const src = { ws: data.ws || {}, order: data.order || null, entries: [], cats: null };
  if (isBeep && !data.noCats) {
    src.cats = [];
    let cur = null;
    for (const line of lines) {
      const m = line.match(/^\[(.+)\]$/);
      if (m) { cur = { name: m[1], entries: [] }; src.cats.push(cur); continue; }
      if (!cur) continue;
      const parts = line.split('|');
      const file = parts[0].trim();
      if (!file.toLowerCase().endsWith('.mod')) continue;
      const copy = parts.length > 2 ? parts[2].trim() : '';
      const e = { file, key: copy ? `${file}::${copy}` : file, active: parts.length > 1 ? parts[1].trim() === 'active' : true };
      cur.entries.push(e);
      src.entries.push(e);
    }
  } else {
    // a plain list (or exported without categories): all in Uncategorized, in its order
    const files = lines.map((l) => l.split('|')).filter((p) => p[0].trim().toLowerCase().endsWith('.mod'));
    const entries = files.map((p) => ({ file: p[0].trim(), key: p[0].trim(), active: p.length > 1 ? p[1].trim() === 'active' : true }));
    src.cats = [{ name: 'Uncategorized', entries }];
    src.entries = entries;
    if (!src.order) src.order = entries.filter((e) => e.active).map((e) => e.file);
  }
  return src.entries.length ? src : null;
}

// The name of Uncategorized in a language (the file writes 'Uncategorized'; older ones may not).
function uncatNames(lang) {
  const names = new Set(['uncategorized']);
  for (const l of [lang, 'en', 'ko']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'locales', `${l}.json`), 'utf8'));
      if (j['category.uncategorized']) names.add(j['category.uncategorized'].toLowerCase());
    } catch { /* none */ }
  }
  return names;
}

// The page's config for a file: my settings (paths, language, look, keys) and the file's layout.
// mine = my installed mods as the main window has them ([{ filename (= real file), filePath, … }]).
function buildConfig(view, mine) {
  const my = loadConfig() || {};
  const src = view.src;
  const uncat = uncatNames(my.language);
  const colorOf = new Map((my.categories || []).map((c) => [String(c.name).toLowerCase(), c.color]));
  const PALETTE = ['#e06c75', '#e5c07b', '#98c379', '#56b6c2', '#61afef', '#c678dd', '#d19a66', '#be5046'];
  const categories = [];
  const modCategories = {};
  const modOrders = {};
  const ghosts = {};
  let uncatPos = null;
  const have = new Map(mine.map((m) => [m.filename, m]));
  const keys = new Set();
  src.cats.forEach((c, i) => {
    const isUncat = uncat.has(c.name.toLowerCase());
    let id = 'uncategorized';
    if (isUncat) { if (uncatPos === null) uncatPos = categories.length; }
    else {
      id = 'vw' + i;
      categories.push({ id, name: c.name, color: colorOf.get(c.name.toLowerCase()) || PALETTE[categories.length % PALETTE.length], order: categories.length });
    }
    const list = (modOrders[id] ||= []);
    let prev = null;
    for (const e of c.entries) {
      if (keys.has(e.key)) continue;
      keys.add(e.key);
      modCategories[e.key] = id;
      list.push(e.key);
      if (!have.has(e.file)) ghosts[e.file] = { cat: id, after: prev, ws: src.ws[e.file] || my.knownWs?.[e.file] || null, on: e.active };
      prev = e.key;
    }
  });
  // my other mods: in the hidden category, off
  categories.push({ id: POOL, name: POOL, color: '#555555', order: categories.length });
  modOrders[POOL] = [];
  for (const m of [...mine].sort((a, b) => String(a.displayName || a.filename).localeCompare(String(b.displayName || b.filename)))) {
    if (keys.has(m.filename) || [...keys].some((k) => k.startsWith(m.filename + '::'))) continue;
    modCategories[m.filename] = POOL;
    modOrders[POOL].push(m.filename);
  }
  const keep = ['gamePath', 'steamModsPath', 'language', 'kenshiTheme', 'columnWidth', 'columnFit', 'autoShrink', 'zoomFactor', 'keymap', 'dupActive',
    'knownWs', 'verticalLayout', 'orderPanelWidth', 'orderPanelFolded', 'detailPanelFolded', 'mapZoomSpeed', 'columnScrollSpeed', 'columnScrollSpeedV', 'subAuto', 'subGap', 'subGapByCount', 'detailWidth'];
  const cfg = {};
  for (const k of keep) if (my[k] !== undefined) cfg[k] = my[k];
  return {
    ...cfg, categories, modCategories, modOrders, ghosts, uncatPos: uncatPos ?? categories.length - 1,
    knownWs: { ...(my.knownWs || {}), ...src.ws }, tutorialDismissed: true,
    vw: { pool: POOL, file: view.file, name: path.basename(view.file) },
  };
}

// The page's mod list: my mods (as found on disk by the main window), on / off and the load
// order as in the file (or, on a refresh, as the page has them now: live).
function buildMods(view, mine, live) {
  const src = view.src;
  // (real file names: a second copy of a name is told apart by the page itself, assignModKeys)
  const onFiles = new Set(live ? live.active : src.entries.filter((e) => e.active).map((e) => e.file));
  const order = live ? live.order : src.order || src.entries.filter((e) => e.active).map((e) => e.file);
  const at = new Map(order.map((f, i) => [f, i]));
  return mine.map((m) => {
    const on = onFiles.has(m.filename);
    return { ...m, active: on, order: on && at.has(m.filename) ? at.get(m.filename) : -1 };
  });
}

// My installed mods, from the main window's list (no second disk scan).
async function myMods() {
  if (!mainWin || mainWin.isDestroyed()) return [];
  try { return await mainWin.webContents.executeJavaScript('window.VIEW_HOST ? VIEW_HOST.myMods() : []'); } catch { return []; }
}
// My list as it is now, for the comparison (which mods I have on, and their order).
async function myState() {
  if (!mainWin || mainWin.isDestroyed()) return null;
  try { return await mainWin.webContents.executeJavaScript('window.VIEW_HOST ? VIEW_HOST.myState() : null'); } catch { return null; }
}
const toMain = (js) => { if (mainWin && !mainWin.isDestroyed()) { mainWin.webContents.executeJavaScript(js).catch(() => {}); if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } };

function open({ file, content, virtual, name }) {
  if (virtual) file = path.join(require('electron').app.getPath('documents'), path.basename(String(name || 'list.txt')));
  for (const v of views.values()) {
    if (!v.win.isDestroyed() && samePath(v.file, file)) { if (v.win.isMinimized()) v.win.restore(); v.win.focus(); return { focused: true }; }
  }
  if (views.size >= MAX) return { error: 'max', max: MAX };
  const src = parseList(content);
  if (!src) return { error: 'empty' };
  const id = nextId++;
  // the main window's size (a little down and right, inside its screen); maximized if it is
  const main = mainWin && !mainWin.isDestroyed() ? mainWin : null;
  const b = main ? main.getNormalBounds() : { x: 80, y: 60, width: 1280, height: 800 };
  const area = screen.getDisplayMatching(b).workArea;
  const off = 30 * (views.size + 1);
  const width = Math.min(b.width, area.width), height = Math.min(b.height, area.height);
  const win = new BrowserWindow({
    x: Math.max(area.x, Math.min(b.x + off, area.x + area.width - width)), y: Math.max(area.y, Math.min(b.y + off, area.y + area.height - height)), width, height,
    show: false, icon: iconPath, backgroundColor: '#18181e', title: path.basename(file),
    webPreferences: { preload: path.join(__dirname, '..', 'preload-viewer.js'), nodeIntegration: false, contextIsolation: true, webviewTag: true, additionalArguments: ['--vw-id=' + id] },
  });
  win.setMenu(null);
  const view = { id, win, file, content, src, allowClose: false };
  views.set(id, view);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { vw: String(id) } });
  win.once('ready-to-show', () => { if (main?.isMaximized()) win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) require('electron').shell.openExternal(url); return { action: 'deny' }; });
  // Closing asks the page first (unsaved changes: 저장 / 저장 안 함 / 취소).
  win.on('close', (e) => {
    if (view.allowClose) return;
    e.preventDefault();
    view.acked = false;
    win.webContents.send('vw-confirm-close');
    setTimeout(() => { if (!view.acked && !view.allowClose && !win.isDestroyed()) { view.allowClose = true; win.close(); } }, 2000);
  });
  win.webContents.on('render-process-gone', () => { view.allowClose = true; });
  win.on('closed', () => { views.delete(id); if (view.onGone) view.onGone(true); });
  return { opened: true };
}

// The main window is closing: each list window asks about its own changes first.
// Resolves true when all are closed, false when one stayed (취소).
function closeAll() {
  const list = [...views.values()].filter((v) => !v.win.isDestroyed());
  if (!list.length) return Promise.resolve(true);
  return Promise.all(list.map((v) => new Promise((res) => {
    v.onGone = res;
    v.onCancel = () => res(false);
    v.win.close();
  }))).then((all) => all.every(Boolean));
}
const count = () => [...views.values()].filter((v) => !v.win.isDestroyed()).length;

function setup(opts) {
  mainWin = opts.mainWindow;
  userData = opts.userData;
  iconPath = opts.icon;
  loadConfig = opts.loadConfig;

  ipcMain.handle('vw-open', (_e, req) => open(req));
  ipcMain.handle('vw-config', async (e) => {
    const v = viewOf(e.sender);
    if (!v) return null;
    v.mine = await myMods();
    return buildConfig(v, v.mine);
  });
  ipcMain.handle('vw-discover', async (e, live) => {
    const v = viewOf(e.sender);
    if (!v) return [];
    if (live) v.mine = await myMods(); // a refresh: what is installed now
    return buildMods(v, v.mine || (await myMods()), live);
  });
  ipcMain.handle('vw-my-state', () => myState());
  ipcMain.handle('vw-win', (e, act) => {
    const v = viewOf(e.sender);
    if (!v) return;
    if (act === 'min') v.win.minimize();
    else if (act === 'max') { if (v.win.isMaximized()) v.win.unmaximize(); else v.win.maximize(); }
    else if (act === 'full') v.win.setFullScreen(!v.win.isFullScreen());
  });
  ipcMain.handle('vw-zoom', (e, factor) => { if (Number(factor) > 0) e.sender.setZoomFactor(Math.max(0.5, Math.min(2, Number(factor)))); });
  // 다른 이름으로 저장: '<name>_사본 01.txt' (the word in the app's language), the next free number
  ipcMain.handle('vw-save-as', async (e, { text, word, adopt = true }) => {
    const v = viewOf(e.sender);
    if (!v) return null;
    const dir = path.dirname(v.file);
    const esc = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const base = path.basename(v.file, path.extname(v.file)).replace(new RegExp(`_${esc} \\d{2,}$`), ''); // (its own '_사본 01' only)
    let n = 1;
    let name;
    do { name = `${base}_${word} ${String(n).padStart(2, '0')}.txt`; n++; } while (fs.existsSync(path.join(dir, name)) && n < 1000);
    const r = await dialog.showSaveDialog(v.win, { defaultPath: path.join(dir, name), filters: [{ name: 'Text Files', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, text, 'utf8');
    // this window is that file now (the same file opened again comes here); not for a part of it
    if (adopt) {
      v.file = r.filePath;
      v.win.setTitle(path.basename(r.filePath));
    }
    return { path: r.filePath, name: path.basename(r.filePath) };
  });
  // the advanced export's "문자열 저장…": next to this list's file
  ipcMain.handle('vw-save-dialog', async (e, name) => {
    const v = viewOf(e.sender);
    if (!v) return null;
    const r = await dialog.showSaveDialog(v.win, { defaultPath: path.join(path.dirname(v.file), name || 'list.txt'), filters: [{ name: 'Text Files', extensions: ['txt'] }] });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('vw-close-ack', (e) => { const v = viewOf(e.sender); if (v) v.acked = true; });
  ipcMain.handle('vw-close-now', (e) => { const v = viewOf(e.sender); if (v) { v.allowClose = true; v.win.close(); } });
  ipcMain.handle('vw-close-cancel', (e) => { const v = viewOf(e.sender); if (v && v.onCancel) { const c = v.onCancel; v.onCancel = null; v.onGone = null; c(); } });
  // to the main window: subscribe to mods I don't have / this list into its import settings
  ipcMain.handle('vw-subscribe', (_e, items) => { toMain(`VIEW_HOST.subscribe(${JSON.stringify(items)})`); return true; });
  ipcMain.handle('vw-import', (_e, text) => { toMain(`VIEW_HOST.importText(${JSON.stringify(text)})`); return true; });
}

module.exports = { setup, closeAll, count, parseList, buildConfig, buildMods, POOL };
