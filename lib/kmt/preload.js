// The translator window's bridge to the main process (lib/kmt/service.js).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Messages that come before the page has set its handler are kept and handed over then.
const handlers = {};
const waiting = {};
for (const ch of ['kmt-log', 'kmt-progress', 'kmt-state', 'kmt-job-done', 'kmt-idle', 'kmt-request', 'kmt-maxed', 'kmt-lang', 'kmt-target']) {
  ipcRenderer.on(ch, (_e, data) => { if (handlers[ch]) handlers[ch](data); else (waiting[ch] ||= []).push(data); });
}
const on = (ch) => (fn) => {
  handlers[ch] = fn;
  for (const data of waiting[ch] || []) fn(data);
  delete waiting[ch];
};

contextBridge.exposeInMainWorld('kmt', {
  init: () => ipcRenderer.invoke('kmt-init'),
  categories: () => ipcRenderer.invoke('kmt-categories'),
  win: (action, arg) => ipcRenderer.invoke('kmt-win', action, arg),
  resolveMods: (names) => ipcRenderer.invoke('kmt-resolve-mods', names),
  reorder: (paths) => ipcRenderer.invoke('kmt-reorder', paths),
  saveSettings: (patch) => ipcRenderer.invoke('kmt-save-settings', patch),
  summary: () => ipcRenderer.invoke('kmt-summary'),
  validate: (custom) => ipcRenderer.invoke('kmt-validate', custom),
  defaults: (which, target) => ipcRenderer.invoke('kmt-defaults', which, target),
  start: (jobs) => ipcRenderer.invoke('kmt-start', jobs),
  stop: () => ipcRenderer.invoke('kmt-stop'),
  removeQueued: (id) => ipcRenderer.invoke('kmt-remove-queued', id),
  pick: (opts) => ipcRenderer.invoke('kmt-pick', opts),
  openPath: (p) => ipcRenderer.invoke('kmt-open-path', p),
  openResult: (p) => ipcRenderer.invoke('kmt-open-result', p),
  showItem: (p) => ipcRenderer.invoke('kmt-show-item', p),
  readLines: (file) => ipcRenderer.invoke('kmt-read-lines', file),
  saveText: (name, text) => ipcRenderer.invoke('kmt-save-text', name, text),
  importKmt: (folder) => ipcRenderer.invoke('kmt-import-kmt', folder),
  backups: (mod) => ipcRenderer.invoke('kmt-backups', mod),
  restore: (target, bak) => ipcRenderer.invoke('kmt-restore', target, bak),
  reviewList: () => ipcRenderer.invoke('kmt-review-list'),
  reviewFiles: () => ipcRenderer.invoke('kmt-review-files'),
  reviewInfo: (paths) => ipcRenderer.invoke('kmt-review-info', paths),
  reviewRead: (file) => ipcRenderer.invoke('kmt-review-read', file),
  reviewWrite: (file, meta, entries) => ipcRenderer.invoke('kmt-review-write', file, meta, entries),
  reviewApply: (meta, entries, mode) => ipcRenderer.invoke('kmt-review-apply', meta, entries, mode),
  glossaryUpdate: (entries, target) => ipcRenderer.invoke('kmt-glossary-update', entries, target),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  pathOf: (file) => webUtils.getPathForFile(file),
  onLog: on('kmt-log'),
  onProgress: on('kmt-progress'),
  onState: on('kmt-state'),
  onJobDone: on('kmt-job-done'),
  onIdle: on('kmt-idle'),
  onRequest: on('kmt-request'),
  onMaxed: on('kmt-maxed'),
  onLang: on('kmt-lang'),
  onTarget: on('kmt-target'),
});
