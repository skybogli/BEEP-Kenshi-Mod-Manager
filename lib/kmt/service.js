// The translator (Kenshi Mod Translator, built in): its own window, its settings and its jobs.
// Jobs run here in the main process one after another; the window shows the log and progress,
// and when a job made a mod, the manager's window is told so it can put it in a category.
const fs = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const R = require('./rules');
const J = require('./jobs');
const backups = require('./backups');
const G = require('./glossary');

let win = null;
let mainWin = null;
let userData = '';
let iconPath = '';
let getGamePath = () => '';
let getSteamModsPath = () => '';
let queue = [];
let running = null; // { job, stopFlag }
let logBuffer = [];
let logTimer = null;

// ---- settings (userData/translator.json) ----
const settingsFile = () => path.join(userData, 'translator.json');
function defaults() {
  return {
    work: R.defaultSettings(),
    patchcopy: R.defaultPatchSettings(),
    after: { exportNoGlossary: true, openExtract: true },
    glossaryPath: '', // the Korean glossary (KMT's); other target languages: glossaries[code]
    glossaries: {},
    glossaryOnly: false,
    target: 'auto', // the language to translate into: 'auto' = the manager's language (English if it has none), else rules.js TARGETS
    langsFor: 'ko', // the target work.langs was chosen for (it changed: they are swapped, rules.js swapLangs)
    dataDir: '', // '' = <userData>/translator
    dataLayout: 'split', // 'split' = a folder per kind under dataDir / 'single' = all in dataDir (KMT's own layout)
    dataNames: { cache: '번역 저장본', review: '번역 검수', extract: '번역 추출', noGloss: '구글 번역 용어' }, // the folders of 'split'
    outRoot: '', // '' = the game's mods folder
    mode: 'patchmod',
    route: { ko: '', patch: '', pos: 'afterActive' }, // category ids ('' = found by name, else Uncategorized); pos: top / afterActive / bottom
    activate: true, // a new patch mod is turned on (after its original) when the original is on
    pinned: false, // the window stays above the manager's window
    overlap: 'minimize', // pinned, and a manager dialog would be under it: minimize / behind / top
    reviewBackup: true,
  };
}
function loadSettings() {
  const s = defaults();
  let data = {};
  try { data = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch { /* first time */ }
  R.mergeSettings(s.work, data.work);
  R.mergeSettings(s.patchcopy, data.patchcopy);
  for (const k of ['glossaryPath', 'dataDir', 'outRoot', 'mode', 'dataLayout', 'overlap', 'target', 'langsFor']) if (typeof data[k] === 'string') s[k] = data[k];
  if (data.glossaries && typeof data.glossaries === 'object') for (const [k, v] of Object.entries(data.glossaries)) if (R.TARGETS[k] && typeof v === 'string') s.glossaries[k] = v;
  if (s.target !== 'auto' && !R.TARGETS[s.target]) s.target = 'auto';
  if (!R.TARGETS[s.langsFor]) s.langsFor = 'ko';
  for (const k of ['glossaryOnly', 'activate', 'reviewBackup', 'pinned']) if (typeof data[k] === 'boolean') s[k] = data[k];
  if (data.after) Object.assign(s.after, data.after);
  if (data.route) Object.assign(s.route, data.route);
  if (data.dataNames) for (const k of Object.keys(s.dataNames)) if (typeof data.dataNames[k] === 'string' && data.dataNames[k].trim()) s.dataNames[k] = data.dataNames[k].trim();
  if (!['patchmod', 'inplace', 'copypatch'].includes(s.mode)) s.mode = 'patchmod';
  syncTarget(s);
  return s;
}

// ---- the target language ----
let langNow = ''; // the manager's language, as it last said (its config may not be saved yet)
const managerLang = () => langNow || getLang() || 'en';
const autoTarget = () => R.targetFromLang(managerLang()) || 'en';
const targetNow = (s) => (s.target !== 'auto' && R.TARGETS[s.target] ? s.target : autoTarget());
const glossaryFor = (s, t) => (t === 'ko' ? s.glossaryPath : s.glossaries[t] || '');
function setGlossary(s, t, p) { if (t === 'ko') s.glossaryPath = p; else s.glossaries[t] = p; }
const L = require('./lang');
const { say, langName } = L;
L.setSource(() => managerLang()); // (the log and messages: the manager's language)
// The target is not the one the detected languages were chosen for (the setting, or the manager's
// language it follows, changed): they are swapped, saved, and the window is told.
function syncTarget(s) {
  const t = targetNow(s);
  if (s.langsFor === t) return;
  const from = s.langsFor;
  R.swapLangs(s.work.langs, from, t);
  s.langsFor = t;
  try { saveSettings(s); } catch { /* next time */ }
  log(say(`[안내] 번역 대상 언어: ${langName(from)} → ${langName(t)}${s.target === 'auto' ? ' (모드 관리자 언어를 따름)' : ''} · 결과 모드 ${R.patchSuffix(t)} · 용어집: ${glossaryFor(s, t) || '없음'}`,
    `[Note] Translating into: ${langName(from)} → ${langName(t)}${s.target === 'auto' ? ' (follows the mod manager)' : ''} · made mods ${R.patchSuffix(t)} · glossary: ${glossaryFor(s, t) || 'none'}`));
  setImmediate(() => { flushLog(); send('kmt-target', view(loadSettings())); dock(); });
}
// The settings as the window sees them: the glossary of the target now, and the target itself.
const view = (s) => ({ ...s, glossaryPath: glossaryFor(s, targetNow(s)), targetNow: targetNow(s), targetAuto: autoTarget() });
function saveSettings(s) {
  const tmp = settingsFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, settingsFile());
}
const dataDir = (s) => (s.dataDir && s.dataDir.trim()) || path.join(userData, 'translator');
// Where each kind of file goes (jobs.js): one folder, or a folder per kind under it.
function dirsOf(s) {
  const root = dataDir(s);
  if (s.dataLayout === 'single') return { cache: root, review: path.join(root, '번역 검수'), extract: root, noGloss: root };
  const n = s.dataNames;
  return { cache: path.join(root, n.cache), review: path.join(root, n.review), extract: path.join(root, n.extract), noGloss: path.join(root, n.noGloss) };
}
function modsDir() {
  const g = getGamePath();
  if (!g) return '';
  try {
    const d = fs.readdirSync(g).find((n) => n.toLowerCase() === 'mods' && fs.statSync(path.join(g, n)).isDirectory());
    return path.join(g, d || 'mods');
  } catch { return path.join(g, 'mods'); }
}
const outRoot = (s) => (s.outRoot && s.outRoot.trim()) || modsDir() || dataDir(s);

