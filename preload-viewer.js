// The page of a list window (lib/list-viewer.js): the same window.api as preload.js, but nothing
// reaches the game or my own settings — the config and the mod list come from the file and the
// main window, saves go nowhere, launching / links / deleting / packs / the translator are off.
// Reading (Workshop details, opening pages, the mod's folder) works as in the main window.
const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const none = (value) => async () => value;
const id = (process.argv.find((a) => a.startsWith('--vw-id=')) || '').slice(8);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  vwId: id, // (this page is a list window)
  // from the file / the main window
  getConfig: inv('vw-config'),
  // a refresh keeps what the page has now (config.__vwLive), or the file's on / off at the start
  discoverMods: (config) => ipcRenderer.invoke('vw-discover', config && config.__vwLive ? config.__vwLive : null),
  // saving: nowhere (the window's own "다른 이름으로 저장" is vwSaveAs)
  saveConfig: none(true),
  saveLoadOrder: none({ success: true }),
  detectSteam: none({}),
  pickFolder: none(null),
  getPacks: none([]),
  savePack: none(true),
  deletePack: none(true),
  fetchWorkshopDetails: inv('fetch-workshop-details'),
  translateTexts: inv('translate-texts'),
  loadModDatabase: inv('load-mod-database'),
  saveModDatabase: none(''),
  openFileDialog: none(null),
  // the advanced export's string, saved where the user says
  saveFileDialog: inv('vw-save-dialog'),
  writeFile: inv('write-file'),
  listStrEncode: inv('list-str-encode'),
  generateConflicts: none(null),
  diffSector: none(null),
  diffSectorConflict: none(null),
  checkForUpdate: none(null),
  downloadUpdate: none({ success: false }),
  launchGame: none({ success: false }),
  rekenshiStatus: none({ installed: false }),
  launchFcs: none({ success: false }),
  openModsFolder: none({ success: false }),
  openExternal: inv('open-external'),
  showInFolder: inv('show-in-folder'),
  checkModLinks: none({ linkedMods: [] }),
  createModLinks: none({ success: false }),
  removeModLinks: none({ success: false }),
  relaunchAsAdmin: none(null),
  setAppMenu: none(null),
  onMenuCommand: () => {},
  onZoomChanged: () => {},
  onMenuBarChanged: () => {},
  setZoom: inv('vw-zoom'),
  nativeEdit: inv('native-edit'),
  onConfirmClose: () => {},
  closeAck: none(null),
  closeNow: none(null),
  openFolder: inv('open-folder'),
  openInFcs: none(null),
  copyText: inv('copy-text'),
  resetWindow: none(null),
  softDelete: none({ moved: [] }),
  softRestore: none({ restored: [] }),
  deleteModFiles: none({ deleted: [], errors: [] }),
  steamForget: none({ removed: [], present: [], steamRunning: false }),
  kmtOpen: none(false),
  onKmtMadeMod: () => {},
  onKmtDock: () => {},
  kmtDockClick: none(null),
  kmtDockState: none(null),
  kmtMainDialog: none(null),
  kmtLang: none(null),
  // the list window's own
  vwMyState: inv('vw-my-state'),
  vwSaveAs: inv('vw-save-as'),
  vwWin: inv('vw-win'),
  vwSubscribe: inv('vw-subscribe'),
  vwImport: inv('vw-import'),
  onVwConfirmClose: (cb) => ipcRenderer.on('vw-confirm-close', () => cb()),
  vwCloseAck: inv('vw-close-ack'),
  vwCloseNow: inv('vw-close-now'),
  vwCloseCancel: inv('vw-close-cancel'),
});
