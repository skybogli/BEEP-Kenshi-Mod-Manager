/**
 * -------------------------------------------------------------------
 * BEEP Kenshi Mod Manager - Enhanced Edition (편의 기능 및 번역 도구 추가 버전)
 *
 * 이 프로젝트는 Derthi의 원본 소프트웨어를 기반으로 수정 및 확장되었습니다.
 * -------------------------------------------------------------------
 * Original Work Copyright (c) 2026 Derthi (MIT License)
 * Modified Work Copyright (c) 2026 skybogli (MIT License)
 * -------------------------------------------------------------------
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } = require('electron');
const path = require('path');
const windowState = require('./lib/window-state');
const rekenshi = require('./lib/rekenshi');
const configStore = require('./lib/config-store');
const modDiscovery = require('./lib/mod-discovery');
const loadOrder = require('./lib/load-order');
const steamDetect = require('./lib/steam-detect');
const steamApi = require('./lib/steam-api');
const conflictDetector = require('./lib/conflict-detector');
const updater = require('./lib/updater');
const zoneDiff = require('./lib/zone-diff');
const translate = require('./lib/translate');
const kmt = require('./lib/kmt/service');
const listViewer = require('./lib/list-viewer');

let mainWindow;
// The menu bar always shows unless turned off in View (config.menuBarFixed = false).
let menuBarFixed = true;

function setMenuBarFixed(fixed) {
  menuBarFixed = fixed;
  if (!mainWindow) return;
  mainWindow.setAutoHideMenuBar(!fixed);
  mainWindow.setMenuBarVisibility(fixed);
  mainWindow.webContents.send('menu-bar-changed', fixed);
}
let allowClose = false;
let closeAcked = false;

ipcMain.handle('close-ack', () => { closeAcked = true; });
ipcMain.handle('close-now', () => {
  allowClose = true;
  mainWindow.close();
});
// Detail panel folder buttons.
ipcMain.handle('open-folder', async (_event, dir) => {
  if (!dir || !require('fs').existsSync(dir)) return 'not found';
  return shell.openPath(dir);
});
// Detail panel: open a .mod file in the Forgotten Construction Set (the game's mod editor).
ipcMain.handle('open-in-fcs', (_event, gamePath, file) => {
  const fs = require('fs');
  const exe = gamePath ? path.join(gamePath, 'forgotten construction set.exe') : '';
  if (!exe || !fs.existsSync(exe)) return 'no-fcs';
  if (!file || !fs.existsSync(file)) return 'no-file';
  const child = require('child_process').spawn(exe, [file], { cwd: gamePath, detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return 'ok';
});
// Del key: move mod folders to the Recycle Bin. Only a folder directly inside the game's
// Mods folder or the Workshop content folder is removed (otherwise just the .mod file);
// a Workshop mod's link in the Mods folder goes too.
ipcMain.handle('delete-mod-files', async (_event, { gamePath, steamModsPath, mods }) => {
  const fs = require('fs');
  const norm = (p) => path.resolve(p).toLowerCase();
  const roots = [gamePath && path.join(gamePath, 'Mods'), steamModsPath].filter(Boolean).map(norm);
  const deleted = [];
  const errors = [];
  for (const mod of mods) {
    try {
      const folder = path.dirname(mod.filePath);
      if (!roots.includes(norm(path.dirname(folder)))) throw new Error('not in the Mods / Workshop folder: ' + folder);
      const files = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.mod'));
      // Set aside (undoable), to the Recycle Bin when the app closes: the folder, or just the
      // .mod file when the folder holds others too; a Workshop mod's link in Mods too.
      const items = [files.length > 1 ? { path: mod.filePath, mode: 'suffix' } : { path: folder, mode: 'hold' }];
      if (mod.source === 'steam' && gamePath) {
        const link = path.join(gamePath, 'Mods', getModLinkName(mod.realFile));
        try { if (fs.lstatSync(link).isSymbolicLink()) items.push({ path: link, mode: 'hold' }); } catch { /* no link */ }
      }
      const r = softDel.hide(items);
      if (r.errors.length) throw new Error(r.errors[0].error);
      deleted.push({ filePath: mod.filePath, moved: r.moved });
    } catch (err) {
      errors.push({ filePath: mod.filePath, error: err.message });
    }
  }
  return { deleted, errors };
});
// View → Actual size / Zoom in / Zoom out. Fixed steps so the size reads as a round %;
// the renderer keeps the size in its config and sets it again at start.
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
function setZoom(factor) {
  if (!mainWindow) return;
  const f = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], factor));
  mainWindow.webContents.setZoomFactor(f);
  mainWindow.webContents.send('zoom-changed', f);
}
function stepZoom(dir) {
  if (!mainWindow) return;
  const now = mainWindow.webContents.getZoomFactor();
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > now + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < now - 0.001);
  setZoom(next ?? now);
}
// Settings reset: view size 100%, menu bar shown, then a fresh start of the page.
ipcMain.handle('reset-window', () => {
  // Not setMenuBarFixed(): its notice would make the page save its old settings again.
  menuBarFixed = true;
  if (mainWindow) {
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.setAutoHideMenuBar(false);
    mainWindow.setMenuBarVisibility(true);
  }
  setTimeout(() => mainWindow?.webContents.reload(), 50);
});
ipcMain.handle('set-zoom', (_event, factor) => {
  if (mainWindow && Number(factor) > 0) mainWindow.webContents.setZoomFactor(Math.max(0.5, Math.min(2, Number(factor))));
});
// Detail panel copy icons.
ipcMain.handle('copy-text', (_event, text) => clipboard.writeText(String(text || '')));
ipcMain.handle('read-text', () => clipboard.readText());