// ---- talking to the window ----
// A window (or its page) can be gone already while the app quits: then nothing is sent.
const alive = (w) => !!(w && !w.isDestroyed() && !w.webContents.isDestroyed());
let getLang = () => 'ko';
const send = (ch, ...args) => { if (alive(win)) try { win.webContents.send(ch, ...args); } catch { /* closing */ } };
const toMain = (ch, data) => { if (alive(mainWin)) try { mainWin.webContents.send(ch, data); } catch { /* closing */ } };
function log(text) {
  logBuffer.push(String(text));
  if (!logTimer) logTimer = setTimeout(flushLog, 80); // many lines at once are sent together
}
function flushLog() {
  clearTimeout(logTimer);
  logTimer = null;
  if (logBuffer.length) send('kmt-log', logBuffer.splice(0));
}
function progress(done, total) { send('kmt-progress', { done, total }); dockProgress(done, total); }

// The bar at the bottom of the manager's window (the translator 'minimized' there).
let dockLast = 0;
let dockInfo = { done: 0, total: 0 };
function dock() {
  if (!alive(mainWin)) return;
  toMain('kmt-dock', {
    shown: alive(win) && win.isVisible(),
    running: running ? path.basename(running.job.mod) : '',
    queued: queue.length,
    done: dockInfo.done, total: dockInfo.total,
    target: targetNow(loadSettings()),
  });
}
function dockProgress(done, total) {
  dockInfo = { done, total };
  if (Date.now() - dockLast < 400 && done !== total) return;
  dockLast = Date.now();
  dock();
}
function state() {
  return { queue: queue.map(publicJob), running: running ? publicJob(running.job) : null };
}
const publicJob = (j) => ({ id: j.id, mode: j.mode, mod: j.mod, name: path.basename(j.mod) });
const pushState = () => { send('kmt-state', state()); dock(); };

// ---- the window ----
// No frame (its own minimize / maximize / close buttons) and no menu. Minimize hides it to the
// bar at the bottom of the manager's window; 'pinned' keeps it above the manager's window.
function openWindow() {
  if (win && !win.isDestroyed()) {
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
    dock();
    return win;
  }
  const s = loadSettings();
  win = new BrowserWindow({
    width: 1100, height: 640, minWidth: 640, minHeight: 300,
    title: say('번역 · 패치 도구', 'Translate / Patch Tool'), icon: iconPath, backgroundColor: '#16181b',
    frame: false, show: false,
    parent: s.pinned && mainWin && !mainWin.isDestroyed() ? mainWin : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'translator', 'translator.html'));
  win.once('ready-to-show', () => { win.show(); dock(); });
  const maxed = () => send('kmt-maxed', win.isMaximized());
  win.on('maximize', maxed);
  win.on('unmaximize', maxed);
  win.on('show', dock);
  win.on('hide', dock);
  win.on('closed', () => { win = null; dock(); });
  return win;
}

// From the window's own title bar.
function windowAction(action, arg) {
  if (!win || win.isDestroyed()) return null;
  if (action === 'min') {
    win.hide();
    // the keys go to the manager again (its Ctrl+T brings this window back)
    if (mainWin && !mainWin.isDestroyed()) mainWin.focus();
  }
  else if (action === 'max') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  else if (action === 'close') win.close();
  else if (action === 'pin') {
    win.setParentWindow(arg && mainWin && !mainWin.isDestroyed() ? mainWin : null);
    const s = loadSettings();
    s.pinned = !!arg;
    saveSettings(s);
    win.focus();
  } else if (action === 'height' && !win.isMaximized()) {
    // never taller than the screen it is on (taskbar left out); moved up if it would go off the bottom
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const h = Math.min(area.height, Math.max(300, Math.round(arg)));
    const y = Math.min(Math.max(b.y, area.y), area.y + area.height - h);
    win.setBounds({ x: b.x, y, width: b.width, height: h });
  } else if (action === 'size') return { height: win.getSize()[1], maximized: win.isMaximized(), area: screen.getDisplayMatching(win.getBounds()).workArea.height };
  return true;
}
// A dialog in the manager's window (rect in its page, CSS px; null when none is open). The pinned
// window would cover it: by the setting it goes down to the bar, goes behind the manager, or
// stays on top; when the dialog closes it comes back as it was.
let steppedAside = null; // 'hidden' / 'behind'
function mainDialog(rect) {
  if (!win || win.isDestroyed() || !mainWin || mainWin.isDestroyed()) return;
  const s = loadSettings();
  if (!rect) {
    if (steppedAside === 'hidden' && !win.isVisible()) win.showInactive();
    if (steppedAside === 'behind' && s.pinned) win.setParentWindow(mainWin);
    steppedAside = null;
    dock();
    return;
  }
  if (steppedAside || !s.pinned || !win.isVisible() || s.overlap === 'top') return; // (already aside: stays so until the dialog closes)
  const c = mainWin.getContentBounds();
  const z = mainWin.webContents.getZoomFactor();
  const d = { x: c.x + rect.x * z, y: c.y + rect.y * z, w: rect.w * z, h: rect.h * z };
  const b = win.getBounds();
  const overlaps = d.x < b.x + b.width && b.x < d.x + d.w && d.y < b.y + b.height && b.y < d.y + d.h;
  if (!overlaps) return;
  if (s.overlap === 'behind') {
    win.setParentWindow(null);
    mainWin.focus();
    steppedAside = 'behind';
  } else {
    win.hide();
    mainWin.focus();
    steppedAside = 'hidden';
  }
  dock();
}

// The bar in the manager: show the window, or hide it when it is in front already.
function toggleFromDock() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) { windowAction('min'); return; }
  openWindow();
}

// Ask the manager's window for its categories ([{ id, name, color }]).
async function categories() {
  if (!mainWin || mainWin.isDestroyed()) return [];
  try { return await mainWin.webContents.executeJavaScript('window.KMT_BRIDGE ? KMT_BRIDGE.categories() : []'); } catch { return []; }
}