// A mod list as one string (lib/list-string.js): the file's bytes in, the same bytes out.
const listString = require('./lib/list-string');
const listStringError = (e) => (e instanceof listString.ListStringError ? { error: e.code, game: e.game } : { error: 'zlib' });
ipcMain.handle('list-str-encode', (_event, text) => listString.encode(Buffer.from(String(text), 'utf8')));
ipcMain.handle('list-str-looks', (_event, text) => listString.looksLike(text));
ipcMain.handle('list-str-decode', (_event, text) => {
  try { return { text: listString.decode(text).toString('utf8') }; } catch (e) { return listStringError(e); }
});
// the restored file, where the user says (never over a file by itself)
ipcMain.handle('list-str-save', async (event, text, defaultName) => {
  let bytes;
  try { bytes = listString.decode(text); } catch (e) { return listStringError(e); }
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow, {
    defaultPath: path.join(app.getPath('documents'), defaultName || 'BEEP-mod-list.txt'),
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try { require('fs').writeFileSync(r.filePath, bytes); } catch (e) { return { error: 'save', message: e.message }; }
  return { path: r.filePath };
});
// Edit-menu Cut / Paste / Select All inside a text field.
ipcMain.handle('native-edit', (event, command) => {
  if (['cut', 'copy', 'paste', 'selectAll'].includes(command)) event.sender[command]();
});

function createWindow() {
  // Last run's size and place (brought back onto a screen if it's off one); first run 1280 × 800.
  const place = windowState.initialBounds(app);
  mainWindow = new BrowserWindow({
    ...(place.x !== undefined ? { x: place.x, y: place.y } : {}),
    width: place.width,
    height: place.height,
    show: false,
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#18181e',
    autoHideMenuBar: !menuBarFixed,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (place.maximized) mainWindow.maximize();
    mainWindow.show();
  });
  windowState.track(mainWindow, app);

  // Closing asks the page first (it may have unsaved load order changes). If the page
  // doesn't answer quickly (crashed or still loading), close anyway.
  mainWindow.webContents.on('render-process-gone', () => { allowClose = true; });
  mainWindow.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    // Open list windows (내보내기 파일 보기) close first, each asking about its own changes.
    if (listViewer.count()) {
      listViewer.closeAll().then((ok) => { if (ok && mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); });
      return;
    }
    closeAcked = false;
    kmt.stepAside(); // the translator window off the question the page may ask
    mainWindow.webContents.send('confirm-close');
    setTimeout(() => {
      if (!closeAcked && !allowClose) {
        allowClose = true;
        mainWindow.close();
      }
    }, 2000);
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Any window.open(url) opens in the user's real browser, never a blank Electron window
  // (the old update "Download" link used window.open and spawned an empty window).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// IPC Handlers

ipcMain.handle('get-config', () => {
  return configStore.loadConfig(app.getPath('userData'));
});

ipcMain.handle('save-config', (_event, config) => {
  configStore.saveConfig(app.getPath('userData'), config);
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('detect-steam', () => {
  return steamDetect.detectKenshiPaths();
});

ipcMain.handle('discover-mods', (_event, config) => {
  return modDiscovery.discoverMods(config.gamePath, config.steamModsPath);
});

ipcMain.handle('save-load-order', (_event, data) => {
  return loadOrder.saveLoadOrder(data.gamePath, data.activeModFilenames);
});

// Mod Packs — stored alongside the app for portability
const packsBasePath = app.isPackaged
  ? path.dirname(app.getPath('exe'))
  : __dirname;

ipcMain.handle('get-packs', () => {
  return configStore.loadPacks(packsBasePath);
});

ipcMain.handle('save-pack', (_event, pack) => {
  configStore.savePack(packsBasePath, pack);
});

ipcMain.handle('delete-pack', (_event, packName) => {
  configStore.deletePack(packsBasePath, packName);
});

// Steam API
ipcMain.handle('fetch-workshop-details', (_event, workshopIds) => {
  return steamApi.fetchWorkshopDetails(workshopIds);
});

// Google Translate (detail panel)
ipcMain.handle('translate-texts', (_event, texts, sourceLang, targetLang) => {
  return translate.translateTexts(texts, sourceLang, targetLang);
});

// Mod database
ipcMain.handle('load-mod-database', () => {
  const fs = require('fs');
  // Look for database in app directory (portable)
  const basePath = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
  const dbPath = path.join(basePath, 'mod-database.json');
  if (!fs.existsSync(dbPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('save-mod-database', (_event, data) => {
  const fs = require('fs');
  const basePath = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
  const dbPath = path.join(basePath, 'mod-database.json');
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  return dbPath;
});

// Open file dialog
ipcMain.handle('open-file-dialog', async (_event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: filters || [{ name: 'Text Files', extensions: ['txt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const fs = require('fs');
  return { path: result.filePaths[0], content: fs.readFileSync(result.filePaths[0], 'utf8') };
});

// Save file dialog
ipcMain.handle('save-file-dialog', async (_event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
  });
  if (result.canceled) return null;
  return result.filePath;
});

ipcMain.handle('write-file', (_event, filePath, content) => {
  const fs = require('fs');
  fs.writeFileSync(filePath, content, 'utf8');
});

// Launch game
// mode: 'rekenshi' (RE_Kenshi's own exe) or 'vanilla' (--norekenshi); lib/rekenshi.js.
ipcMain.handle('launch-game', (_event, gamePath, mode) => {
  const fs = require('fs');
  const { spawn } = require('child_process');

  // Find Kenshi executable
  const candidates = ['kenshi_x64.exe', 'kenshi_GOG_x64.exe', 'kenshi.exe'];
  let exePath = null;
  for (const name of candidates) {
    const p = path.join(gamePath, name);
    if (fs.existsSync(p)) { exePath = p; break; }
  }
  if (!exePath) {
    return { success: false, error: 'Could not find Kenshi executable in ' + gamePath };
  }
  const run = rekenshi.launchSpec(gamePath, mode, exePath);

  if (process.platform === 'linux') {
    // On Linux, launch via Steam (Proton) or directly with Wine
    const steamRunUrl = `steam://rungameid/233860`;
    const { exec } = require('child_process');
    // Try Steam first, fall back to xdg-open
    exec(`xdg-open "${steamRunUrl}"`, { timeout: 5000 }, (err) => {
      if (err) {
        // Fallback: try running the exe directly (may work under Wine/Proton)
        spawn('wine', [run.exe, ...run.args], { detached: true, cwd: gamePath, stdio: 'ignore' }).unref();
      }
    });
  } else {
    const child = spawn(run.exe, run.args, { detached: true, cwd: run.cwd, env: run.env, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  }
  return { success: true };
});

ipcMain.handle('rekenshi-status', (_event, gamePath) => rekenshi.status(gamePath));

// Launch FCS
ipcMain.handle('launch-fcs', (_event, gamePath) => {
  const fs = require('fs');
  const { spawn } = require('child_process');

  // FCS executable name differs by store: Steam = "forgotten construction set.exe", GOG = "FCS_gog.exe"
  const fcsCandidates = ['forgotten construction set.exe', 'FCS_gog.exe'];
  let fcsPath = null;
  for (const name of fcsCandidates) {
    const candidate = path.join(gamePath, name);
    if (fs.existsSync(candidate)) { fcsPath = candidate; break; }
  }
  if (!fcsPath) {
    return { success: false, error: 'Could not find the FCS executable (forgotten construction set.exe or FCS_gog.exe) in ' + gamePath };
  }

  if (process.platform === 'linux') {
    const { exec } = require('child_process');
    // Try Steam launch first (FCS app ID 285220), fall back to Wine
    exec(`xdg-open "steam://rungameid/285220"`, { timeout: 5000 }, (err) => {
      if (err) {
        spawn('wine', [fcsPath], { detached: true, cwd: gamePath, stdio: 'ignore' }).unref();
      }
    });
  } else {
    spawn(fcsPath, [], { detached: true, cwd: gamePath, stdio: 'ignore' }).unref();
  }
  return { success: true };
});

// Open the game's local Mods folder in the file explorer
ipcMain.handle('open-mods-folder', async (_event, gamePath) => {
  const fs = require('fs');
  // Kenshi's folder is "mods" (lowercase); resolve case-insensitively so it works on Linux too
  let modsDir = path.join(gamePath, 'Mods');
  if (!fs.existsSync(modsDir)) {
    try {
      const match = fs.readdirSync(gamePath, { withFileTypes: true })
        .find((e) => e.isDirectory() && e.name.toLowerCase() === 'mods');
      if (match) modsDir = path.join(gamePath, match.name);
    } catch { /* gamePath missing or unreadable */ }
  }
  if (!fs.existsSync(modsDir)) {
    return { success: false, error: 'Mods folder not found in ' + gamePath };
  }
  const err = await shell.openPath(modsDir);
  if (err) return { success: false, error: err };
  return { success: true };
});

// Conflict detection
ipcMain.handle('generate-conflicts', (_event, activeMods, gamePath) => {
  return conflictDetector.detectConflicts(activeMods, gamePath);
});

// Object-level diff of a mod's edited sector against the base game (lazy — on sector click)
ipcMain.handle('diff-sector', (_event, zonePath, gamePath, zx, zy) => {
  try { return zoneDiff.diffSector(zonePath, gamePath, zx, zy); }
  catch { return null; }
});

// Object-level overlap between the mods that contest the same sector (lazy — on conflict-zone click)
ipcMain.handle('diff-sector-conflict', (_event, zonePathsByMod, gamePath, zx, zy) => {
  try { return zoneDiff.diffSectorConflict(zonePathsByMod, gamePath, zx, zy); }
  catch { return null; }
});

// Updater
ipcMain.handle('check-for-update', () => {
  return updater.checkForUpdate();
});

ipcMain.handle('download-update', async (_event, downloadUrl) => {
  const appPath = path.dirname(app.getPath('exe'));
  const result = await updater.downloadAndApplyUpdate(downloadUrl, appPath);
  if (result.success) {
    // Relaunch after a short delay
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 1000);
  }
  return result;
});

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('show-in-folder', (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Relaunch the app with admin privileges
ipcMain.handle('relaunch-as-admin', () => {
  const { spawn } = require('child_process');
  const exePath = app.isPackaged ? app.getPath('exe') : process.argv[0];
  const psArgs = [
    '-Command',
    `Start-Process -FilePath "${exePath}" -Verb RunAs`
  ];
  const child = spawn('powershell.exe', psArgs, { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', () => {}); // ignore spawn errors
  // Give PowerShell a moment to launch the UAC prompt before quitting
  setTimeout(() => app.quit(), 500);
});

// Symlink management for Steam mods → game Mods folder
// Uses mod filename (without .mod extension) as the link folder name,
// matching how the old Kenshi Mod Manager worked and how FCS expects it.

function getModLinkName(modFilename) {
  // "TameBeasties.mod" → "TameBeasties"
  return path.parse(modFilename).name;
}

ipcMain.handle('check-mod-links', (_event, { gamePath, steamMods }) => {
  const fs = require('fs');
  const linkedMods = [];
  for (const mod of steamMods) {
    const linkPath = path.join(gamePath, 'Mods', getModLinkName(mod.filename));
    try {
      if (fs.lstatSync(linkPath).isSymbolicLink()) {
        linkedMods.push(mod.filename);
      }
    } catch {
      // Path doesn't exist — not linked
    }
  }
  return { linkedMods };
});

ipcMain.handle('create-mod-links', (_event, { gamePath, mods }) => {
  const fs = require('fs');
  const modsDir = path.join(gamePath, 'Mods');
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

  const created = [];
  const skipped = [];
  const errors = [];

  for (const mod of mods) {
    const workshopDir = path.dirname(mod.filePath);
    const linkName = getModLinkName(mod.filename);
    const linkPath = path.join(modsDir, linkName);
    try {
      if (fs.existsSync(linkPath)) {
        skipped.push(mod.filename);
        continue;
      }
      // Use 'dir' symlinks (same as old Kenshi Mod Manager) — works with FCS.
      // On Windows this requires admin privileges.
      // On Linux, regular symlinks work without special privileges.
      fs.symlinkSync(workshopDir, linkPath, 'dir');
      created.push(mod.filename);
    } catch (err) {
      if (err.code === 'EPERM' && process.platform === 'win32') {
        return { created, skipped, errors, needsAdmin: true };
      }
      errors.push({ filename: mod.filename, error: err.message });
    }
  }
  return { created, skipped, errors, needsAdmin: false };
});

ipcMain.handle('remove-mod-links', (_event, { gamePath, mods }) => {
  const fs = require('fs');
  const modsDir = path.join(gamePath, 'Mods');
  const removed = [];
  const skipped = [];
  const errors = [];

  for (const mod of mods) {
    const linkName = getModLinkName(mod.filename);
    const linkPath = path.join(modsDir, linkName);
    try {
      const stat = fs.lstatSync(linkPath);
      if (!stat.isSymbolicLink()) {
        skipped.push(mod.filename);
        continue;
      }
      if (process.platform === 'win32') {
        fs.rmSync(linkPath);
      } else {
        fs.unlinkSync(linkPath);
      }
      removed.push(mod.filename);
    } catch (err) {
      if (err.code === 'ENOENT') {
        skipped.push(mod.filename);
      } else {
        errors.push({ filename: mod.filename, error: err.message });
      }
    }
  }
  return { removed, skipped, errors };
});

// Window menu. Electron's default menu is English-only, so the renderer sends
// the labels in the UI language and the menu is rebuilt with them.
function buildAppMenu(labels = {}) {
  const l = (key, fallback) => labels[key] || fallback;
  const open = (url) => () => shell.openExternal(url);
  // Undo/redo go to the renderer, which undoes mod moves (or text edits in a
  // text field). The keys are only shown here; the renderer handles them.
  const send = (command) => () => mainWindow?.webContents.send('menu-command', command);
  // Items: { label, command, checked? } | null (separator) | { heading } (grey) | { label, sub: items }.
  const menuItem = (it) => (!it ? { type: 'separator' }
    : it.heading ? { label: it.heading, enabled: false }
    : it.sub ? { label: it.label, submenu: it.sub.map(menuItem) }
    : it.checked !== undefined ? { label: it.label, type: 'checkbox', checked: it.checked, click: send(it.command) }
    : { label: it.label, click: send(it.command) });
  const template = [
    { label: l('file', 'File'), submenu: labels.fileItems ? labels.fileItems.map(menuItem) : [
      { role: 'quit', label: l('quit', 'Exit') },
    ] },
    // Edit items come from the renderer with their shortcuts written into the labels
    // (Windows would name the keys in its own language); the renderer handles the keys.
    { label: l('edit', 'Edit'), submenu: labels.editItems ? labels.editItems.map(menuItem) : [
      { label: l('undo', 'Undo'), accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: send('undo') },
      { label: l('redo', 'Redo'), accelerator: 'CmdOrCtrl+Y', registerAccelerator: false, click: send('redo') },
    ] },
    ...(labels.moveItems ? [{ label: l('moveMenu', 'Move'), submenu: labels.moveItems.map(menuItem) }] : []),
    { label: l('view', 'View'), submenu: [
      { label: l('reload', 'Reload'), accelerator: 'CmdOrCtrl+R', click: send('reload') },
      { role: 'forceReload', label: l('forceReload', 'Force Reload') },
      { role: 'toggleDevTools', label: l('devTools', 'Toggle Developer Tools') },
      { type: 'separator' },
      { label: l('resetZoom', 'Actual Size'), accelerator: 'CmdOrCtrl+0', click: () => setZoom(1) },
      { label: l('zoomIn', 'Zoom In'), accelerator: 'CmdOrCtrl+=', click: () => stepZoom(1) },
      { label: l('zoomOut', 'Zoom Out'), accelerator: 'CmdOrCtrl+-', click: () => stepZoom(-1) },
      // The same with Shift+= (the + key) and the number pad, not shown.
      { label: 'zoom in +', accelerator: 'CmdOrCtrl+Shift+=', visible: false, click: () => stepZoom(1) },
      { label: 'zoom in num', accelerator: 'CmdOrCtrl+numadd', visible: false, click: () => stepZoom(1) },
      { label: 'zoom out num', accelerator: 'CmdOrCtrl+numsub', visible: false, click: () => stepZoom(-1) },
      { label: 'actual size num', accelerator: 'CmdOrCtrl+num0', visible: false, click: () => setZoom(1) },
      { type: 'separator' },
      { role: 'togglefullscreen', label: l('fullscreen', 'Toggle Full Screen') },
      { type: 'separator' },
      // On: the menu bar always shows; off: it hides and Alt shows it.
      { label: l('menuBar', 'Always Show Menu Bar'), type: 'checkbox', checked: menuBarFixed, click: (item) => setMenuBarFixed(item.checked) },
    ] },
    { label: l('window', 'Window'), submenu: [
      { role: 'minimize', label: l('minimize', 'Minimize') },
      { label: l('zoom', 'Maximize / Restore'), accelerator: 'CmdOrCtrl+Shift+M', click: () => windowState.toggleMaximize(mainWindow) },
      { type: 'separator' },
      // On: the next start opens the window as it was left; off: always the first-run window.
      { label: l('rememberWindow', 'Remember Window Size and Position'), type: 'checkbox', checked: windowState.remembering(app), click: (item) => windowState.setRemember(mainWindow, app, item.checked) },
      { type: 'separator' },
      { role: 'close', label: l('close', 'Close') },
    ] },
    { label: l('help', 'Help'), submenu: [
      // The renderer's items carry the update check and the links (this edition's / the original's).
      ...(labels.helpItems ? labels.helpItems.map(menuItem) : [
        { label: l('github', 'GitHub Page'), click: open('https://github.com/skybogli/BEEP-Kenshi-Mod-Manager') },
      ]),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('set-app-menu', (_event, labels) => {
  buildAppMenu(labels);
});

// Del with undo: files set aside, to the Recycle Bin when the app closes (lib/soft-delete.js).
const softDel = require('./lib/soft-delete')(app.getPath('userData'), shell);
ipcMain.handle('soft-delete', (_event, items) => softDel.hide(items || []));
ipcMain.handle('soft-restore', (_event, moved) => softDel.restore(moved || []));
// Steam's Workshop record: entries of mods whose folder is gone (lib/steam-workshop-record.js).
const steamRecord = require('./lib/steam-workshop-record')(app.getPath('userData'));
ipcMain.handle('steam-forget', (_event, { steamModsPath, ids }) => {
  const fs = require('fs');
  const r = steamRecord.forget(steamModsPath, ids);
  r.present = steamModsPath ? (ids || []).filter((id) => /^\d+$/.test(id) && fs.existsSync(path.join(steamModsPath, id))) : [];
  return r;
});
let softDelFinalized = false;
app.on('before-quit', (e) => {
  if (softDelFinalized || !softDel.pending()) return;
  e.preventDefault();
  softDelFinalized = true;
  softDel.finalize().finally(() => app.quit());
});

app.whenReady().then(() => {
  // A plain Kenshi start from last time that wasn't put back to RE_Kenshi yet.
  rekenshi.restoreAtStart(app.getPath('userData'));
  softDel.finalize(); // left from a crash
  menuBarFixed = configStore.loadConfig(app.getPath('userData'))?.menuBarFixed !== false;
  buildAppMenu();
  createWindow();
  // The translator (번역 · 패치 도구): its own window, opened from the mod menu / File menu.
  kmt.setup({
    userData: app.getPath('userData'),
    icon: path.join(__dirname, 'icon.ico'),
    gamePath: () => configStore.loadConfig(app.getPath('userData'))?.gamePath || '',
    steamModsPath: () => configStore.loadConfig(app.getPath('userData'))?.steamModsPath || '',
    lang: () => configStore.loadConfig(app.getPath('userData'))?.language || 'en',
    mainWindow,
  });
  mainWindow.on('closed', () => kmt.close());
  // An exported list in its own window (lib/list-viewer.js).
  listViewer.setup({ mainWindow, userData: app.getPath('userData'), icon: path.join(__dirname, 'icon.ico'), loadConfig: () => configStore.loadConfig(app.getPath('userData')) });
});

app.on('window-all-closed', () => {
  app.quit();
});