// ---- jobs ----
let nextId = 1;
function enqueue(list) {
  const target = targetNow(loadSettings()); // a job keeps the language it was queued with
  for (const j of list) queue.push({ id: nextId++, target, ...j });
  pushState();
  if (!running) runNext();
}

async function runNext() {
  const job = queue.shift();
  if (!job) { running = null; pushState(); send('kmt-idle'); return; }
  const stop = { flag: false };
  running = { job, stop };
  pushState();
  const s = loadSettings();
  const target = R.targetOf(job.target || targetNow(s));
  const suffix = R.patchSuffix(target);
  const ctx = { log, progress, stop: () => stop.flag, dataDir: dataDir(s), dirs: dirsOf(s), target, headers: { patchmod: s.work.header, copypatch: s.patchcopy.header } };
  // the detected languages as they are for that target
  const work = target === s.langsFor ? s.work : { ...s.work, langs: R.swapLangs({ ...s.work.langs }, s.langsFor, target) };
  const started = Date.now();
  const modeName = say({ patchmod: `별도 ${langName(target)} 패치 모드 생성 (${suffix})`, inplace: `원본 모드 직접 수정 (${langName(target)})`, copypatch: '패치파일 생성(지정 항목 복사)', extract: '번역 추출' },
    { patchmod: `Make a separate ${langName(target)} patch mod (${suffix})`, inplace: `Translate the original mod (${langName(target)})`, copypatch: 'Make a patch file (copy chosen fields)', extract: 'Extract for translation' })[job.mode];
  log('');
  log(`==== ${modeName}: ${path.basename(job.mod)} ====`);
  if (job.mode === 'patchmod' || job.mode === 'inplace') log(say(`번역 대상 언어: ${langName(target)} · 용어집: ${glossaryFor(s, target) || '없음'}`, `Translating into: ${langName(target)} · glossary: ${glossaryFor(s, target) || 'none'}`));
  let result = null;
  let error = null;
  try {
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    const out = outRoot(s);
    const glossary = glossaryFor(s, target);
    if (job.mode === 'extract') result = J.extractTerms(ctx, job.mod, work);
    else if (job.mode === 'copypatch') result = await J.buildCopyPatch(ctx, job.mod, s.patchcopy, out);
    else {
      const existed = job.mode === 'patchmod' && fs.existsSync(path.join(out, path.basename(job.mod, '.mod') + suffix, path.basename(job.mod, '.mod') + suffix + '.mod'));
      result = job.mode === 'inplace'
        ? await J.buildInplace(ctx, job.mod, glossary, work, { glossaryOnly: s.glossaryOnly })
        : await J.buildPatchMod(ctx, job.mod, glossary, work, out, { glossaryOnly: s.glossaryOnly });
      result.existed = existed;
      if (result.review && result.review.length) result.reviewFile = J.saveJobReview(ctx, job.mod, job.mode === 'patchmod' ? out : '', job.mode, result.review);
      if (s.after.exportNoGlossary && result.review) J.exportNoGlossary(ctx, job.mod, result.review);
    }
    if (job.mode === 'copypatch' && result.path) result.existed = !!result.oldBackup;
  } catch (e) {
    error = e instanceof G.StopError ? say('사용자 중지', 'Stopped by the user') : e.message;
    log((e instanceof G.StopError ? say('[중지] ', '[Stopped] ') : say('[오류] ', '[Error] ')) + error);
  }
  log(say(`(걸린 시간 ${((Date.now() - started) / 1000).toFixed(1)}초)`, `(took ${((Date.now() - started) / 1000).toFixed(1)} s)`));
  flushLog();
  const summary = { id: job.id, mode: job.mode, mod: job.mod, error, path: result && result.path, nochange: result && result.nochange, message: result && result.message, changed: result && result.changed, records: result && result.records, reviewFile: result && result.reviewFile, stats: result && result.stats };
  send('kmt-job-done', summary);
  if (job.mode === 'extract' && result && s.after.openExtract) shell.openPath(result.path);
  // A patch mod made in the game's mods folder: the manager reloads and places it.
  if (result && result.path && (job.mode === 'patchmod' || job.mode === 'copypatch') && mainWin && !mainWin.isDestroyed()) {
    const inMods = path.resolve(path.dirname(path.dirname(result.path))).toLowerCase() === path.resolve(modsDir() || '?').toLowerCase();
    toMain('kmt-made-mod', { mode: job.mode, source: job.mod, path: result.path, inMods, isNew: !result.existed, route: s.route, activate: s.activate });
  }
  if (result && job.mode === 'inplace' && !result.nochange && mainWin && !mainWin.isDestroyed()) toMain('kmt-made-mod', { mode: 'inplace', source: job.mod, path: job.mod, inMods: false, isNew: false });
  running = null;
  setImmediate(runNext);
}

// ---- KMT's own files (a KMT folder): its settings, cache, review files ----
function importKmt(folder, s) {
  const cfgFile = path.join(folder, 'kenshi_patch_config.json');
  const res = { settings: false, cache: 0, glossary: '' };
  if (fs.existsSync(cfgFile)) {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) || {};
    if (cfg.work) { R.mergeSettings(s.work, cfg.work); if (cfg.work.after) { s.after.exportNoGlossary = cfg.work.after.export_no_glossary !== false; s.after.openExtract = cfg.work.after.open_extract_file !== false; } res.settings = true; }
    if (cfg.patchcopy) { R.mergeSettings(s.patchcopy, cfg.patchcopy); res.settings = true; }
  }
  const gl = path.join(folder, 'glossary.txt');
  if (fs.existsSync(gl) && !s.glossaryPath) { s.glossaryPath = gl; res.glossary = gl; }
  // the Google cache: merged into this one (KMT's own file is left as it is)
  const theirs = G.loadCache(path.join(folder, 'kenshi_translate_cache.json'));
  if (theirs.size) {
    const mineFile = path.join(dirsOf(s).cache, 'kenshi_translate_cache.json');
    const mine = G.loadCache(mineFile);
    for (const [k, v] of theirs) if (!mine.has(k)) { mine.set(k, v); res.cache++; }
    G.saveCache(mineFile, mine);
  }
  return res;
}

function setup(opts) {
  userData = opts.userData;
  iconPath = opts.icon;
  getGamePath = opts.gamePath;
  getSteamModsPath = opts.steamModsPath || (() => '');
  getLang = opts.lang || (() => 'ko');
  mainWin = opts.mainWindow;

  // from the manager's window
  ipcMain.handle('kmt-open', (_e, req) => {
    openWindow();
    if (req && req.mods && req.mods.length) {
      const s = loadSettings();
      const mode = req.mode || s.mode;
      const go = () => { send('kmt-request', { mods: req.mods, mode }); if (req.start) enqueue(req.mods.map((mod) => ({ mod, mode }))); };
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', go); else go();
    }
    return true;
  });

  // from the translator window
  ipcMain.handle('kmt-init', async () => {
    const s = loadSettings();
    return {
      settings: view(s), dataDir: dataDir(s), dirs: dirsOf(s), modsDir: modsDir(), outRoot: outRoot(s), gamePath: getGamePath(), steamModsPath: getSteamModsPath(),
      maximized: !!(win && win.isMaximized()), lang: getLang(),
      defs: { FIELD_GROUPS: R.FIELD_GROUPS, EXCLUDE_DEFS: R.EXCLUDE_DEFS, LANG_DEFS: R.LANG_DEFS, TARGETS: R.TARGETS },
      categories: await categories(), state: state(),
    };
  });
  ipcMain.handle('kmt-categories', () => categories());
  // the manager's language changed
  ipcMain.handle('kmt-lang', (_e, lang) => {
    langNow = lang;
    send('kmt-lang', lang);
    loadSettings(); // the target may follow it (syncTarget tells the window)
    dock();
    return true;
  });
  ipcMain.handle('kmt-win', (_e, action, arg) => windowAction(action, arg));
  ipcMain.handle('kmt-dock-click', () => { toggleFromDock(); return true; });
  ipcMain.handle('kmt-main-dialog', (_e, rect) => { mainDialog(rect); return true; });
  // the list was reordered: waiting jobs follow it
  ipcMain.handle('kmt-reorder', (_e, paths) => {
    const at = new Map(paths.map((p, i) => [p, i]));
    queue.sort((a, b) => (at.has(a.mod) ? at.get(a.mod) : 1e9) - (at.has(b.mod) ? at.get(b.mod) : 1e9));
    pushState();
    return true;
  });
  // mods dragged in from the manager: their file names -> paths
  ipcMain.handle('kmt-resolve-mods', async (_e, names) => {
    if (!mainWin || mainWin.isDestroyed()) return [];
    try { return await mainWin.webContents.executeJavaScript(`window.KMT_BRIDGE ? KMT_BRIDGE.paths(${JSON.stringify(names)}) : []`); } catch { return []; }
  });
  ipcMain.handle('kmt-dock-state', () => { dock(); return true; });
  ipcMain.handle('kmt-save-settings', (_e, patch) => {
    const { glossaryPath, targetNow: _n, targetAuto: _a, ...rest } = patch;
    const s = { ...loadSettings(), ...rest };
    if (s.target !== 'auto' && !R.TARGETS[s.target]) s.target = 'auto';
    if (glossaryPath !== undefined) setGlossary(s, targetNow(s), glossaryPath);
    saveSettings(s);
    syncTarget(s);
    if (rest.target !== undefined) dock();
    return { settings: view(s), dataDir: dataDir(s), dirs: dirsOf(s), outRoot: outRoot(s), summary: { work: R.summaryData(s.work, false), patch: R.summaryData(s.patchcopy, true) } };
  });
  ipcMain.handle('kmt-summary', () => { const s = loadSettings(); return { work: R.summaryData(s.work, false), patch: R.summaryData(s.patchcopy, true) }; });
  ipcMain.handle('kmt-validate', (_e, custom) => R.validateCustom(custom));
  ipcMain.handle('kmt-defaults', (_e, which, target) => {
    if (which === 'patch') return R.defaultPatchSettings();
    const d = R.defaultSettings();
    d.langs = R.defaultLangsFor(R.TARGETS[target] ? target : targetNow(loadSettings()));
    return d;
  });
  ipcMain.handle('kmt-start', (_e, jobs) => { enqueue(jobs); return state(); });
  ipcMain.handle('kmt-stop', () => { queue = []; if (running) running.stop.flag = true; pushState(); return true; });
  ipcMain.handle('kmt-remove-queued', (_e, id) => { queue = queue.filter((j) => j.id !== id); pushState(); });
  ipcMain.handle('kmt-pick', async (_e, { kind, title, defaultPath, filters }) => {
    const r = await dialog.showOpenDialog(win || undefined, { title, defaultPath, properties: kind === 'folder' ? ['openDirectory'] : kind === 'files' ? ['openFile', 'multiSelections'] : ['openFile'], filters });
    return r.canceled ? null : r.filePaths;
  });
  ipcMain.handle('kmt-open-path', (_e, p) => (p && fs.existsSync(p) ? shell.openPath(p) : 'not found'));
  // a finished job's file: a .mod in FCS (the game folder's forgotten construction set.exe), else its own program
  ipcMain.handle('kmt-open-result', (_e, p) => {
    if (!p || !fs.existsSync(p)) return 'no-file';
    if (!/\.mod$/i.test(p)) { shell.openPath(p); return 'ok'; }
    const g = getGamePath();
    const exe = g ? path.join(g, 'forgotten construction set.exe') : '';
    if (!exe || !fs.existsSync(exe)) return 'no-fcs';
    const child = require('child_process').spawn(exe, [p], { cwd: g, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return 'ok';
  });
  ipcMain.handle('kmt-show-item', (_e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); else if (p && fs.existsSync(path.dirname(p))) shell.openPath(path.dirname(p)); });
  ipcMain.handle('kmt-read-lines', (_e, file) => require('./textfile').readTextLines(file));
  // a custom box saved as txt (UTF-8 with BOM, like KMT's files); the path, or null if cancelled
  ipcMain.handle('kmt-save-text', async (_e, name, text) => {
    const s = loadSettings();
    const r = await dialog.showSaveDialog(win || undefined, { defaultPath: path.join(dataDir(s), name), filters: [{ name: say('텍스트', 'Text'), extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.mkdirSync(path.dirname(r.filePath), { recursive: true });
    fs.writeFileSync(r.filePath, '\ufeff' + text, 'utf8');
    return r.filePath;
  });
  ipcMain.handle('kmt-import-kmt', (_e, folder) => {
    const s = loadSettings();
    const r = importKmt(folder, s);
    saveSettings(s);
    return { ...r, settings: s };
  });
  // backups of a mod, its _KO and its _Patch
  ipcMain.handle('kmt-backups', (_e, mod) => {
    const s = loadSettings();
    const stem = path.basename(mod, path.extname(mod));
    const targets = [mod];
    for (const suf of [R.patchSuffix(targetNow(s)), J.COPY_PATCH_SUFFIX]) targets.push(path.join(outRoot(s), stem + suf, stem + suf + '.mod'));
    return targets.map((t) => ({ target: t, exists: fs.existsSync(t), list: backups.list(t) }));
  });
  ipcMain.handle('kmt-restore', (_e, target, bak) => backups.restore(target, bak));
  // review files
  // the review files: all of them by name and time (nothing read), then what the shown rows need
  ipcMain.handle('kmt-review-files', () => { const s = loadSettings(); return J.reviewFiles({ dataDir: dataDir(s), dirs: dirsOf(s) }); });
  ipcMain.handle('kmt-review-info', (_e, paths) => { const s = loadSettings(); return J.reviewInfo({ dataDir: dataDir(s), dirs: dirsOf(s) }, paths || []); });
  ipcMain.handle('kmt-review-list', () => {
    const s = loadSettings();
    const ctx = { dataDir: dataDir(s), dirs: dirsOf(s) };
    return J.listReviewFiles(ctx).slice(0, 30).map((p) => {
      let meta = {};
      try { meta = J.readReviewFile(p, true).meta; } catch { /* unreadable */ }
      return { path: p, name: path.basename(p), meta };
    });
  });
  ipcMain.handle('kmt-review-read', (_e, file) => J.readReviewFile(file));
  ipcMain.handle('kmt-review-write', (_e, file, meta, entries) => { J.writeReviewFile(file, meta, entries); return true; });
  ipcMain.handle('kmt-review-apply', (_e, meta, entries, mode) => {
    const s = loadSettings();
    const ctx = { log, dataDir: dataDir(s), dirs: dirsOf(s), headers: { patchmod: s.work.header, copypatch: s.patchcopy.header } };
    log('');
    log(say(`==== 번역 검수 → ${mode === 'inplace' ? '원본 모드' : '패치 모드'}: ${path.basename(meta.mod || '')} ====`, `==== Review → ${mode === 'inplace' ? 'original mod' : 'patch mod'}: ${path.basename(meta.mod || '')} ====`));
    try {
      const out = mode === 'patchmod' ? outRoot(s) : '';
      const suf = R.patchSuffix(meta.target || 'ko');
      const existed = mode === 'patchmod' && fs.existsSync(path.join(out, path.basename(meta.mod, '.mod') + suf, path.basename(meta.mod, '.mod') + suf + '.mod'));
      const r = J.applyReview(ctx, meta, entries, mode, s.reviewBackup, out);
      flushLog();
      if (mainWin && !mainWin.isDestroyed() && r.changed) {
        const inMods = mode === 'patchmod' && path.resolve(path.dirname(path.dirname(r.path))).toLowerCase() === path.resolve(modsDir() || '?').toLowerCase();
        toMain('kmt-made-mod', { mode, source: meta.mod, path: r.path, inMods, isNew: mode === 'patchmod' && !existed, route: s.route, activate: s.activate });
      }
      return r;
    } catch (e) { log(say('[오류] ', '[Error] ') + e.message); flushLog(); return { error: e.message }; }
  });
  // review → glossary: the glossary of the language the review file was made for
  ipcMain.handle('kmt-glossary-update', (_e, entries, target) => {
    const s = loadSettings();
    const t = R.TARGETS[target] ? target : targetNow(s);
    const file = glossaryFor(s, t) || path.join(dataDir(s), t === 'ko' ? 'glossary.txt' : `glossary_${t}.txt`);
    const r = G.updateGlossaryFile(file, entries);
    if (!glossaryFor(s, t)) { setGlossary(s, t, file); saveSettings(s); send('kmt-target', view(s)); }
    return r;
  });
}

function setMainWindow(w) { mainWin = w; }
function close() { if (win && !win.isDestroyed()) win.close(); }
// The manager asks something before it quits: the translator steps aside (to the bar), so the
// question isn't hidden under it; it can be brought back from the bar if the quit is cancelled.
function stepAside() {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  if (mainWin && !mainWin.isDestroyed()) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
}

module.exports = { setup, setMainWindow, openWindow, close, stepAside };
