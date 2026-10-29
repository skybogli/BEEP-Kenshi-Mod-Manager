// State
let mods = [];
let selectedMod = null;
let config = null;
let categories = []; // { id, name, color, order }
let modCategories = {}; // filename -> categoryId
let modOrders = {}; // categoryId -> [filename, ...]
let verticalLayout = false;
let conflictData = null; // { modConflicts, totalConflicts, parseErrors }
let selectedMods = new Set(); // multi-select filenames
let lastClickedMod = null; // for shift-click range select
let uncategorizedPinned = false;
let tutorialDismissed = false;
let minimizedCategories = new Set();
const DEFAULT_MAP_ZOOM_SPEED = 0.1;       // half of the original 0.2 per wheel notch
const DEFAULT_COLUMN_SCROLL_SPEED = 0.5;  // half of the original 1.0x deltaY
let mapZoomSpeed = DEFAULT_MAP_ZOOM_SPEED;
let columnScrollSpeed = DEFAULT_COLUMN_SCROLL_SPEED;
let justMovedMods = new Set();
let linkedMods = new Set(); // steam mods with active symlinks in game folder

const UNCATEGORIZED = 'uncategorized';

// Which mods a dependency name means. The name is matched to the mod's file name
// exactly ("Hats" or "Hats.mod" -> Hats.mod); only when no mod has that exact name does
// it fall back to a case-insensitive substring match (as Kenshi Mod Manager did). A plain
// substring match alone would make "Blot Ration Packs" match "Storages for Blot Ration Packs".
function depBaseName(name) {
  return name.toLowerCase().replace(/\.mod$/, '');
}

function depCandidates(dep) {
  const want = depBaseName(dep);
  const real = mods.filter((m) => !m.missing); // placeholders for missing mods don't count
  const exact = real.filter((m) => depBaseName(m.realFile) === want);
  if (exact.length) return exact;
  return real.filter((m) => m.realFile.toLowerCase().includes(dep.toLowerCase()));
}

// Check if a dependency is satisfied. Only active mods count by default.
function isDepInstalled(dep, activeOnly = true) {
  return depCandidates(dep).some((m) => !activeOnly || m.active);
}

function findDepMod(dep) {
  const found = depCandidates(dep);
  return found.find((m) => m.active) || found[0];
}

// Does `mod` list `target` as a dependency or reference?
function needsMod(mod, target) {
  return (mod.dependencies || []).concat(mod.references || []).some((d) => depCandidates(d).includes(target));
}

// ===== Modal Prompt (replaces window.prompt) =====

function showInputModal(title, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('input-modal');
    const input = document.getElementById('input-modal-input');
    const okBtn = document.getElementById('input-modal-ok');
    const cancelBtn = document.getElementById('input-modal-cancel');
    const titleEl = document.getElementById('input-modal-title');

    titleEl.textContent = title;
    input.value = defaultValue || '';
    overlay.classList.remove('hidden');
    input.focus();
    input.select();

    function cleanup() {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }

    function onOk() {
      cleanup();
      resolve(input.value);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onKey(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function showConfirmModal(title) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('input-modal');
    const input = document.getElementById('input-modal-input');
    const okBtn = document.getElementById('input-modal-ok');
    const cancelBtn = document.getElementById('input-modal-cancel');
    const titleEl = document.getElementById('input-modal-title');

    titleEl.textContent = title;
    input.classList.add('hidden');
    overlay.classList.remove('hidden');
    okBtn.focus();

    function cleanup() {
      overlay.classList.add('hidden');
      input.classList.remove('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    }

    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// DOM refs
const setupScreen = document.getElementById('setup-screen');
const mainScreen = document.getElementById('main-screen');
const gamePathInput = document.getElementById('game-path-input');
const steamPathInput = document.getElementById('steam-path-input');
const gamePathBtn = document.getElementById('game-path-btn');
const steamPathBtn = document.getElementById('steam-path-btn');
const continueBtn = document.getElementById('setup-continue-btn');
const columnsContainer = document.getElementById('category-columns');
const modCount = document.getElementById('mod-count');
const statusBar = document.getElementById('status-bar');
const refreshBtn = document.getElementById('refresh-btn');
const saveBtn = document.getElementById('save-btn');
const detailPanel = document.getElementById('detail-panel');
const detailContent = document.getElementById('detail-content');
const addCategoryBtn = document.getElementById('add-category-btn');
const colorPicker = document.getElementById('color-picker');

// ===== Setup Screen =====

const autoDetectBtn = document.getElementById('auto-detect-btn');
const autoDetectStatus = document.getElementById('auto-detect-status');

async function autoDetect() {
  autoDetectStatus.textContent = t('detect.searching');
  autoDetectStatus.className = 'auto-detect-status';
  autoDetectBtn.disabled = true;
  try {
    const result = await window.api.detectSteam();
    if (result && result.gamePath) {
      gamePathInput.value = result.gamePath;
      if (result.steamModsPath) steamPathInput.value = result.steamModsPath;
      const source = result.steamModsPath ? t('detect.sourceSteam') : t('detect.sourceGog');
      autoDetectStatus.textContent = t('detect.found', { source });
      autoDetectStatus.className = 'auto-detect-status success';
      updateContinueBtn();
    } else {
      autoDetectStatus.textContent = t('detect.notFound');
      autoDetectStatus.className = 'auto-detect-status error';
    }
  } catch {
    autoDetectStatus.textContent = t('detect.failed');
    autoDetectStatus.className = 'auto-detect-status error';
  }
  autoDetectBtn.disabled = false;
}

autoDetectBtn.addEventListener('click', autoDetect);

gamePathBtn.addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (folder) { gamePathInput.value = folder; updateContinueBtn(); }
});

steamPathBtn.addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (folder) steamPathInput.value = folder;
});

document.getElementById('steam-path-clear-btn').addEventListener('click', () => {
  steamPathInput.value = '';
});

function updateContinueBtn() {
  continueBtn.disabled = !gamePathInput.value;
}

continueBtn.addEventListener('click', async () => {
  config.gamePath = gamePathInput.value;
  config.steamModsPath = steamPathInput.value || '';
  await persistConfig();
  newSetup = true; // (Uncategorized's 🚫 default: editing.js initNoLoad)
  showMainScreen();
  showTutorialFirst();
});
// Every start (and after the first folder setup) the right panel shows the tutorial; the first mod
// picked goes to its details (editing.js redrawSelection).
let tutorialUntilPick = false;
function showTutorialFirst() {
  if (document.body.classList.contains('vw')) return; // a list viewer window has no tutorial tab
  switchTab(tabTutorial);
  tutorialUntilPick = true;
}

// ===== Main Screen =====

async function showMainScreen() {
  setupScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  await loadMods();
}

async function loadMods() {
  updateLaunchButton(); // RE_Kenshi there or not (the game folder may have changed)
  setStatus(t('status.loading'));
  orderPanelKey = null; // dependencies may have changed: the load-order list is drawn anew (editing.js)
  try {
    // Copies with the same file name each get their own key (see editing.js).
    BOOT.step(25, t('boot.scan'));
    mods = assignModKeys(await window.api.discoverMods(config));
    BOOT.step(60, t('boot.found', { count: mods.length }));
    noteNewlyInstalled(); // ghost cards (editing.js) whose mod is there now
    MARKS.scan(); // 🆕 ⟳ 🌐 (editing.js)
    applyCategoriesToMods();

    // Check symlink status for steam mods
    const steamMods = mods.filter(m => m.source === 'steam');
    if (steamMods.length > 0 && config.gamePath) {
      try {
        const linkResult = await window.api.checkModLinks({
          gamePath: config.gamePath,
          steamMods: steamMods.map(m => ({ filename: m.realFile, filePath: m.filePath }))
        });
        linkedMods = new Set(linkResult.linkedMods);
      } catch {
        linkedMods.clear();
      }
    } else {
      linkedMods.clear();
    }

    // Preserve mods.cfg load order for uncategorized mods on first load
    if (!modOrders[UNCATEGORIZED] || modOrders[UNCATEGORIZED].length === 0) {
      const uncatMods = mods.filter((m) => m.category === UNCATEGORIZED);
      // Sort by mods.cfg order (active mods first in load order, then inactive)
      uncatMods.sort((a, b) => {
        if (a.order >= 0 && b.order >= 0) return a.order - b.order;
        if (a.order >= 0) return -1;
        if (b.order >= 0) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
      modOrders[UNCATEGORIZED] = uncatMods.map((m) => m.filename);
    }

    // mods.cfg as read is the actual order; pins explain where it differs from the categories.
    const cfgOrder = [...new Set(mods.filter((m) => m.active && m.order >= 0).sort((a, b) => a.order - b.order).map((m) => m.filename))];
    initNoLoad(); // 🚫 categories (editing.js)
    initLoadOrder(cfgOrder);

    selectedMod = null;
    BOOT.step(85, t('boot.draw'));
    renderColumns();
    const activeCount = mods.filter((m) => m.active).length;
    modCount.textContent = t('modCount', { total: mods.length, active: activeCount });

    updateDepStatus();
    if (noLoadNotice) { noLoadNotice = false; setStatus(t('noLoad.firstRun')); }
    resetHistoryBaseline();
    // mods.cfg as read: what "unsaved changes" are measured against.
    markSaved(cfgOrder);
    forgetSteamRecords(); // Steam's record of Workshop mods whose folder is gone (editing.js)
  } catch (err) {
    setStatus(t('status.loadError', { error: err.message }), 'error');
  }
  BOOT.done();
}

function applyCategoriesToMods() {
  for (const mod of mods) {
    const catId = modCategories[mod.filename];
    if (catId && (catId === UNCATEGORIZED || categories.find((c) => c.id === catId))) {
      mod.category = catId;
    } else {
      mod.category = UNCATEGORIZED;
    }
  }
}

refreshBtn.addEventListener('click', loadMods);

// Global search — filters mod cards across all categories (skips pinned panel)
const globalSearchInput = document.getElementById('global-search-input');
globalSearchInput.addEventListener('input', () => {
  const query = globalSearchInput.value.toLowerCase();
  const pinnedEl = document.getElementById('pinned-uncat-panel');
  // Filter mod cards
  document.querySelectorAll('.mod-card').forEach((card) => {
    if (pinnedEl && pinnedEl.contains(card)) return;
    const name = card.querySelector('.card-name');
    const text = name ? name.textContent.toLowerCase() : '';
    card.style.display = text.includes(query) ? '' : 'none';
  });
  // Hide categories with no visible mods
  document.querySelectorAll('#category-columns .category-column').forEach((col) => {
    const visibleCards = col.querySelectorAll('.mod-card:not([style*="display: none"])');
    col.style.display = (query && visibleCards.length === 0) ? 'none' : '';
  });
});

const settingsBtn = document.getElementById('settings-btn');
settingsBtn.addEventListener('click', () => {
  gamePathInput.value = config.gamePath || '';
  steamPathInput.value = config.steamModsPath || '';
  autoDetectStatus.textContent = '';
  autoDetectStatus.className = 'auto-detect-status';
  updateContinueBtn();
  mainScreen.classList.add('hidden');
  setupScreen.classList.remove('hidden');
});

// Layout toggle
const layoutToggleBtn = document.getElementById('layout-toggle-btn');
layoutToggleBtn.addEventListener('click', () => {
  verticalLayout = !verticalLayout;
  columnsContainer.classList.toggle('vertical', verticalLayout);
  layoutToggleBtn.title = verticalLayout ? t('layout.switchHorizontal') : t('layout.switchVertical');
  renderColumns();
});

// Theme toggle
const themeToggleCb = document.getElementById('theme-toggle-cb');
themeToggleCb.addEventListener('change', () => {
  document.body.classList.toggle('kenshi-theme', themeToggleCb.checked);
  persistConfig();
});

// Tutorial modal
const tutorialModal = document.getElementById('tutorial-modal');
const tutorialOkBtn = document.getElementById('tutorial-ok-btn');
const tutorialDismissCb = document.getElementById('tutorial-dismiss-cb');

tutorialOkBtn.addEventListener('click', () => {
  tutorialModal.classList.add('hidden');
  if (tutorialDismissCb.checked) {
    tutorialDismissed = true;
    persistConfig();
  }
});

const tutorialShowBtn = document.getElementById('tutorial-show-btn');
tutorialShowBtn.addEventListener('click', () => {
  tutorialModal.classList.add('hidden');
  if (tutorialDismissCb.checked) {
    tutorialDismissed = true;
    persistConfig();
  }
  switchTab(tabTutorial);
});

document.getElementById('tutorial-folder-setup-btn').addEventListener('click', () => {
  tutorialModal.classList.add('hidden');
  settingsBtn.click();
});

// GitHub link
document.getElementById('github-btn').addEventListener('click', () => {
  window.api.openExternal('https://github.com/skybogli/BEEP-Kenshi-Mod-Manager');
});

// Pin Uncategorized toggle
const pinUncatBtn = document.getElementById('pin-uncat-btn');
pinUncatBtn.addEventListener('click', () => {
  uncategorizedPinned = !uncategorizedPinned;
  pinUncatBtn.classList.toggle('btn-pinned-active', uncategorizedPinned);
  pinUncatBtn.textContent = uncategorizedPinned ? t('toolbar.unpinUncat') : t('toolbar.pinUncat');
  persistConfig();
  renderColumns();
});

// ===== Panel Resize =====

const resizeHandle = document.getElementById('panel-resize-handle');
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.querySelectorAll('webview').forEach((wv) => wv.style.pointerEvents = 'none');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const contentRect = document.querySelector('.content').getBoundingClientRect();
  let newWidth = contentRect.right - e.clientX;
  if (newWidth < 100) newWidth = 100;
  if (newWidth > contentRect.width - 100) newWidth = contentRect.width - 100;
  detailPanel.style.width = newWidth + 'px';
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.querySelectorAll('webview').forEach((wv) => wv.style.pointerEvents = '');
  }
});

// ===== Pinned Panel Resize =====

const pinnedResizeHandle = document.getElementById('pinned-resize-handle');
const pinnedPanel = document.getElementById('pinned-uncat-panel');
let isPinnedResizing = false;

pinnedResizeHandle.addEventListener('mousedown', (e) => {
  isPinnedResizing = true;
  pinnedResizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.querySelectorAll('webview').forEach((wv) => wv.style.pointerEvents = 'none');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isPinnedResizing) return;
  const panelRect = pinnedPanel.getBoundingClientRect();
  let newWidth = e.clientX - panelRect.left;
  if (newWidth < 150) newWidth = 150;
  if (newWidth > 500) newWidth = 500;
  pinnedPanel.style.width = newWidth + 'px';
});

document.addEventListener('mouseup', () => {
  if (isPinnedResizing) {
    isPinnedResizing = false;
    pinnedResizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.querySelectorAll('webview').forEach((wv) => wv.style.pointerEvents = '');
  }
});

// Scroll wheel support: the wheel scrolls the category list under the cursor
// vertically; over a header, a list with nothing to scroll, or with Shift held,
// it scrolls the columns horizontally instead.
columnsContainer.addEventListener('wheel', (e) => {
  if (verticalLayout) return;
  const list = e.shiftKey ? null : e.target.closest('.column-mods');
  if (list && list.scrollHeight > list.clientHeight) {
    e.preventDefault();
    list.scrollTop += e.deltaY * columnScrollSpeedV;
    return;
  }
  e.preventDefault();
  columnsContainer.scrollLeft += (e.deltaY || e.deltaX) * columnScrollSpeed;
}, { passive: false });

// ===== Drag Auto-Scroll =====

let dragMouseX = -1;
let dragMouseY = -1;
let dragScrollInterval = null;

function onDragMove(e) {
  dragMouseX = e.clientX;
  dragMouseY = e.clientY;
}

function scrollTick() {
  const edge = 50;
  const speed = 6;
  const x = dragMouseX;
  const y = dragMouseY;

  if (x < 0 || y < 0) return; // no mouse position yet

  // Scroll the columns container
  const rect = columnsContainer.getBoundingClientRect();
  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
    if (verticalLayout) {
      if (y - rect.top < edge) columnsContainer.scrollTop -= speed;
      else if (rect.bottom - y < edge) columnsContainer.scrollTop += speed;
    } else {
      if (x - rect.left < edge) columnsContainer.scrollLeft -= speed;
      else if (rect.right - x < edge) columnsContainer.scrollLeft += speed;
    }
  }

  // Scroll individual column mod lists
  for (const col of document.querySelectorAll('.column-mods')) {
    const cr = col.getBoundingClientRect();
    if (x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) {
      if (y - cr.top < edge) col.scrollTop -= speed;
      else if (cr.bottom - y < edge) col.scrollTop += speed;
    }
  }
}

function stopDragAutoScroll() {
  document.removeEventListener('dragover', onDragMove);
  if (dragScrollInterval) { clearInterval(dragScrollInterval); dragScrollInterval = null; }
  dragMouseX = -1;
  dragMouseY = -1;
}

document.addEventListener('dragstart', () => {
  stopDragAutoScroll();
  document.addEventListener('dragover', onDragMove);
  dragScrollInterval = setInterval(scrollTick, 16);
});
// A drop re-renders the columns and removes the dragged card, so its dragend
// never bubbles up to document. Stop on drop (capture runs before the drop
// handlers re-render) as well, or the timer keeps scrolling to the last
// pointer position and fights the user's own scrolling.
document.addEventListener('drop', stopDragAutoScroll, true);
document.addEventListener('dragend', stopDragAutoScroll);

saveBtn.addEventListener('click', async () => {
  const ordered = computeLoadOrder();
  setStatus(t('status.saving'));
  const result = await window.api.saveLoadOrder({
    gamePath: config.gamePath,
    activeModFilenames: loadOrderFiles(),
  });
  if (result.success) {
    markSaved(ordered);
    newlyInstalled = new Set();
    setStatus(t('status.saved'), 'success');
    autoPackAfterSave();
  } else {
    setStatus(t('status.saveError', { error: result.error }), 'error');
  }
});

// Play button — save load order then launch game
const playBtn = document.getElementById('play-btn');
const playMore = document.getElementById('play-more');

// ===== Launch: RE_Kenshi or plain Kenshi =====
// With RE_Kenshi installed the button has a ▾: launch either way once, or change which one the
// button itself starts (config.launchMode). Without it, the button just starts the game.
let reKenshiInstalled = false;

function launchMode() {
  return reKenshiInstalled ? (config.launchMode === 'vanilla' ? 'vanilla' : 'rekenshi') : null;
}

async function updateLaunchButton() {
  reKenshiInstalled = !!config?.gamePath && (await window.api.rekenshiStatus(config.gamePath)).installed;
  playMore.classList.toggle('hidden', !reKenshiInstalled);
  const mode = launchMode();
  document.getElementById('play-label').textContent = t(!mode ? 'toolbar.play' : mode === 'vanilla' ? 'play.runVanilla' : 'play.runRe');
}

function showLaunchMenu(x, y) {
  const mode = launchMode();
  POP.open([
    { text: '▶ ' + t('play.runRe'), fn: () => launchGame('rekenshi') },
    { text: '▶ ' + t('play.runVanilla'), fn: () => launchGame('vanilla') },
    'sep',
    { heading: t('play.defaultHead') },
    { text: t('play.re'), check: mode === 'rekenshi', fn: () => setLaunchMode('rekenshi') },
    { text: t('play.vanilla'), check: mode === 'vanilla', fn: () => setLaunchMode('vanilla') },
  ], x, y);
}

function setLaunchMode(mode) {
  config.launchMode = mode;
  persistConfig();
  updateLaunchButton();
}

playMore.addEventListener('click', () => {
  const r = playBtn.getBoundingClientRect();
  showLaunchMenu(r.left, r.bottom + 2);
});
playBtn.addEventListener('contextmenu', (e) => {
  if (!reKenshiInstalled) return;
  e.preventDefault();
  showLaunchMenu(e.clientX, e.clientY);
});
playBtn.addEventListener('click', () => launchGame(launchMode()));

async function launchGame(mode) {
  // Plain Kenshi with mods on that need RE_Kenshi: ask first.
  if (mode === 'vanilla') {
    const need = mods.filter((m) => m.active && !m.missing && modTags(m).includes('RE_Kenshi'));
    if (need.length) {
      const list = need.slice(0, 12).map((m) => '• ' + m.displayName).join('\n') + (need.length > 12 ? '\n…' : '');
      const choice = await choiceModal(t('play.needReTitle'), t('play.needReText', { count: need.length, list }), [
        { key: 'cancel', text: t('modal.cancel') }, { key: 'run', text: t('play.needReRun'), primary: true }]);
      if (choice !== 'run') return;
    }
  }
  // Save first
  const ordered = computeLoadOrder();
  setStatus(t('status.launching'));
  const saveResult = await window.api.saveLoadOrder({
    gamePath: config.gamePath,
    activeModFilenames: loadOrderFiles(),
  });
  if (!saveResult.success) {
    setStatus(t('status.saveError', { error: saveResult.error }), 'error');
    return;
  }
  markSaved(ordered);
  autoPackAfterSave();

  const launchResult = await window.api.launchGame(config.gamePath, mode);
  if (launchResult.success) {
    setStatus(t(mode === 'vanilla' ? 'play.launchedVanilla' : mode === 'rekenshi' ? 'play.launchedRe' : 'status.launched'), 'success');
  } else {
    setStatus(t('status.launchError', { error: launchResult.error }), 'error');
  }
}

// FCS button — launch Forgotten Construction Set
document.getElementById('fcs-btn').addEventListener('click', async () => {
  setStatus(t('status.launchingFcs'));
  const result = await window.api.launchFcs(config.gamePath);
  if (result.success) {
    setStatus(t('status.fcsLaunched'), 'success');
  } else {
    setStatus(t('status.fcsError', { error: result.error }), 'error');
  }
});

// Mods Folder button — open game Mods directory
document.getElementById('mods-folder-btn').addEventListener('click', async () => {
  setStatus(t('status.openingModsFolder'));
  const result = await window.api.openModsFolder(config.gamePath);
  if (result.success) {
    setStatus(t('status.modsFolderOpened'), 'success');
  } else {
    setStatus(t('status.modsFolderError', { error: result.error }), 'error');
  }
});

// Link Steam mods into the game's Mods folder, or unlink them (the toolbar's Link all /
// Unlink all, and the category menu for a category's mods).
async function linkModsToGame(steamMods) {
  if (steamMods.length === 0) {
    setStatus(t('status.allLinked'), 'success');
    return;
  }

  setStatus(t('status.creatingLinks', { count: steamMods.length }));
  try {
    const result = await window.api.createModLinks({
      gamePath: config.gamePath,
      mods: steamMods.map(m => ({ filename: m.realFile, filePath: m.filePath }))
    });
    if (result.needsAdmin) {
      setStatus(t('status.linksNeedAdmin'), 'error');
      const restart = confirm(t('confirm.adminRelaunch'));
      if (restart) window.api.relaunchAsAdmin();
      return;
    }
    for (const fn of result.created) linkedMods.add(fn);
    renderColumns();
    if (result.errors.length > 0) {
      setStatus(t('status.linksPartial', { count: result.created.length, errors: result.errors.length }), 'error');
    } else {
      setStatus(t('status.linksCreated', { count: result.created.length }), 'success');
    }
  } catch (err) {
    setStatus(t('status.linkError', { error: err.message }), 'error');
  }
}

async function unlinkModsFromGame(linkedSteamMods) {
  if (linkedSteamMods.length === 0) {
    setStatus(t('status.noLinks'), 'success');
    return;
  }

  setStatus(t('status.removingLinks', { count: linkedSteamMods.length }));
  try {
    const result = await window.api.removeModLinks({
      gamePath: config.gamePath,
      mods: linkedSteamMods.map(m => ({ filename: m.realFile, filePath: m.filePath }))
    });
    for (const fn of result.removed) linkedMods.delete(fn);
    renderColumns();
    if (result.errors.length > 0) {
      setStatus(t('status.unlinksPartial', { count: result.removed.length, errors: result.errors.length }), 'error');
    } else {
      setStatus(t('status.linksRemoved', { count: result.removed.length }), 'success');
    }
  } catch (err) {
    setStatus(t('status.linkError', { error: err.message }), 'error');
  }
}

// Link All — create symlinks for all Steam mods
document.getElementById('link-all-btn').addEventListener('click', () =>
  linkModsToGame(mods.filter(m => m.source === 'steam' && !linkedMods.has(m.realFile))));

// Unlink All — remove all symlinks from game Mods folder
document.getElementById('unlink-all-btn').addEventListener('click', () =>
  unlinkModsFromGame(mods.filter(m => m.source === 'steam' && linkedMods.has(m.realFile))));

// ===== Conflict Detection =====

const generateConflictsBtn = document.getElementById('generate-conflicts-btn');

async function runConflictCheck() {
  const ordered = computeLoadOrder();
  const seenReal = new Set();
  const activeMods = ordered.map((filename) => {
    const mod = mods.find((m) => m.filename === filename);
    if (!mod || seenReal.has(mod.realFile)) return null;
    seenReal.add(mod.realFile);
    return { filename: mod.realFile, filePath: mod.filePath };
  }).filter(Boolean);

  if (activeMods.length === 0) {
    setStatus(t('status.noActiveMods'), 'error');
    return;
  }

  setStatus(t('status.scanning', { count: activeMods.length }));
  generateConflictsBtn.disabled = true;

  try {
    conflictData = await withBusy(t('busy.conflicts', { count: activeMods.length }), () => window.api.generateConflicts(activeMods, config.gamePath));
    const conflictModCount = Object.keys(conflictData.modConflicts).length;
    if (conflictData.totalConflicts > 0) {
      setStatus(t('status.conflictsFound', { conflicts: conflictData.totalConflicts, mods: conflictModCount }), 'error');
    } else {
      setStatus(t('status.noConflicts'), 'success');
    }
    renderColumns(); // re-render to show conflict indicators
  } catch (err) {
    setStatus(t('status.conflictError', { error: err.message }), 'error');
  }

  generateConflictsBtn.disabled = false;
}

generateConflictsBtn.addEventListener('click', runConflictCheck);

// ===== Export / Import Mod List =====

const exportListBtn = document.getElementById('export-list-btn');
const importListBtn = document.getElementById('import-list-btn');

// What an export holds. The Export button (and Ctrl+E) takes everything; Advanced export
// (a long press, ▾, Ctrl+Shift+E) chooses: scope 'all' | 'active' | 'selected'; missing —
// mods that aren't installed too; cats — the categories and places (else one plain list);
// emptyCats — categories with none of the mods; pins — the actual load order (📌); memo — the
// mods' 📝 notes (off unless chosen: they're the user's own).
const EXPORT_ALL = { scope: 'all', missing: true, cats: true, emptyCats: true, pins: true, memo: false };

// A mod as it is meant to be: one that isn't installed counts as it should be once installed.
function exportIsOn(mod) {
  return mod.missing ? ghostStore()[mod.realFile]?.on !== false : mod.active;
}

function exportInScope(m, o) {
  return (o.missing || !m.missing)
    && (o.scope === 'active' ? exportIsOn(m) : o.scope === 'selected' ? selectedMods.has(m.filename) : true);
}

function buildExportText(o = EXPORT_ALL) {
  const inScope = (m) => exportInScope(m, o);
  const lines = ['# BEEP Kenshi Mod Manager - Mod List Export', '# Format: [Category] then filename|active/inactive', ''];
  const line = (mod) => {
    // name|state, and |source:folder for a second copy of a name (older versions ignore it)
    const copy = mod.filename !== mod.realFile ? '|' + mod.filename.split('::')[1] : '';
    // (a mod in a 🚫 category: the on it keeps for when it leaves; the data line names those categories)
    return `${mod.realFile}|${exportIsOn(mod) || mod.parked ? 'active' : 'inactive'}${copy}`;
  };
  const listed = [];
  let catCount = 0;
  if (o.cats) {
    for (const cat of orderedCatIds().map(catById)) {
      const catMods = getModsForCategory(cat.id).filter(inScope);
      if (!catMods.length && !o.emptyCats) continue;
      catCount++;
      lines.push(`[${cat.id === UNCATEGORIZED ? 'Uncategorized' : cat.name}]`);
      for (const mod of catMods) { lines.push(line(mod)); listed.push(mod); }
      lines.push('');
    }
  } else {
    // One plain list (the import reads it without categories: "Mods only").
    lines.push('[Uncategorized]');
    for (const id of orderedCatIds()) for (const mod of getModsForCategory(id).filter(inScope)) { lines.push(line(mod)); listed.push(mod); }
    lines.push('');
  }
  lines.push(exportDataLine(listed, o)); // actual order + Workshop ids (a comment line for older versions)
  return {
    text: lines.join('\n'),
    mods: listed.length,
    on: listed.filter(exportIsOn).length,
    cats: o.cats ? catCount : 0,
    missing: listed.filter((m) => m.missing).length,
  };
}

async function exportList(o = EXPORT_ALL) {
  // BEEP-mod-list_YYMMDD_HHMMSS.txt
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${p2(d.getFullYear() % 100)}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const suffix = o.scope === 'all' ? '' : t('exp.fileSuffix.' + o.scope);
  const filePath = await window.api.saveFileDialog(`BEEP-mod-list_${stamp}${suffix}.txt`);
  if (!filePath) return;
  await window.api.writeFile(filePath, buildExportText(o).text);
  setStatus(t('status.exported'), 'success');
}

exportListBtn.addEventListener('click', () => exportList());

async function importList() {
  const file = await window.api.openFileDialog([{ name: 'Text Files', extensions: ['txt'] }]);
  if (!file) return;
  // A txt holding a 'BEEP1:' string (list-string.js) is the list it was made from.
  const got = await listTextOf(file.content);
  if (got.error) { setStatus(listStringError(got.error, got.game), 'error'); return; }
  // The import settings (editing.js) show what changes before anything is applied.
  const src = parseImportText(got.text);
  if (!src) { setStatus(t('status.noModFilenames'), 'error'); return; }
  importPreview(src);
}

importListBtn.addEventListener('click', () => importList());

// Build database from current categories (dev tool — Ctrl+Shift+B)
document.addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'B') {
    const db = {};
    for (const mod of mods) {
      if (mod.category === UNCATEGORIZED) continue;
      const cat = categories.find((c) => c.id === mod.category);
      if (cat) db[mod.realFile] = cat.name;
    }
    const count = Object.keys(db).length;
    const dbPath = await window.api.saveModDatabase(db);
    setStatus(t('status.dbBuilt', { count, path: dbPath }), 'success');
  }
});

// ===== Update Check =====

// ---- The update's progress, at the left of the status bar ----
// 업데이트 받는 중  █████████░░░░░░░░░  50%  (60.2 / 120.4 MB)   [✕ 취소]
// then 업데이트 준비 중 (a bar that runs: unpacking) and 다시 시작합니다…; ✕ only while downloading.
const UPD = (() => {
  const W = 18;
  const el = document.createElement('div');
  el.id = 'update-progress';
  el.className = 'update-progress hidden';
  el.innerHTML = '<span class="up-text"></span><span class="up-bar"></span><span class="up-pct"></span><span class="up-size"></span><button class="up-cancel" type="button"></button>';
  statusBar.before(el);
  const $u = (c) => el.querySelector(c);
  let phase = null;
  let spin = null;
  const mb = (n) => (n / 1048576).toFixed(1);
  const stopSpin = () => { clearInterval(spin); spin = null; };
  function show(p) {
    phase = p.phase;
    el.classList.remove('hidden');
    statusBar.classList.add('hidden');
    $u('.up-cancel').textContent = '✕ ' + t('update.cancel');
    $u('.up-cancel').title = t('update.cancelTip');
    $u('.up-cancel').classList.toggle('hidden', !['download', 'retry', 'start'].includes(p.phase));
    if (p.phase === 'download' || p.phase === 'start') {
      stopSpin();
      const r = p.total ? Math.min(1, p.got / p.total) : 0;
      const n = Math.round(r * W);
      $u('.up-text').textContent = t('update.downloading');
      $u('.up-bar').textContent = '█'.repeat(n) + '░'.repeat(W - n);
      $u('.up-pct').textContent = p.total ? Math.floor(r * 100) + '%' : '';
      $u('.up-size').textContent = p.total ? `(${mb(p.got || 0)} / ${mb(p.total)} MB)` : '';
    } else if (p.phase === 'retry') {
      $u('.up-text').textContent = t('update.retrying', { n: p.attempt, tries: p.tries });
    } else if (p.phase === 'unpack' || p.phase === 'restart') {
      $u('.up-text').textContent = t(p.phase === 'unpack' ? 'update.unpacking' : 'update.restarting');
      $u('.up-pct').textContent = '';
      $u('.up-size').textContent = p.phase === 'unpack' ? t('update.unpackNote') : '';
      if (!spin) {
        let i = 0;
        spin = setInterval(() => { i = (i + 1) % W; $u('.up-bar').textContent = Array.from({ length: W }, (_, k) => (Math.abs(k - i) < 3 ? '▒' : '░')).join(''); }, 120);
      }
    }
  }
  function end() {
    phase = null;
    stopSpin();
    el.classList.add('hidden');
    statusBar.classList.remove('hidden');
  }
  $u('.up-cancel').addEventListener('click', () => window.api.cancelUpdate());
  window.api.onUpdateProgress(show);
  return { show, end, phase: () => phase };
})();

// Download, unpack, then the app quits and comes back as the new version (lib/updater.js).
// Windows-only; the main process refuses to install on other platforms.
async function doUpdate(info, { asked = false } = {}) {
  if (UPD.phase()) return false;
  if (!asked) {
    const confirmed = await showConfirmModal(
      t('confirm.updateAvailable', { current: info.currentVersion, latest: info.latestVersion })
    );
    if (!confirmed) { setStatus(t('status.updateCancelled')); return false; }
  }
  UPD.show({ phase: 'start', got: 0, total: info.size || 0 });
  const result = await window.api.downloadUpdate(info.downloadUrl, info.latestVersion);
  if (result.success) return true; // (the app quits now and starts again as the new version)
  UPD.end();
  if (result.cancelled) { setStatus(t('update.cancelled')); return false; }
  const choice = await choiceModal(t('update.failTitle'), t('update.failText', { error: result.error }), [
    { key: 'close', text: t('modal.close') },
    { key: 'page', text: t('update.openPage') },
    { key: 'retry', text: t('update.retry'), primary: true },
  ]);
  if (choice === 'retry') return doUpdate(info, { asked: true });
  if (choice === 'page') window.api.openExternal(info.releaseUrl || 'https://github.com/skybogli/BEEP-Kenshi-Mod-Manager/releases');
  setStatus(t('status.updateFailed', { error: result.error }), 'error');
  return false;
}

// Closing while an update downloads: cancel it first (asked); while it is being unpacked: not now.
async function updateBlocksClose() {
  const p = UPD.phase();
  if (!p) return false;
  if (p === 'unpack' || p === 'restart') { setStatus(t('update.busyClose'), 'error'); return true; }
  const choice = await choiceModal(t('update.closeTitle'), t('update.closeText'), [
    { key: 'keep', text: t('update.closeNo'), primary: true },
    { key: 'close', text: t('update.closeYes') },
  ]);
  if (choice !== 'close') return true;
  await window.api.cancelUpdate();
  return false;
}

const updateBtn = document.getElementById('update-btn');
updateBtn.addEventListener('click', async () => {
  setStatus(t('status.checkingUpdate'));
  updateBtn.disabled = true;

  const info = await window.api.checkForUpdate();
  if (!info) {
    setStatus(t('status.updateCheckFailed'), 'error');
    updateBtn.disabled = false;
    return;
  }

  if (!info.hasUpdate) {
    setStatus(t('status.upToDate', { version: info.currentVersion }), 'success');
    updateBtn.disabled = false;
    return;
  }

  // No installable build for this OS (e.g. Linux/macOS) — point at the releases page instead.
  if (!info.downloadUrl || window.api.platform !== 'win32') {
    setStatus(t('status.updateAvailable', { version: info.latestVersion }), 'success');
    window.api.openExternal(info.releaseUrl || 'https://github.com/skybogli/BEEP-Kenshi-Mod-Manager/releases');
    updateBtn.disabled = false;
    return;
  }

  const done = await doUpdate(info);
  if (!done) updateBtn.disabled = false;
});

// ===== Update Modal =====

const updateModal = document.getElementById('update-modal');
const updateDismissBtn = document.getElementById('update-dismiss-btn');
updateDismissBtn.addEventListener('click', () => updateModal.classList.add('hidden'));

// Strip simple inline markdown so release notes render safely as plain text.
function stripInlineMd(s) {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

// Render GitHub release notes (markdown) as a tidy list. Uses textContent only — no HTML injection.
function renderUpdateNotes(body, container) {
  if (!container) return;
  container.innerHTML = '';
  if (!body || !body.trim()) { container.classList.add('hidden'); return; }
  const title = document.createElement('div');
  title.className = 'update-changes-title';
  title.textContent = t('update.whatsNew');
  container.appendChild(title);
  let ul = null;
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { ul = null; continue; }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const head = line.match(/^#{1,6}\s+(.*)$/);
    if (bullet) {
      if (!ul) { ul = document.createElement('ul'); ul.className = 'update-changes-list'; container.appendChild(ul); }
      const li = document.createElement('li');
      li.textContent = stripInlineMd(bullet[1]);
      ul.appendChild(li);
    } else if (head) {
      ul = null;
      const h = document.createElement('div');
      h.className = 'update-changes-subhead';
      h.textContent = stripInlineMd(head[1]);
      container.appendChild(h);
    } else {
      ul = null;
      const p = document.createElement('div');
      p.className = 'update-changes-line';
      p.textContent = stripInlineMd(line);
      container.appendChild(p);
    }
  }
  container.classList.remove('hidden');
}

// At start (when Help → Check for updates on start is on), or from Help → Check for updates (manual:
// says so when there is nothing new or the check failed).
async function autoCheckForUpdate(manual = false) {
  if (UPD.phase()) return;
  if (manual) setStatus(t('status.checkingUpdate'));
  const info = await window.api.checkForUpdate();
  if (!info) { if (manual) setStatus(t('status.updateCheckFailed'), 'error'); return; }
  if (info.disabled) return;
  // what the last update did: done, or the files couldn't be replaced (that version isn't
  // offered again at start — no restart loop; Help → Check for updates still tries)
  const last = info.last;
  if (last?.updated && !manual) setStatus(t('update.done', { version: last.updated }), 'success');
  if (last?.failed && !manual && last.failed === info.latestVersion) { setStatus(t('update.notApplied', { version: last.failed }), 'error'); return; }
  if (!info.hasUpdate) { if (manual) setStatus(t('status.upToDate', { version: info.currentVersion }), 'success'); return; }

  document.getElementById('update-version-text').textContent =
    `v${info.currentVersion} → v${info.latestVersion}`;

  renderUpdateNotes(info.body, document.getElementById('update-changes'));

  const downloadLink = document.getElementById('update-download-link');
  const githubLink = document.getElementById('update-github-link');

  const releaseUrl = info.releaseUrl || 'https://github.com/skybogli/BEEP-Kenshi-Mod-Manager/releases';

  if (info.downloadUrl && window.api.platform === 'win32') {
    // Windows: install in place (no Save-As, no blank window).
    downloadLink.classList.remove('hidden');
    downloadLink.onclick = (e) => {
      e.preventDefault();
      updateModal.classList.add('hidden');
      doUpdate(info, { asked: true }); // (this dialog was the question)
    };
  } else if (info.downloadUrl) {
    // Other platforms: in-app install isn't supported — open the releases page in the browser.
    downloadLink.onclick = (e) => { e.preventDefault(); window.api.openExternal(releaseUrl); };
  } else {
    downloadLink.classList.add('hidden');
  }

  githubLink.onclick = (e) => { e.preventDefault(); window.api.openExternal(releaseUrl); };

  updateModal.classList.remove('hidden');
}

// ===== Settings Modal =====

const appSettingsBtn = document.getElementById('app-settings-btn');
const appSettingsModal = document.getElementById('app-settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsResetBtn = document.getElementById('settings-reset-btn');
const setMapZoom = document.getElementById('set-map-zoom');
const setMapZoomVal = document.getElementById('set-map-zoom-val');
const setColScroll = document.getElementById('set-col-scroll');
const setColScrollVal = document.getElementById('set-col-scroll-val');

function syncSettingsUI() {
  setMapZoom.value = mapZoomSpeed;
  setColScroll.value = columnScrollSpeed;
  setMapZoomVal.textContent = Number(mapZoomSpeed).toFixed(2);
  setColScrollVal.textContent = Number(columnScrollSpeed).toFixed(2) + '×';
}

appSettingsBtn.addEventListener('click', () => {
  syncSettingsUI();
  appSettingsModal.classList.remove('hidden');
});
settingsCloseBtn.addEventListener('click', () => appSettingsModal.classList.add('hidden'));
appSettingsModal.addEventListener('click', (e) => {
  if (e.target === appSettingsModal) appSettingsModal.classList.add('hidden');
});

// Live feedback on drag; persist only when the drag ends (avoids hammering the config file).
setMapZoom.addEventListener('input', () => {
  mapZoomSpeed = parseFloat(setMapZoom.value);
  setMapZoomVal.textContent = mapZoomSpeed.toFixed(2);
});
setMapZoom.addEventListener('change', () => {
  config.mapZoomSpeed = mapZoomSpeed;
  persistConfig();
});
setColScroll.addEventListener('input', () => {
  columnScrollSpeed = parseFloat(setColScroll.value);
  setColScrollVal.textContent = columnScrollSpeed.toFixed(2) + '×';
});
setColScroll.addEventListener('change', () => {
  config.columnScrollSpeed = columnScrollSpeed;
  persistConfig();
});

settingsResetBtn.addEventListener('click', () => {
  mapZoomSpeed = DEFAULT_MAP_ZOOM_SPEED;
  columnScrollSpeed = DEFAULT_COLUMN_SCROLL_SPEED;
  config.mapZoomSpeed = mapZoomSpeed;
  config.columnScrollSpeed = columnScrollSpeed;
  syncSettingsUI();
  persistConfig();
});

// ===== Zone Map Modal =====

const zoneMapModal = document.getElementById('zone-map-modal');
const zoneMapTitle = document.getElementById('zone-map-title');
const zoneMapClose = document.getElementById('zone-map-close');
const zoneMapContainer = document.getElementById('zone-map-container');
const zoneMapWrapper = document.getElementById('zone-map-wrapper');
const zoneMapImg = document.getElementById('zone-map-img');
const zoneMapOverlays = document.getElementById('zone-map-overlays');
const zoneSidebarList = document.getElementById('zone-sidebar-list');
const zoneShowAllBtn = document.getElementById('zone-show-all-btn');
const zoneLayerBtn = document.getElementById('zone-layer-btn');
const zoneModeBtn = document.getElementById('zone-mode-btn');
const mapBtn = document.getElementById('map-btn');

let mapScale = 1;
let mapPanX = 0, mapPanY = 0;
let mapDragging = false;
let mapDragStartX = 0, mapDragStartY = 0;
let mapPanStartX = 0, mapPanStartY = 0;
let showAllZones = true;
let selectedZoneKey = null;
let zoneLayer = 'exterior'; // 'exterior' or 'interior'
let zoneConflicts = []; // [{ key, zx, zy, mods: [{ filename, winner }] }]
let allZoneConflicts = { exterior: [], interior: [] };
let mapMode = 'conflicts'; // 'conflicts' | 'edits'
let selectedEditMod = null; // .mod filename selected in "All Edits" mode
let selectedEditZoneKey = null; // "zx,zy" of the clicked edit zone
let editZoneDiff = null; // lazy object-level diff result for the selected exterior sector
let conflictZoneDiff = null; // lazy per-mod object overlap for the selected conflict sector
let allModEdits = {}; // conflictData.perModEdits: { modFile: { exterior:[], interior:[], extZoneCount, intZoneCount } }

zoneMapClose.addEventListener('click', () => zoneMapModal.classList.add('hidden'));
zoneMapModal.addEventListener('click', (e) => {
  if (e.target === zoneMapModal) zoneMapModal.classList.add('hidden');
});

// Map button handler
mapBtn.addEventListener('click', async () => {
  if (!conflictData) {
    await runConflictCheck();
  }
  if (conflictData) openZoneMap();
});

function openZoneMap(focusZone) {
  // Extract zone-mappable conflicts, separated by layer
  const layers = { exterior: {}, interior: {} };

  const detailSeen = {}; // layer:zoneKey -> Set of detailKeys

  for (const [modFile, conflicts] of Object.entries(conflictData.modConflicts)) {
    for (const c of conflicts) {
      if (!c.type.startsWith('LEVEL:') || !c.zones) continue;

      const layer = c.type === 'LEVEL:INTERIORS' ? 'interior' : 'exterior';
      const zoneMap = layers[layer];

      for (const z of c.zones) {
        const key = `${z.zx},${z.zy}`;
        if (!zoneMap[key]) {
          zoneMap[key] = { key: `zone.${z.zx}.${z.zy}`, zx: z.zx, zy: z.zy, mods: {}, winner: c.winner, details: [] };
        }
        for (const m of c.allMods) {
          zoneMap[key].mods[m.filename] = { filename: m.filename, loadOrder: m.loadOrder };
        }
        zoneMap[key].winner = c.winner;
        if (c.zonePaths) zoneMap[key].zonePaths = c.zonePaths;

        const seenKey = `${layer}:${key}`;
        if (!detailSeen[seenKey]) detailSeen[seenKey] = new Set();
        const detailKey = `${c.type}|${c.name}|${c.key}`;
        if (!detailSeen[seenKey].has(detailKey)) {
          detailSeen[seenKey].add(detailKey);
          // Cap details to prevent massive lists
          if (zoneMap[key].details.length < 50) {
            zoneMap[key].details.push({ key: detailKey, type: c.type, name: c.name, prop: c.key, values: c.values, winner: c.winner });
          }
        }
      }
    }
  }

  const sortZones = (map) => Object.values(map).sort((a, b) => a.zy !== b.zy ? a.zy - b.zy : a.zx - b.zx);
  allZoneConflicts.exterior = sortZones(layers.exterior);
  allZoneConflicts.interior = sortZones(layers.interior);
  zoneConflicts = allZoneConflicts[zoneLayer];
  allModEdits = conflictData.perModEdits || {};

  // Reset view
  mapScale = 1;
  mapPanX = 0;
  mapPanY = 0;
  // Convert zone filename to key format
  let focusKey = null;
  if (focusZone) {
    const m = focusZone.match(/zone\.(\d+)\.(\d+)/i);
    if (m) focusKey = `${parseInt(m[1])},${parseInt(m[2])}`;
  }
  selectedZoneKey = focusKey;
  showAllZones = true;
  zoneLayer = 'exterior';
  zoneShowAllBtn.textContent = t('zoneMap.hideAll');
  zoneLayerBtn.textContent = t('zoneMap.exterior');

  // Always open in Conflicts mode (keeps the conflict-tab "show on map" focus path unchanged)
  mapMode = 'conflicts';
  selectedEditMod = null;
  selectedEditZoneKey = null;
  zoneModeBtn.textContent = t('zoneMap.modeEdits');
  if (zoneMapTitle) zoneMapTitle.textContent = t('zoneMap.title');
  const sidebarTitleEl = document.querySelector('#zone-map-sidebar .zone-sidebar-title');
  if (sidebarTitleEl) sidebarTitleEl.textContent = t('zoneMap.sidebarTitle');

  zoneMapModal.classList.remove('hidden');

  const init = () => {
    updateMapTransform();
    renderZoneOverlays();
    renderZoneSidebar();
    if (focusKey) selectZone(focusKey);
  };

  if (zoneMapImg.complete) {
    requestAnimationFrame(init);
  } else {
    zoneMapImg.onload = init;
  }
}

function updateMapTransform() {
  const containerW = zoneMapContainer.clientWidth;
  const containerH = zoneMapContainer.clientHeight;
  // Set image size based on scale
  const baseSize = Math.min(containerW, containerH);
  const imgSize = baseSize * mapScale;
  zoneMapImg.style.width = imgSize + 'px';
  zoneMapImg.style.height = imgSize + 'px';
  // Apply pan via scroll
  zoneMapWrapper.style.width = imgSize + 'px';
  zoneMapWrapper.style.height = imgSize + 'px';
}

function renderZoneOverlays() {
  zoneMapOverlays.innerHTML = '';
  const imgW = zoneMapImg.clientWidth;
  const imgH = zoneMapImg.clientHeight;
  if (!imgW || !imgH) return;

  const zoneW = imgW / 64;
  const zoneH = imgH / 64;

  if (mapMode === 'edits') { renderEditOverlays(zoneW, zoneH); return; }

  for (const zc of zoneConflicts) {
    const zcKey = `${zc.zx},${zc.zy}`;
    if (!showAllZones && zcKey !== selectedZoneKey) continue;

    const el = document.createElement('div');
    el.className = 'zone-map-highlight';
    if (zcKey === selectedZoneKey) el.classList.add('selected');
    el.style.left = (zc.zx * zoneW) + 'px';
    el.style.top = (zc.zy * zoneH) + 'px';
    el.style.width = zoneW + 'px';
    el.style.height = zoneH + 'px';

    const label = document.createElement('div');
    label.className = 'zone-map-label';
    const modCount = Object.keys(zc.mods).length;
    label.textContent = `${zc.zx},${zc.zy} (${modCount})`;
    el.appendChild(label);

    el.addEventListener('click', () => selectZone(zcKey));
    zoneMapOverlays.appendChild(el);
  }
}

function renderZoneSidebar() {
  zoneSidebarList.innerHTML = '';

  if (mapMode === 'edits') { renderEditModSidebar(); return; }

  if (zoneConflicts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'zone-no-conflicts';
    empty.textContent = t('zoneMap.noConflicts', { layer: zoneLayer });
    zoneSidebarList.appendChild(empty);
    return;
  }

  // Group zones by winning mod
  const byWinner = {};
  for (const zc of zoneConflicts) {
    const winnerName = zc.winner.replace(/\.mod$/i, '');
    if (!byWinner[winnerName]) byWinner[winnerName] = { filename: zc.winner, zones: [] };
    byWinner[winnerName].zones.push(zc);
  }

  for (const [modName, group] of Object.entries(byWinner)) {
    const modGroup = document.createElement('div');
    modGroup.className = 'zone-mod-group';

    // Mod header (expandable)
    const modHeader = document.createElement('div');
    modHeader.className = 'zone-mod-header';

    const arrow = document.createElement('span');
    arrow.className = 'zone-mod-arrow';
    arrow.textContent = '\u25BC';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = modName;

    const countSpan = document.createElement('span');
    countSpan.className = 'zone-mod-count';
    countSpan.textContent = `${group.zones.length} zones`;

    modHeader.append(arrow, nameSpan, countSpan);

    // Zone sub-list
    const zonesDiv = document.createElement('div');
    zonesDiv.className = 'zone-mod-zones';

    for (const zc of group.zones) {
      const zcKey = `${zc.zx},${zc.zy}`;
      const item = document.createElement('div');
      item.className = 'zone-conflict-item';
      if (zcKey === selectedZoneKey) item.classList.add('active');

      const name = document.createElement('span');
      name.className = 'zone-conflict-name';
      name.textContent = `zone ${zc.zx}, ${zc.zy}`;

      const count = document.createElement('span');
      count.className = 'zone-conflict-count';
      count.textContent = Object.keys(zc.mods).length + ' mods';

      item.append(name, count);
      item.addEventListener('click', () => selectZone(zcKey));
      zonesDiv.appendChild(item);

      // Detail panel (shown when selected)
      if (zcKey === selectedZoneKey) {
        const detail = document.createElement('div');
        detail.className = 'zone-conflict-detail';

        // Other mods involved
        const modsArr = Object.values(zc.mods).sort((a, b) => a.loadOrder - b.loadOrder);
        for (const m of modsArr) {
          const row = document.createElement('div');
          row.className = 'zone-detail-mod';
          if (m.filename === zc.winner) row.classList.add('winner');
          const mName = m.filename.replace(/\.mod$/i, '');
          row.textContent = `#${m.loadOrder} ${mName}${m.filename === zc.winner ? ' (winner)' : ''}`;
          detail.appendChild(row);
        }

        // Exterior sectors: show the object-level overlap (what each mod changed, where they collide).
        // Interiors keep the property-level list.
        if (zoneLayer === 'exterior' && zc.zonePaths) {
          renderConflictOverlap(detail, zc);
        } else if (zc.details && zc.details.length > 0) {
          const detailHeader = document.createElement('div');
          detailHeader.style.cssText = 'margin-top:6px;padding-top:4px;border-top:1px solid #333;font-size:9px;color:#888;';
          detailHeader.textContent = `${zc.details.length} conflicting properties:`;
          detail.appendChild(detailHeader);

          for (const d of zc.details.slice(0, 10)) {
            const dRow = document.createElement('div');
            dRow.style.cssText = 'font-size:9px;color:#999;padding:1px 0 1px 6px;';
            dRow.textContent = `${d.name} → ${d.prop}`;
            detail.appendChild(dRow);
          }
          if (zc.details.length > 10) {
            const more = document.createElement('div');
            more.style.cssText = 'font-size:9px;color:#666;padding:1px 0 1px 6px;';
            more.textContent = `...and ${zc.details.length - 10} more`;
            detail.appendChild(more);
          }
        }

        zonesDiv.appendChild(detail);
      }
    }

    modHeader.addEventListener('click', () => {
      const isOpen = !zonesDiv.classList.contains('hidden');
      zonesDiv.classList.toggle('hidden');
      arrow.textContent = isOpen ? '\u25B6' : '\u25BC';
    });

    modGroup.append(modHeader, zonesDiv);
    zoneSidebarList.appendChild(modGroup);
  }
}

function selectZone(key) {
  selectedZoneKey = key;
  conflictZoneDiff = null; // reset; loaded lazily below
  renderZoneOverlays();
  renderZoneSidebar();

  // Pan map to center the selected zone
  const zc = zoneConflicts.find((z) => `${z.zx},${z.zy}` === key);
  if (zc) panToZone(zc.zx, zc.zy);

  // Object-level overlap for contested exterior sectors (lazy — each mod carries its .zone path)
  if (zc && zoneLayer === 'exterior' && zc.zonePaths && config && config.gamePath) {
    const reqKey = key;
    window.api.diffSectorConflict(zc.zonePaths, config.gamePath, zc.zx, zc.zy).then((res) => {
      if (selectedZoneKey !== reqKey) return; // a different sector was clicked since
      conflictZoneDiff = res || { baseline: false };
      renderZoneSidebar();
    }).catch(() => {});
  }

  // Expand the parent mod group and scroll sidebar to the active item
  const activeItem = zoneSidebarList.querySelector('.zone-conflict-item.active');
  if (activeItem) {
    const parentZones = activeItem.closest('.zone-mod-zones');
    if (parentZones && parentZones.classList.contains('hidden')) {
      parentZones.classList.remove('hidden');
      const arrow = parentZones.previousElementSibling?.querySelector('.zone-mod-arrow');
      if (arrow) arrow.textContent = '\u25BC';
    }
    activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Center the map viewport on a zone (shared by conflicts + edits modes)
function panToZone(zx, zy) {
  const imgW = zoneMapImg.clientWidth;
  const imgH = zoneMapImg.clientHeight;
  const containerW = zoneMapContainer.clientWidth;
  const containerH = zoneMapContainer.clientHeight;
  const zoneW = imgW / 64;
  const zoneH = imgH / 64;
  const centerX = (zx + 0.5) * zoneW - containerW / 2;
  const centerY = (zy + 0.5) * zoneH - containerH / 2;
  zoneMapContainer.scrollLeft = Math.max(0, centerX);
  zoneMapContainer.scrollTop = Math.max(0, centerY);
}

// ===== "All Edits" mode (per-mod level edits) =====

function renderEditModSidebar() {
  const modFiles = Object.keys(allModEdits)
    .filter((mf) => (allModEdits[mf][zoneLayer] || []).length > 0)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  if (modFiles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'zone-no-conflicts';
    empty.textContent = t('zoneMap.noEdits', { layer: zoneLayer });
    zoneSidebarList.appendChild(empty);
    return;
  }

  if (!selectedEditMod) {
    const hint = document.createElement('div');
    hint.className = 'zone-edit-hint';
    hint.textContent = t('zoneMap.selectModHint');
    zoneSidebarList.appendChild(hint);
  }

  for (const mf of modFiles) {
    const zones = allModEdits[mf][zoneLayer] || [];

    const item = document.createElement('div');
    item.className = 'zone-conflict-item';
    if (mf === selectedEditMod) item.classList.add('active');

    const name = document.createElement('span');
    name.className = 'zone-conflict-name';
    name.textContent = mf.replace(/\.mod$/i, '');

    const count = document.createElement('span');
    count.className = 'zone-conflict-count';
    count.textContent = t('zoneMap.zones', { count: zones.length });

    item.append(name, count);
    item.addEventListener('click', () => selectEditMod(mf));
    zoneSidebarList.appendChild(item);

    // Detail panel for the clicked zone, shown under its selected mod
    if (mf === selectedEditMod && selectedEditZoneKey) {
      const zone = zones.find((z) => `${z.zx},${z.zy}` === selectedEditZoneKey);
      if (zone) {
        const detail = document.createElement('div');
        detail.className = 'zone-conflict-detail';

        if (zone.items.length === 0) {
          // Exterior sector: object-level diff vs the base game (loaded lazily on click)
          renderSectorDiff(detail, zone);
        } else {
          const head = document.createElement('div');
          head.style.cssText = 'font-size:9px;color:#888;padding-bottom:2px;';
          head.textContent = t('zoneMap.editsInZone', { x: zone.zx, y: zone.zy, count: zone.itemCount });
          detail.appendChild(head);
          for (const it of zone.items) {
            const row = document.createElement('div');
            row.style.cssText = 'font-size:9px;color:#999;padding:1px 0 1px 6px;';
            row.textContent = `${it.name} → ${it.prop}`;
            detail.appendChild(row);
          }
          if (zone.itemCount > zone.items.length) {
            const more = document.createElement('div');
            more.style.cssText = 'font-size:9px;color:#666;padding:1px 0 1px 6px;';
            more.textContent = t('zoneMap.andMore', { count: zone.itemCount - zone.items.length });
            detail.appendChild(more);
          }
        }
        zoneSidebarList.appendChild(detail);
      }
    }
  }
}

function renderEditOverlays(zoneW, zoneH) {
  if (!selectedEditMod) return;
  const zones = (allModEdits[selectedEditMod] || {})[zoneLayer] || [];
  for (const z of zones) {
    const zKey = `${z.zx},${z.zy}`;
    const el = document.createElement('div');
    el.className = 'zone-map-edit';
    if (zKey === selectedEditZoneKey) el.classList.add('selected');
    el.style.left = (z.zx * zoneW) + 'px';
    el.style.top = (z.zy * zoneH) + 'px';
    el.style.width = zoneW + 'px';
    el.style.height = zoneH + 'px';

    const label = document.createElement('div');
    label.className = 'zone-map-label';
    label.textContent = z.itemCount ? `${z.zx},${z.zy} (${z.itemCount})` : `${z.zx},${z.zy}`;
    el.appendChild(label);

    el.addEventListener('click', () => selectEditZone(z.zx, z.zy));
    zoneMapOverlays.appendChild(el);
  }
}

function selectEditMod(mf) {
  selectedEditMod = mf;
  selectedEditZoneKey = null;
  renderZoneOverlays();
  renderZoneSidebar();
  const zones = (allModEdits[mf] || {})[zoneLayer] || [];
  if (zones.length) panToZone(zones[0].zx, zones[0].zy);
}

function selectEditZone(zx, zy) {
  selectedEditZoneKey = `${zx},${zy}`;
  editZoneDiff = null; // reset; loaded lazily below
  renderZoneOverlays();
  renderZoneSidebar();
  const activeItem = zoneSidebarList.querySelector('.zone-conflict-item.active');
  if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Object-level diff vs the base game (exterior sectors carry their .zone path)
  const zones = (allModEdits[selectedEditMod] || {})[zoneLayer] || [];
  const zone = zones.find((z) => `${z.zx},${z.zy}` === selectedEditZoneKey);
  if (zone && zone.zonePath && config && config.gamePath) {
    const reqKey = selectedEditZoneKey;
    window.api.diffSector(zone.zonePath, config.gamePath, zx, zy).then((res) => {
      if (selectedEditZoneKey !== reqKey) return; // a different sector was clicked since
      editZoneDiff = res || { baseline: false };
      renderZoneSidebar();
    }).catch(() => {});
  }
}

// Render the object-level diff (mod's sector vs the base game) as collapsible sections
function renderSectorDiff(detail, zone) {
  if (editZoneDiff === null) {
    const h = document.createElement('div'); h.style.cssText = 'font-size:9px;color:#888;';
    h.textContent = t('zoneMap.analyzing', { x: zone.zx, y: zone.zy }); detail.appendChild(h); return;
  }
  if (!editZoneDiff.baseline) {
    const h = document.createElement('div'); h.style.cssText = 'font-size:9px;color:#888;';
    h.textContent = t('zoneMap.sectorOverride', { x: zone.zx, y: zone.zy }); detail.appendChild(h); return;
  }
  const head = document.createElement('div');
  head.style.cssText = 'font-size:9px;color:#888;padding-bottom:3px;';
  head.textContent = t('zoneMap.sectorDiff', { x: zone.zx, y: zone.zy });
  detail.appendChild(head);

  const d = editZoneDiff;
  makeDiffSection(detail, t('zoneMap.diffMoved', { count: d.summary.moved }),
    d.moved.map((m) => `${m.name} — ${m.dist.toFixed(1)}u`), { open: true });
  makeDiffSection(detail, t('zoneMap.diffAdded', { count: d.summary.added }),
    d.added.map((a) => (a.count > 1 ? `${a.name} ×${a.count}` : a.name)), { caveat: true });
  makeDiffSection(detail, t('zoneMap.diffRemoved', { count: d.summary.removed }),
    d.removed.map((r) => (r.count > 1 ? `${r.name} ×${r.count}` : r.name)), { caveat: true });
}

// Render the per-mod object overlap for a contested exterior sector (what each mod changed + collisions).
function renderConflictOverlap(detail, zc) {
  const head = document.createElement('div');
  head.style.cssText = 'margin-top:6px;padding-top:4px;border-top:1px solid #333;font-size:9px;color:#888;';
  if (conflictZoneDiff === null) {
    head.textContent = t('zoneMap.analyzing', { x: zc.zx, y: zc.zy });
    detail.appendChild(head); return;
  }
  if (!conflictZoneDiff.baseline) {
    head.textContent = t('zoneMap.newSector', { x: zc.zx, y: zc.zy });
    detail.appendChild(head); return;
  }
  head.textContent = t('zoneMap.overlapTitle', { x: zc.zx, y: zc.zy });
  detail.appendChild(head);

  const d = conflictZoneDiff;
  const short = (f) => f.replace(/\.mod$/i, '');

  // Where the mods touch the SAME object — the real collisions load order can't reconcile.
  if (d.overlap.length) {
    makeDiffSection(detail, t('zoneMap.collisions', { count: d.overlap.length }),
      d.overlap.map((o) => `${o.name} — ${o.mods.map((m) => short(m.mod) + (m.kind === 'moved' ? ` ${m.dist.toFixed(1)}u` : ' ✕')).join(' vs ')}`),
      { open: true, caveat: true });
  } else {
    const none = document.createElement('div');
    none.className = 'sector-diff-item';
    none.style.paddingLeft = '0';
    none.textContent = t('zoneMap.noOverlap');
    detail.appendChild(none);
  }

  // What each mod changed in this sector (collapsed). → moved, + added, − removed.
  for (const m of d.mods) {
    const items = [
      ...m.moved.map((x) => `→ ${x.name} ${x.dist.toFixed(1)}u`),
      ...m.added.map((x) => `+ ${x.name}${x.count > 1 ? ` ×${x.count}` : ''}`),
      ...m.removed.map((x) => `− ${x.name}${x.count > 1 ? ` ×${x.count}` : ''}`),
    ];
    const total = m.summary.moved + m.summary.added + m.summary.removed;
    makeDiffSection(detail, `${short(m.mod)} · ${total}`, items, { caveat: true });
  }
}

// A collapsible "Moved / Added / Removed" group in the sector-diff panel
function makeDiffSection(parent, title, items, opts) {
  opts = opts || {};
  const section = document.createElement('div');
  section.className = 'sector-diff-section';
  const head = document.createElement('div');
  head.className = 'sector-diff-head';
  if (opts.caveat) head.title = t('zoneMap.diffCaveat');
  const arrow = document.createElement('span');
  arrow.className = 'sector-diff-arrow';
  const label = document.createElement('span');
  label.textContent = title + (opts.caveat ? ' ⓘ' : '');
  head.append(arrow, label);
  const list = document.createElement('div');
  list.className = 'sector-diff-list';
  for (const it of items.slice(0, 40)) {
    const row = document.createElement('div');
    row.className = 'sector-diff-item';
    row.textContent = it;
    list.appendChild(row);
  }
  if (items.length > 40) {
    const more = document.createElement('div');
    more.className = 'sector-diff-item';
    more.style.color = '#666';
    more.textContent = t('zoneMap.andMore', { count: items.length - 40 });
    list.appendChild(more);
  }
  const expanded = !!opts.open && items.length > 0;
  if (!expanded) list.classList.add('hidden');
  arrow.textContent = items.length === 0 ? '·' : (expanded ? '▾' : '▸');
  head.addEventListener('click', () => {
    if (!items.length) return;
    const collapsed = list.classList.toggle('hidden');
    arrow.textContent = collapsed ? '▸' : '▾';
  });
  section.append(head, list);
  parent.appendChild(section);
}

// Show All toggle
zoneShowAllBtn.addEventListener('click', () => {
  showAllZones = !showAllZones;
  zoneShowAllBtn.textContent = showAllZones ? t('zoneMap.hideAll') : t('zoneMap.showAll');
  renderZoneOverlays();
});

// Layer toggle (exterior / interior)
zoneLayerBtn.addEventListener('click', () => {
  zoneLayer = zoneLayer === 'exterior' ? 'interior' : 'exterior';
  zoneLayerBtn.textContent = zoneLayer === 'exterior' ? t('zoneMap.exterior') : t('zoneMap.interior');
  if (mapMode === 'edits') {
    selectedEditZoneKey = null; // keep the selected mod; redraw its zones for the new layer
  } else {
    zoneConflicts = allZoneConflicts[zoneLayer];
    selectedZoneKey = null;
  }
  renderZoneOverlays();
  renderZoneSidebar();
});

// Mode toggle (Conflicts / All Edits)
zoneModeBtn.addEventListener('click', () => {
  mapMode = mapMode === 'conflicts' ? 'edits' : 'conflicts';
  zoneModeBtn.textContent = mapMode === 'conflicts' ? t('zoneMap.modeEdits') : t('zoneMap.modeConflicts');
  if (zoneMapTitle) zoneMapTitle.textContent = mapMode === 'conflicts' ? t('zoneMap.title') : t('zoneMap.titleEdits');
  const titleEl = document.querySelector('#zone-map-sidebar .zone-sidebar-title');
  if (titleEl) titleEl.textContent = mapMode === 'conflicts' ? t('zoneMap.sidebarTitle') : t('zoneMap.sidebarEditsTitle');
  selectedZoneKey = null;
  selectedEditMod = null;
  selectedEditZoneKey = null;
  renderZoneOverlays();
  renderZoneSidebar();
});

// Zoom via mouse wheel
zoneMapContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -mapZoomSpeed : mapZoomSpeed;
  const oldScale = mapScale;
  mapScale = Math.max(0.5, Math.min(6, mapScale + delta));

  // Zoom toward cursor position
  const rect = zoneMapContainer.getBoundingClientRect();
  const mx = e.clientX - rect.left + zoneMapContainer.scrollLeft;
  const my = e.clientY - rect.top + zoneMapContainer.scrollTop;
  const ratio = mapScale / oldScale;

  updateMapTransform();
  renderZoneOverlays();

  // Adjust scroll to keep cursor point stable
  zoneMapContainer.scrollLeft = mx * ratio - (e.clientX - rect.left);
  zoneMapContainer.scrollTop = my * ratio - (e.clientY - rect.top);
}, { passive: false });

// Pan via mouse drag
zoneMapContainer.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('zone-map-highlight') || e.target.classList.contains('zone-map-edit') || e.target.classList.contains('zone-map-label')) return;
  mapDragging = true;
  mapDragStartX = e.clientX;
  mapDragStartY = e.clientY;
  mapPanStartX = zoneMapContainer.scrollLeft;
  mapPanStartY = zoneMapContainer.scrollTop;
  zoneMapContainer.classList.add('dragging');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!mapDragging) return;
  zoneMapContainer.scrollLeft = mapPanStartX - (e.clientX - mapDragStartX);
  zoneMapContainer.scrollTop = mapPanStartY - (e.clientY - mapDragStartY);
});

document.addEventListener('mouseup', () => {
  if (mapDragging) {
    mapDragging = false;
    zoneMapContainer.classList.remove('dragging');
  }
});

// Keep showZoneOnMap for clicking from conflict view
function showZoneOnMap(zoneFile) {
  if (!conflictData) return;
  openZoneMap(zoneFile);
}

// Make container scrollable for pan
zoneMapContainer.style.overflow = 'auto';

// ===== Status Bar =====

function setStatus(msg, type) {
  statusBar.textContent = msg;
  statusBar.className = 'status-bar';
  if (type) statusBar.classList.add(type);
}

function updateDepStatus() {
  let depProblems = 0;
  const problemMods = new Set();
  for (const mod of mods) {
    if (!mod.active) continue;
    const deps = (mod.dependencies || []).concat(mod.references || []);
    for (const dep of deps) {
      const depMod = findDepMod(dep);
      if (!depMod || !depMod.active) {
        depProblems++;
        problemMods.add(mod.displayName);
      }
    }
  }
  if (depProblems > 0) {
    setStatus(t('status.depWarning', { count: depProblems, mods: problemMods.size }), 'error');
  } else {
    setStatus(t('status.ready'));
  }
}

// ===== Load Order Computation =====

// The actual load order (what Save writes): the category layout, except mods pinned (📌)
// to a position by hand. See editing.js.
function computeLoadOrder() {
  return [...actualOrder];
}

// ===== Category Helpers =====

function getModsForCategory(catId) {
  const catMods = mods.filter((m) => m.category === catId);
  const orderList = modOrders[catId] || [];

  catMods.sort((a, b) => {
    const ai = orderList.indexOf(a.filename);
    const bi = orderList.indexOf(b.filename);
    // Mods in the order list come first, in that order
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return catMods;
}

function generateId() {
  return 'cat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function randomColor() {
  const colors = ['#4a9f4a', '#4a6fa5', '#a54a4a', '#a5894a', '#7a4aa5', '#4aa5a5', '#a54a7a', '#6b8f3e'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ===== Persist =====

async function persistConfig() {
  applyNoLoad();
  config.parked = parkedKeys();
  config.categories = categories;
  config.modCategories = modCategories;
  config.modOrders = modOrders;
  config.uncategorizedPinned = uncategorizedPinned;
  config.kenshiTheme = document.body.classList.contains('kenshi-theme');
  config.tutorialDismissed = tutorialDismissed;
  config.pins = [...pins];
  scheduleHistoryCheck();
  await window.api.saveConfig(config);
}

// ===== Undo / Redo =====
// Every user change ends in persistConfig(), so history is taken there: the layout
// (categories, mod placement, order, active state) is compared with the last
// recorded one, and the old layout goes on the undo stack when it differs.
// Several persistConfig() calls in one action are folded into one step.

const HISTORY_LIMIT = 100;
const undoStack = [];
const redoStack = [];
let historyBaseline = null;
let historyCheckPending = false;

// Mods are keyed by file path (the same .mod filename can exist locally and in several
// workshop folders); placeholders (not installed) have none, so they go by filename.
function layoutKeyOf(mod) {
  return mod.filePath || 'missing:' + mod.filename;
}

function captureLayout() {
  return JSON.stringify({
    categories,
    modCategories,
    modOrders,
    placement: mods.map((m) => [layoutKeyOf(m), m.category]),
    active: mods.filter((m) => m.active).map(layoutKeyOf),
    order: actualOrder,
    pins: [...pins],
    uncatPos: uncatPos(),
    uncatNoLoad: config?.uncatNoLoad === true, // 🚫 (the other categories carry theirs)
    parked: parkedKeys(),
    removed: removedSids(), // deleted mods (editing.js), for undo
    ghosts: config?.ghosts || {},
  });
}

// Take the current layout as the starting point without adding an undo step.
function resetHistoryBaseline() {
  historyBaseline = captureLayout();
}

function scheduleHistoryCheck() {
  if (historyCheckPending) return;
  historyCheckPending = true;
  setTimeout(() => {
    historyCheckPending = false;
    const current = captureLayout();
    if (historyBaseline !== null && current !== historyBaseline) {
      undoStack.push(historyBaseline);
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      redoStack.length = 0;
    }
    historyBaseline = current;
    updateHistoryButtons();
  }, 0);
}

// keepCategories: the categories themselves (order, names, colors, where Uncategorized is) stay
// as they are now — going back to the last save only undoes the load order and the mods' places.
function restoreLayout(json, { keepCategories = false } = {}) {
  const state = JSON.parse(json);
  syncDeleted(state); // deleted mods come back / go again, placeholders (editing.js)
  if (!keepCategories) categories = state.categories;
  modCategories = state.modCategories;
  modOrders = state.modOrders;
  const placement = new Map(state.placement);
  const active = new Set(state.active);
  const parked = new Set(state.parked || []);
  for (const mod of mods) {
    mod.category = placement.get(layoutKeyOf(mod)) || UNCATEGORIZED;
    if (mod.category !== UNCATEGORIZED && !categories.some((c) => c.id === mod.category)) {
      mod.category = UNCATEGORIZED;
    }
    mod.active = active.has(layoutKeyOf(mod));
    mod.parked = parked.has(layoutKeyOf(mod));
  }
  if (state.order) actualOrder = [...state.order];
  pins = new Set(state.pins || []);
  if (!keepCategories && Number.isInteger(state.uncatPos)) config.uncatPos = state.uncatPos;
  if (!keepCategories && typeof state.uncatNoLoad === 'boolean') config.uncatNoLoad = state.uncatNoLoad;
  historyBaseline = captureLayout();
  persistConfig();
  renderColumns();
  modCount.textContent = t('modCount', { total: mods.length, active: mods.filter((m) => m.active).length });
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(captureLayout());
  restoreLayout(undoStack.pop());
  setStatus(t('status.undone'));
  updateHistoryButtons();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(captureLayout());
  restoreLayout(redoStack.pop());
  setStatus(t('status.redone'));
  updateHistoryButtons();
}

const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');

// Badges are a fixed two-digit width: empty (grey) at 0, "99+" above 99.
function historyBadge(n) {
  return n > 99 ? '99+' : n ? String(n) : '';
}

function updateHistoryButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
  document.getElementById('undo-count').textContent = historyBadge(undoStack.length);
  document.getElementById('redo-count').textContent = historyBadge(redoStack.length);
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

function isEditableTarget(el) {
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

// Undo/redo from the shortcut keys or the Edit menu. In a text field they keep
// their normal text-editing meaning.
function runHistoryCommand(command) {
  if (exportPicking()) { exportSelHistory(command); return; } // the export panel: the selection
  if (isEditableTarget(document.activeElement)) {
    document.execCommand(command);
    return;
  }
  if (mainScreen.classList.contains('hidden')) return;
  if (command === 'undo') undo();
  else redo();
}

// The undo / redo keys are in editing.js's changeable shortcut list.

window.api.onMenuCommand((command) => {
  if (command === 'undo' || command === 'redo') runHistoryCommand(command);
});

function syncModCategories() {
  // Rebuild modCategories and modOrders from current mod state
  modCategories = {};
  for (const mod of mods) {
    if (mod.category !== UNCATEGORIZED) {
      modCategories[mod.filename] = mod.category;
    }
  }
  // Rebuild modOrders per category
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  sorted.push({ id: UNCATEGORIZED });
  for (const cat of sorted) {
    const catMods = getModsForCategory(cat.id);
    modOrders[cat.id] = catMods.map((m) => m.filename);
  }
}

// ===== Rendering =====

function renderColumns() {
  syncGhostMods(); // placeholders for mods that aren't installed (editing.js), always off
  applyNoLoad(); // mods in a 🚫 category stay off (editing.js)
  enforceOneCopy();
  applyAutoSorts();
  syncActualOrder();
  // Preserve scroll position across re-renders
  const savedScrollTop = columnsContainer.scrollTop;
  const savedScrollLeft = columnsContainer.scrollLeft;
  // Also save pinned panel mod list scroll
  const pinnedModsList = document.querySelector('#pinned-uncat-panel .column-mods');
  const savedPinnedScroll = pinnedModsList ? pinnedModsList.scrollTop : 0;
  // Save per-column scroll positions
  const savedColScrolls = {};
  for (const col of document.querySelectorAll('.column-mods')) {
    const catId = col.closest('.category-column')?.dataset.category;
    if (catId) savedColScrolls[catId] = col.scrollTop;
  }
  columnsContainer.innerHTML = '';

  const allCats = orderedCatIds().map(catById);

  // Load order numbers for active mods
  const globalOrder = {};
  actualOrder.forEach((filename, i) => { globalOrder[filename] = i + 1; });

  // Render columns
  const pinnedPanel = document.getElementById('pinned-uncat-panel');
  const pinnedHandle = document.getElementById('pinned-resize-handle');
  // Preserve search value across re-renders
  const prevSearch = pinnedPanel.querySelector('.pinned-search-input');
  const searchVal = prevSearch ? prevSearch.value : '';
  pinnedPanel.innerHTML = '';

  for (const cat of allCats) {
    const column = createColumn(cat.id, cat.name, cat.color || '#555', globalOrder);
    if (uncategorizedPinned && cat.id === UNCATEGORIZED) {
      // Add search filter input
      const searchBox = document.createElement('div');
      searchBox.className = 'pinned-search';
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'pinned-search-input';
      searchInput.placeholder = t('search.placeholder');
      searchInput.value = searchVal;
      searchBox.appendChild(searchInput);

      searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
        const cards = pinnedPanel.querySelectorAll('.mod-card');
        cards.forEach((card) => {
          const name = card.querySelector('.card-name');
          const text = name ? name.textContent.toLowerCase() : '';
          card.style.display = text.includes(query) ? '' : 'none';
        });
      });

      pinnedPanel.appendChild(searchBox);
      pinnedPanel.appendChild(column);
      pinnedPanel.classList.remove('hidden');
      pinnedHandle.classList.remove('hidden');

      // Apply existing filter
      if (searchVal) {
        requestAnimationFrame(() => searchInput.dispatchEvent(new Event('input')));
      }
    } else {
      columnsContainer.appendChild(column);
    }
  }

  if (!uncategorizedPinned) {
    pinnedPanel.classList.add('hidden');
    pinnedHandle.classList.add('hidden');
  }

  // Clear just-moved tracking after cards are created
  justMovedMods.clear();

  // Restore scroll positions after layout
  requestAnimationFrame(() => {
    columnsContainer.scrollTop = savedScrollTop;
    columnsContainer.scrollLeft = savedScrollLeft;
    // Restore pinned panel scroll
    const newPinnedMods = document.querySelector('#pinned-uncat-panel .column-mods');
    if (newPinnedMods) newPinnedMods.scrollTop = savedPinnedScroll;
    // Restore per-column scroll positions
    for (const col of document.querySelectorAll('.column-mods')) {
      const catId = col.closest('.category-column')?.dataset.category;
      if (catId && savedColScrolls[catId]) col.scrollTop = savedColScrolls[catId];
    }
  });

  updateDetailPanel();
  selDrawnFor = selectedMod;
  updateDepStatus();
  afterRender();
}

function createColumn(catId, name, color, globalOrder) {
  const col = document.createElement('div');
  col.className = 'category-column';
  col.dataset.category = catId;
  const noLoad = catNoLoad(catId); // 🚫: its check boxes say what the mods get when they leave
  col.classList.toggle('km-noload', noLoad);

  // Header
  const header = document.createElement('div');
  header.className = 'column-header';
  header.style.borderTopColor = color;
  makeHeaderDraggable(header, catId);

  // Category toggle checkbox
  const catMods = getModsForCategory(catId);
  const activeInCat = catMods.filter((m) => m.active);
  const headerCb = document.createElement('input');
  headerCb.type = 'checkbox';
  headerCb.className = 'column-header-checkbox';
  headerCb.checked = catMods.length > 0 && catMods.every((m) => (noLoad ? m.parked : m.active));
  headerCb.addEventListener('click', (e) => {
    e.stopPropagation();
    const turnOn = headerCb.checked;
    for (const mod of catMods) {
      if (noLoad) mod.parked = turnOn && !mod.missing;
      else mod.active = turnOn;
    }
    syncModCategories();
    persistConfig();
    renderColumns();
  });

  const headerName = document.createElement('span');
  headerName.className = 'column-header-name';
  headerName.textContent = name;
  // Make name clickable to rename (not for uncategorized)
  if (catId !== UNCATEGORIZED) {
    headerName.classList.add('column-header-name-editable');
    headerName.title = t('category.clickRename');
    headerName.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cat = categories.find((c) => c.id === catId);
      if (!cat) return;
      const newName = await showInputModal(t('category.namePrompt'), cat.name);
      if (newName && newName.trim()) {
        cat.name = newName.trim();
        delete cat.def;
        syncModCategories();
        persistConfig();
        renderColumns();
      }
    });
  }

  const headerCount = document.createElement('span');
  headerCount.className = 'column-header-count';
  const modCountText = `${catMods.length}`;
  if (activeInCat.length > 0) {
    // Lowest and highest load order number (pinned mods can sit out of category order).
    const nums = activeInCat.map((m) => globalOrder[m.filename]).filter(Boolean);
    const first = Math.min(...nums);
    const last = Math.max(...nums);
    headerCount.textContent = `(${modCountText}) #${first}-${last}`;
  } else {
    headerCount.textContent = `(${modCountText})`;
  }

  // Collapse/expand button
  const minimizeBtn = document.createElement('span');
  minimizeBtn.className = 'column-move-btn km-min-btn';
  const isMinimized = minimizedCategories.has(catId);
  minimizeBtn.textContent = isMinimized ? '+' : '\u2212';
  minimizeBtn.title = isMinimized ? t('category.expand') : t('category.collapse');
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (minimizedCategories.has(catId)) {
      minimizedCategories.delete(catId);
    } else {
      minimizedCategories.add(catId);
    }
    renderColumns();
  });

  // (Right-click on the header: the category menu, cat-menus.js.)
  if (catId !== UNCATEGORIZED) {
    // Direction-aware move buttons
    const upIcon = verticalLayout ? '\u25B2' : '\u25C0';
    const downIcon = verticalLayout ? '\u25BC' : '\u25B6';

    function swapCategory(direction) {
      moveCategoryBy(catId, direction);
    }

    const moveUp = document.createElement('span');
    moveUp.className = 'column-move-btn';
    moveUp.textContent = upIcon;
    moveUp.title = verticalLayout ? t('category.moveUp') : t('category.moveLeft');
    moveUp.addEventListener('click', (e) => { e.stopPropagation(); swapCategory(-1); });

    const moveDown = document.createElement('span');
    moveDown.className = 'column-move-btn';
    moveDown.textContent = downIcon;
    moveDown.title = verticalLayout ? t('category.moveDown') : t('category.moveRight');
    moveDown.addEventListener('click', (e) => { e.stopPropagation(); swapCategory(1); });

    const headerRow1 = document.createElement('div');
    headerRow1.className = 'column-header-row';
    headerRow1.append(headerName, ...headerRenameButton(catId), headerCount);

    // Color button
    const colorBtn = document.createElement('span');
    colorBtn.className = 'column-move-btn';
    colorBtn.style.backgroundColor = color;
    colorBtn.style.width = '16px';
    colorBtn.style.height = '16px';
    colorBtn.style.borderRadius = '3px';
    colorBtn.style.display = 'inline-block';
    colorBtn.textContent = '';
    colorBtn.title = t('category.changeColorTooltip');
    colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      colorPicker.value = color;
      colorPicker.dataset.catId = catId;
      colorPicker.click();
    });

    // Delete button
    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'column-move-btn column-delete-btn';
    deleteBtn.textContent = '\u2715';
    deleteBtn.title = t('category.deleteTooltip');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cat = categories.find((c) => c.id === catId);
      if (!cat) return;
      const confirmed = await showConfirmModal(t('confirm.deleteCategory', { name: cat.name }));
      if (!confirmed) return;
      for (const mod of mods) {
        if (mod.category === cat.id) {
          mod.category = UNCATEGORIZED;
          delete modCategories[mod.filename];
        }
      }
      categories = categories.filter((c) => c.id !== cat.id);
      delete modOrders[cat.id];
      categories.sort((a, b) => a.order - b.order).forEach((c, i) => c.order = i);
      syncModCategories();
      persistConfig();
      renderColumns();
    });

    const headerRow2 = document.createElement('div');
    headerRow2.className = 'column-header-row';
    headerRow1.append(headerSpacer(), headerNoLoadButton(catId), deleteBtn);
    headerRow2.append(headerCb, moveUp, moveDown, colorBtn, minimizeBtn, headerSpacer(), ...headerFitButtons(catId), headerSortButton(catId));

    header.append(headerRow1, headerRow2);
  } else {
    const headerRow1 = document.createElement('div');
    headerRow1.className = 'column-header-row';
    headerRow1.append(headerName, headerCount, headerSpacer(), headerNoLoadButton(catId)); // 🚫 where the others have it, by ✕

    const headerRow2 = document.createElement('div');
    headerRow2.className = 'column-header-row';
    headerRow2.append(headerCb, ...headerMoveButtons(catId), minimizeBtn, headerSpacer(), ...headerFitButtons(catId), headerSortButton(catId));

    header.append(headerRow1, headerRow2);
  }

  col.appendChild(header);

  // Mod list
  const modsList = document.createElement('div');
  modsList.className = 'column-mods';
  if (minimizedCategories.has(catId)) {
    modsList.classList.add('hidden');
    // Side by side it becomes a narrow strip (style.css); a click on it opens it again.
    col.classList.add('km-collapsed');
    header.addEventListener('click', (e) => {
      if (verticalLayout || e.target.closest('.km-min-btn')) return;
      minimizedCategories.delete(catId);
      renderColumns();
    });
  }
  modsList.dataset.category = catId;

  for (const mod of catMods) {
    modsList.appendChild(createModCard(mod, color, globalOrder));
  }

  // Drop zone for the column (empty area)
  modsList.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Only highlight column if not over a card
    if (e.target === modsList) {
      col.classList.add('drag-over-column');
    }
  });

  modsList.addEventListener('dragleave', (e) => {
    if (e.target === modsList) {
      col.classList.remove('drag-over-column');
    }
  });

  modsList.addEventListener('drop', (e) => {
    e.preventDefault();
    col.classList.remove('drag-over-column');
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    const filenames = data.split('\n').filter(Boolean);

    // If dropping on empty area of column, append to end
    if (e.target === modsList || e.target === col) {
      const isBulk = filenames.length > 1;
      for (const fn of filenames) {
        const mod = mods.find((m) => m.filename === fn);
        if (mod) moveMod(mod, catId, null, isBulk);
      }
      if (isBulk) { syncModCategories(); persistConfig(); renderColumns(); }
    }
  });

  col.appendChild(modsList);
  return col;
}

function createModCard(mod, catColor, globalOrder) {
  const card = document.createElement('div');
  card.className = 'mod-card';
  card.style.borderLeftColor = catColor;
  if (!mod.active) card.classList.add('inactive');
  if (selectedMods.has(mod.filename) || (selectedMod && selectedMod.filename === mod.filename)) card.classList.add('selected');

  // Flash animation for just-moved mods
  if (justMovedMods.has(mod.filename)) {
    card.classList.add('mod-placed');
    card.addEventListener('animationend', () => card.classList.remove('mod-placed'), { once: true });
  }
  card.dataset.filename = mod.filename;

  // Load order number (replaces drag handle)
  const handle = document.createElement('span');
  handle.className = 'card-handle';
  const num = globalOrder[mod.filename];
  handle.textContent = num != null ? num : '';

  // Checkbox
  const cbWrap = document.createElement('span');
  cbWrap.className = 'card-checkbox';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  // In a 🚫 category the box says whether the mod is on once it leaves (it doesn't load here).
  const parkedHere = !mod.missing && catNoLoad(mod.category);
  cb.checked = parkedHere ? !!mod.parked : mod.active;
  if (parkedHere) { cbWrap.classList.add('km-parked'); cb.title = t('noLoad.parkedTip'); }
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (catNoLoad(mod.category) && !mod.missing) {
      const targets = selectedMods.has(mod.filename) ? mods.filter((m) => selectedMods.has(m.filename) && !m.missing && catNoLoad(m.category)) : [mod];
      for (const m of targets) m.parked = cb.checked;
      persistConfig();
      renderColumns();
      return;
    }
    toggleModActive(mod);
  });
  cb.addEventListener('click', (e) => e.stopPropagation());
  cbWrap.appendChild(cb);

  // Name
  const name = document.createElement('span');
  name.className = 'card-name';
  name.textContent = mod.displayName;

  // Source badge
  const src = document.createElement('span');
  src.className = 'card-source';
  const badge = document.createElement('span');
  badge.className = 'source-badge ' + mod.source;
  badge.textContent = mod.source;
  src.appendChild(badge);

  // Link badge for symlinked Steam mods
  let linkBadge = null;
  if (mod.source === 'steam' && linkedMods.has(mod.realFile)) {
    linkBadge = document.createElement('span');
    linkBadge.className = 'link-badge';
    linkBadge.textContent = '\uD83D\uDD17';
    linkBadge.title = t('symlinks.linked');
  }

  // Conflict indicator + highlight
  const cardItems = [handle, cbWrap, name];
  if (conflictData && conflictData.modConflicts[mod.realFile]) {
    const count = conflictData.modConflicts[mod.realFile].length;
    const badge = document.createElement('span');
    badge.className = 'conflict-count-badge';
    badge.textContent = count;
    cardItems.push(badge);
  }
  if (linkBadge) cardItems.push(linkBadge);
  const sameName = sameNameCopies(mod).length;
  if (sameName) {
    const copies = document.createElement('span');
    copies.className = 'km-copies-badge';
    copies.textContent = '×' + (sameName + 1);
    copies.title = t('card.copies', { count: sameName + 1 });
    cardItems.push(copies);
  }
  if (pins.has(mod.filename) && mod.active) {
    const pin = document.createElement('span');
    pin.className = 'km-pin';
    pin.textContent = '📌';
    pin.title = t('pin.tip');
    cardItems.push(pin);
  }
  cardItems.push(src);
  card.append(...cardItems);

  // Highlight mods this selection conflicts with
  if (selectedMod && conflictData && selectedMod.filename !== mod.filename) {
    const selConflicts = conflictData.modConflicts[selectedMod.realFile];
    if (selConflicts) {
      const relationship = getConflictRelationship(selectedMod.realFile, mod.realFile, selConflicts);
      if (relationship === 'overwriting') {
        card.classList.add('conflict-highlight-green');
      } else if (relationship === 'overwritten') {
        card.classList.add('conflict-highlight-red');
      } else if (relationship === 'dead') {
        card.classList.add('conflict-highlight-yellow');
      }
    }
  }

  // Dependency warnings — all problems highlighted in red
  if (mod.active) {
    const modDeps = (mod.dependencies || []).concat(mod.references || []);
    if (modDeps.length > 0) {
      const problems = [];

      for (const dep of modDeps) {
        const depMod = findDepMod(dep);
        if (!depMod) {
          // Missing: dependency not installed at all
          problems.push(`${dep} — ${t('deps.notInstalled')}`);
        } else if (!depMod.active) {
          // Inactive: dependency exists but is disabled
          problems.push(`${dep} — ${t('deps.notActive')}`);
        } else if (globalOrder[mod.filename] && globalOrder[depMod.filename]
            && globalOrder[mod.filename] < globalOrder[depMod.filename]) {
          // Wrong order: this mod loads before its dependency
          problems.push(`${dep} — ${t('deps.loadsAfter')}`);
        }
      }

      if (problems.length > 0) {
        card.classList.add('dep-highlight-red');
        card.title = problems.join('\n');
      }
    }
  }

  // Click to select (with multi-select support)
  card.addEventListener('click', (e) => {
    MARKS.ack([mod.filename]); // its 🆕 ⟳ 🌐 go (editing.js)
    if (e.shiftKey && lastClickedMod) {
      // Shift+click: range select within the same category
      const catMods = getModsForCategory(mod.category);
      const startIdx = catMods.findIndex((m) => m.filename === lastClickedMod.filename);
      const endIdx = catMods.findIndex((m) => m.filename === mod.filename);
      if (startIdx >= 0 && endIdx >= 0) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        for (let i = lo; i <= hi; i++) {
          selectedMods.add(catMods[i].filename);
        }
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle individual selection
      ctrlToggle(mod);
      redrawSelection();
      return;
    } else {
      // Normal click: single select
      selectedMods.clear();
      selectedMods.add(mod.filename);
    }
    selectedMod = mod;
    lastClickedMod = mod;
    redrawSelection();
  });

  // Right-click to assign category (bulk if multi-selected)
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicking a non-selected mod, switch selection to it
    if (!selectedMods.has(mod.filename)) {
      selectedMods.clear();
      selectedMods.add(mod.filename);
      selectedMod = mod;
    }
    showModContextMenu(e.clientX, e.clientY, mod);
  });

  // Drag
  card.draggable = true;

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    // If dragging a selected mod, include all selected mods
    if (selectedMods.has(mod.filename) && selectedMods.size > 1) {
      e.dataTransfer.setData('text/plain', [...selectedMods].join('\n'));

      // Custom drag image showing all selected mods
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      const names = [...selectedMods].slice(0, 5).map((fn) => {
        const m = mods.find((mod) => mod.filename === fn);
        return m ? m.displayName : fn;
      });
      ghost.innerHTML = names.map((n) => `<div class="drag-ghost-item">${n}</div>`).join('');
      if (selectedMods.size > 5) {
        ghost.innerHTML += `<div class="drag-ghost-more">+${selectedMods.size - 5} more</div>`;
      }
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 10);
      requestAnimationFrame(() => document.body.removeChild(ghost));
    } else {
      e.dataTransfer.setData('text/plain', mod.filename);
    }
    requestAnimationFrame(() => card.classList.add('dragging'));
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over-card, .drag-over-column, .drop-above, .drop-below').forEach((el) => {
      el.classList.remove('drag-over-card', 'drag-over-column', 'drop-above', 'drop-below');
    });
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    // Show insertion indicator based on cursor position (top/bottom half)
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    card.classList.remove('drop-above', 'drop-below');
    if (e.clientY < midY) {
      card.classList.add('drop-above');
    } else {
      card.classList.add('drop-below');
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drop-above', 'drop-below');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedAbove = card.classList.contains('drop-above');
    card.classList.remove('drop-above', 'drop-below');
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    const filenames = data.split('\n').filter(Boolean);
    if (filenames.length === 0 || (filenames.length === 1 && filenames[0] === mod.filename)) return;

    // Insert before this card (if dropped above) or after (if dropped below)
    const beforeFilename = droppedAbove ? mod.filename : null;
    const afterFilename = droppedAbove ? null : mod.filename;

    const isBulk = filenames.length > 1;
    for (const fn of filenames) {
      const draggedMod = mods.find((m) => m.filename === fn);
      if (draggedMod && draggedMod.filename !== mod.filename) {
        if (droppedAbove) {
          moveMod(draggedMod, mod.category, mod.filename, isBulk);
        } else {
          const catMods = getModsForCategory(mod.category);
          const idx = catMods.findIndex((m) => m.filename === mod.filename);
          const nextMod = idx >= 0 && idx < catMods.length - 1 ? catMods[idx + 1].filename : null;
          moveMod(draggedMod, mod.category, nextMod, isBulk);
        }
      }
    }
    if (isBulk) { syncModCategories(); persistConfig(); renderColumns(); }
  });

  return card;
}

// ===== Drag Move =====

function moveMod(mod, targetCatId, beforeFilename, skipRender) {
  mod.category = targetCatId;
  modCategories[mod.filename] = targetCatId === UNCATEGORIZED ? undefined : targetCatId;
  if (targetCatId === UNCATEGORIZED) delete modCategories[mod.filename];

  // Remove from all order lists
  for (const key of Object.keys(modOrders)) {
    modOrders[key] = (modOrders[key] || []).filter((f) => f !== mod.filename);
  }

  // Insert into target
  if (!modOrders[targetCatId]) modOrders[targetCatId] = [];
  const targetList = modOrders[targetCatId];

  if (beforeFilename) {
    const idx = targetList.indexOf(beforeFilename);
    if (idx >= 0) {
      targetList.splice(idx, 0, mod.filename);
    } else {
      targetList.push(mod.filename);
    }
  } else {
    targetList.push(mod.filename);
  }

  justMovedMods.add(mod.filename);
  if (!skipRender) {
    syncModCategories();
    persistConfig();
    renderColumns();
  }
}

// ===== Active/Inactive Toggle =====

function toggleModActive(mod) {
  mod.active = !mod.active;
  syncModCategories();
  persistConfig();
  renderColumns();
}

// ===== Context Menu =====

function clampMenuPosition(menu, x, y) {
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (x + w > window.innerWidth) x = window.innerWidth - w - 4;
  if (y + h > window.innerHeight) y = window.innerHeight - h - 4;
  if (x < 0) x = 4;
  if (y < 0) y = 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

const modContextMenu = document.getElementById('mod-context-menu');
const modContextCategories = document.getElementById('mod-context-categories');
let modContextTarget = null;

function hideContextMenu() {
  modContextMenu.classList.add('hidden');
  modContextTarget = null;
}

document.getElementById('mod-context-open-folder').addEventListener('click', () => {
  if (modContextTarget && modContextTarget.filePath) {
    window.api.showInFolder(modContextTarget.filePath);
  }
  hideContextMenu();
});

document.getElementById('mod-context-create-links').addEventListener('click', async () => {
  const bulkMods = selectedMods.size > 1
    ? mods.filter(m => selectedMods.has(m.filename))
    : (modContextTarget ? [modContextTarget] : []);
  const steamMods = bulkMods.filter(m => m.source === 'steam' && !linkedMods.has(m.realFile));
  hideContextMenu();
  if (steamMods.length === 0) return;

  setStatus(t('status.creatingLinks', { count: steamMods.length }));
  try {
    const result = await window.api.createModLinks({
      gamePath: config.gamePath,
      mods: steamMods.map(m => ({ filename: m.realFile, filePath: m.filePath }))
    });
    if (result.needsAdmin) {
      setStatus(t('status.linksNeedAdmin'), 'error');
      const restart = confirm(t('confirm.adminRelaunch'));
      if (restart) window.api.relaunchAsAdmin();
      return;
    }
    for (const fn of result.created) linkedMods.add(fn);
    renderColumns();
    if (result.errors.length > 0) {
      setStatus(t('status.linksPartial', { count: result.created.length, errors: result.errors.length }), 'error');
    } else {
      setStatus(t('status.linksCreated', { count: result.created.length }), 'success');
    }
  } catch (err) {
    setStatus(t('status.linkError', { error: err.message }), 'error');
  }
});

document.getElementById('mod-context-remove-links').addEventListener('click', async () => {
  const bulkMods = selectedMods.size > 1
    ? mods.filter(m => selectedMods.has(m.filename))
    : (modContextTarget ? [modContextTarget] : []);
  const steamMods = bulkMods.filter(m => m.source === 'steam' && linkedMods.has(m.realFile));
  hideContextMenu();
  if (steamMods.length === 0) return;

  setStatus(t('status.removingLinks', { count: steamMods.length }));
  try {
    const result = await window.api.removeModLinks({
      gamePath: config.gamePath,
      mods: steamMods.map(m => ({ filename: m.realFile, filePath: m.filePath }))
    });
    for (const fn of result.removed) linkedMods.delete(fn);
    renderColumns();
    if (result.errors.length > 0) {
      setStatus(t('status.unlinksPartial', { count: result.removed.length, errors: result.errors.length }), 'error');
    } else {
      setStatus(t('status.linksRemoved', { count: result.removed.length }), 'success');
    }
  } catch (err) {
    setStatus(t('status.linkError', { error: err.message }), 'error');
  }
});

// Send to # — reposition mod to a global load order position
const sendToEl = document.getElementById('mod-context-send-to');
sendToEl.addEventListener('click', (e) => e.stopPropagation());
sendToEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const input = e.target;
  const pos = parseInt(input.value, 10);
  if (!modContextTarget || isNaN(pos)) return;

  const mod = modContextTarget;
  // The mod (or the selection) lands at that number in the actual order and is pinned
  // there; its category stays as it is.
  const files = selectedMods.has(mod.filename) && selectedMods.size > 1
    ? computeLoadOrder().filter((f) => selectedMods.has(f)).concat([...selectedMods].filter((f) => !actualOrder.includes(f)))
    : [mod.filename];
  setPosition(files, pos);
  commitLayout();
  hideContextMenu();
});

function showModContextMenu(x, y, mod) {
  hideContextMenu();
  modContextTarget = mod;

  // Get all selected mods for bulk move
  const bulkMods = selectedMods.size > 1
    ? mods.filter((m) => selectedMods.has(m.filename))
    : [mod];

  // Show/hide symlink options based on selection
  const linkSep = document.getElementById('mod-context-link-separator');
  const createLinksItem = document.getElementById('mod-context-create-links');
  const removeLinksItem = document.getElementById('mod-context-remove-links');
  const steamInSelection = bulkMods.filter(m => m.source === 'steam');
  const unlinkedSteam = steamInSelection.filter(m => !linkedMods.has(m.realFile));
  const linkedSteam = steamInSelection.filter(m => linkedMods.has(m.realFile));

  if (steamInSelection.length > 0) {
    linkSep.classList.remove('hidden');
    if (unlinkedSteam.length > 0) {
      createLinksItem.classList.remove('hidden');
      createLinksItem.textContent = unlinkedSteam.length > 1
        ? t('context.createLinksCount', { count: unlinkedSteam.length })
        : t('context.createLinks');
    } else {
      createLinksItem.classList.add('hidden');
    }
    if (linkedSteam.length > 0) {
      removeLinksItem.classList.remove('hidden');
      removeLinksItem.textContent = linkedSteam.length > 1
        ? t('context.removeLinksCount', { count: linkedSteam.length })
        : t('context.removeLinks');
    } else {
      removeLinksItem.classList.add('hidden');
    }
  } else {
    linkSep.classList.add('hidden');
    createLinksItem.classList.add('hidden');
    removeLinksItem.classList.add('hidden');
  }

  // Send to # — show global load order position range
  const sendToInput = document.getElementById('mod-context-send-to');
  const sendToRange = document.getElementById('mod-context-send-range');
  const totalActive = mods.filter(m => m.active).length;
  sendToInput.value = '';
  sendToInput.max = totalActive;
  sendToInput.placeholder = '1';
  sendToRange.textContent = `(1–${totalActive})`;

  // Build category list
  modContextCategories.innerHTML = '';

  // Show count header if bulk
  if (bulkMods.length > 1) {
    const header = document.createElement('div');
    header.className = 'context-item';
    header.style.cssText = 'color:#8ab4f8;font-weight:600;cursor:default;font-size:10px;';
    header.textContent = t('moveMods', { count: bulkMods.length });
    modContextCategories.appendChild(header);
  }

  const allCats = [...categories].sort((a, b) => a.order - b.order);
  allCats.push({ id: UNCATEGORIZED, name: uncatName(), color: '#555' });

  for (const cat of allCats) {
    // For single mod, skip current category
    if (bulkMods.length === 1 && cat.id === mod.category) continue;
    const item = document.createElement('div');
    item.className = 'context-item';
    const dot = document.createElement('span');
    dot.className = 'context-cat-dot';
    dot.style.backgroundColor = cat.color;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(cat.name));
    item.addEventListener('click', () => {
      for (const m of bulkMods) {
        moveMod(m, cat.id, null, true);
      }
      syncModCategories();
      persistConfig();
      renderColumns();
      selectedMods.clear();
      hideContextMenu();
    });
    modContextCategories.appendChild(item);
  }

  updatePinMenu(bulkMods);
  KMT_BRIDGE.contextShown(bulkMods); // 한글화 작업 / 패치 작업 (kmt-bridge.js)
  clampMenuPosition(modContextMenu, x, y);
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.column-header') && !e.target.closest('.mod-card')) {
    hideContextMenu();
  }
});

// Category color (the hidden color input) and delete (its mods go to Uncategorized).
function pickCategoryColor(catId) {
  const cat = catById(catId);
  if (!cat) return;
  colorPicker.value = cat.color;
  colorPicker.dataset.catId = cat.id;
  colorPicker.click();
}

function removeCategory(catId) {
  for (const mod of mods) {
    if (mod.category === catId) {
      mod.category = UNCATEGORIZED;
      delete modCategories[mod.filename];
    }
  }
  categories = categories.filter((c) => c.id !== catId);
  delete modOrders[catId];
  // Reindex order
  categories.sort((a, b) => a.order - b.order).forEach((c, i) => c.order = i);
}

function deleteCategory(catId) {
  if (catId === UNCATEGORIZED || !catById(catId)) return;
  removeCategory(catId);
  syncModCategories();
  persistConfig();
  renderColumns();
}

colorPicker.addEventListener('input', () => {
  const catId = colorPicker.dataset.catId;
  const cat = categories.find((c) => c.id === catId);
  if (cat) {
    cat.color = colorPicker.value;
    syncModCategories();
    persistConfig();
    renderColumns();
  }
});

// ===== Add Category =====

addCategoryBtn.addEventListener('click', () => {
  // Build position options for the select
  const sorted = [...categories].sort((a, b) => a.order - b.order);

  // Create a custom modal with name input + position select
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const box = document.createElement('div');
  box.className = 'modal-box';
  box.style.minWidth = '320px';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = t('category.newTitle');

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'modal-input';
  nameInput.placeholder = 'Category name...';
  nameInput.autocomplete = 'off';
  nameInput.style.marginBottom = '10px';

  const posLabel = document.createElement('div');
  posLabel.style.cssText = 'font-size:11px;color:#888;margin-bottom:4px;';
  posLabel.textContent = t('category.loadBefore');

  const posSelect = document.createElement('select');
  posSelect.className = 'modal-input';
  posSelect.style.marginBottom = '10px';

  for (const cat of sorted) {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    posSelect.appendChild(opt);
  }
  const endOpt = document.createElement('option');
  endOpt.value = '__end__';
  endOpt.textContent = t('category.atEnd');
  endOpt.selected = true;
  posSelect.appendChild(endOpt);

  const buttons = document.createElement('div');
  buttons.className = 'modal-buttons';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = t('modal.cancel');
  const okBtn = document.createElement('button');
  okBtn.className = 'btn btn-primary';
  okBtn.textContent = t('modal.ok');

  buttons.append(cancelBtn, okBtn);
  box.append(title, nameInput, posLabel, posSelect, buttons);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  nameInput.focus();

  function close() { document.body.removeChild(overlay); }

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') okBtn.click();
    if (e.key === 'Escape') close();
  });

  okBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;

    const posId = posSelect.value;
    const insertOrder = posId === '__end__' ? categories.length : categories.find((c) => c.id === posId)?.order ?? categories.length;

    for (const c of categories) {
      if (c.order >= insertOrder) c.order++;
    }

    const newCat = {
      id: generateId(),
      name,
      color: randomColor(),
      order: insertOrder,
    };
    categories.push(newCat);
    modOrders[newCat.id] = [];
    syncModCategories();
    persistConfig();
    renderColumns();
    close();
  });
});

// ===== Reset Categories =====

const resetCategoriesBtn = document.getElementById('reset-categories-btn');
resetCategoriesBtn.addEventListener('click', async () => {
  const confirmed = await showConfirmModal(t('confirm.resetCategories'));
  if (!confirmed) return;

  // Move all mods to uncategorized
  for (const mod of mods) {
    mod.category = UNCATEGORIZED;
  }
  modCategories = {};
  modOrders = {};

  // Rebuild defaults
  categories = DEFAULT_CATEGORIES.map((def, i) => ({
    id: generateId(),
    name: def.name,
    color: def.color,
    order: i,
  }));

  syncModCategories();
  persistConfig();
  renderColumns();
  setStatus(t('status.categoriesReset'), 'success');
});

// ===== Detail Panel Tabs =====

const tabDetails = document.getElementById('tab-details');
const tabModpage = document.getElementById('tab-modpage');
const tabTutorial = document.getElementById('tab-tutorial');
const tabConflicts = document.getElementById('tab-conflicts');
const tabGuide = document.getElementById('tab-guide');
const tabPacks = document.getElementById('tab-packs');
const tabWorkshop = document.getElementById('tab-workshop');
const detailView = document.getElementById('detail-view');
const modpageView = document.getElementById('modpage-view');
const tutorialView = document.getElementById('tutorial-view');
const conflictsView = document.getElementById('conflicts-view');
const guideView = document.getElementById('guide-view');
const packsView = document.getElementById('packs-view');
const workshopView = document.getElementById('workshop-view');

function switchTab(activeTab) {
  const tabs = [tabDetails, tabModpage, tabTutorial, tabConflicts, tabGuide, tabPacks, tabWorkshop];
  const views = [detailView, modpageView, tutorialView, conflictsView, guideView, packsView, workshopView];
  tabs.forEach((t, i) => {
    t.classList.toggle('active', t === activeTab);
    views[i].classList.toggle('hidden', t !== activeTab);
  });
}

tabDetails.addEventListener('click', () => switchTab(tabDetails));
tabTutorial.addEventListener('click', () => switchTab(tabTutorial));
tabGuide.addEventListener('click', () => switchTab(tabGuide));
tabModpage.addEventListener('click', () => {
  if (selectedMod && selectedMod.url) {
    modpageView.src = selectedMod.url;
  }
  switchTab(tabModpage);
});
tabConflicts.addEventListener('click', () => {
  switchTab(tabConflicts);
  renderConflictsTab();
});

// Conflict focus toggle — dims non-conflicting mods
const conflictFocusCb = document.getElementById('conflict-focus-cb');
conflictFocusCb.addEventListener('change', () => {
  document.getElementById('category-columns').classList.toggle('conflict-focus-active', conflictFocusCb.checked);
  const pinnedPanel = document.getElementById('pinned-uncat-panel');
  pinnedPanel.classList.toggle('conflict-focus-active', conflictFocusCb.checked);
});
tabPacks.addEventListener('click', () => {
  switchTab(tabPacks);
  refreshPacksList();
});
tabWorkshop.addEventListener('click', () => switchTab(tabWorkshop));

// ===== Mod Packs =====

const savePackBtn = document.getElementById('save-pack-btn');
const packsList = document.getElementById('packs-list');

savePackBtn.addEventListener('click', async () => {
  const name = await showInputModal(t('packs.savePrompt'), '');
  if (!name || !name.trim()) return;
  const pack = buildPack(name.trim());
  await window.api.savePack(pack);
  setStatus(t('status.packSaved', { name: pack.name }), 'success');
  refreshPacksList();
});

// The preset of the current state (saved by the user, or an auto preset).
function buildPack(name) {
  return {
    name,
    savedAt: new Date().toISOString(),
    categories: JSON.parse(JSON.stringify(categories)),
    modCategories: { ...modCategories },
    modOrders: JSON.parse(JSON.stringify(modOrders)),
    activeMods: mods.filter((m) => m.active).map((m) => m.filename), // (older versions read this)
    // each copy's place and on/off (same-name copies apart), the actual order with its 📌 pins
    placement: mods.map((m) => [layoutKeyOf(m), m.category]),
    active: mods.filter((m) => m.active).map(layoutKeyOf),
    order: [...actualOrder],
    pins: [...pins],
    uncatPos: uncatPos(),
    uncatNoLoad: config.uncatNoLoad === true, // 🚫 (the other categories carry theirs)
    parked: parkedKeys(),
    // sort rules: the default and Uncategorized's (the other categories carry theirs)
    sortDefault: structuredClone(config.sortDefault ?? null),
    uncatSort: structuredClone(config.uncatSort ?? null),
  };
}

// ===== Auto presets =====
// With "auto presets" on (Settings), a save to the game leaves a preset "Auto save <date time>"
// (auto: true), unless it is the same as the newest one. The newest AUTO_PACK_KEEP are kept, older
// ones go to the Recycle Bin. The user's own presets are never touched.
const AUTO_PACK_KEEP = 10;
const packContent = (p) => { const { name, savedAt, auto, ...rest } = p; return JSON.stringify(rest); };

async function autoPackAfterSave() {
  if (!config?.autoPreset) return;
  try {
    const packs = await window.api.getPacks();
    const autos = packs.filter((p) => p.auto).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    const d = new Date();
    const p2 = (v) => String(v).padStart(2, '0');
    const base = t('autoPack.name', { time: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}` });
    const names = new Set(packs.map((p) => p.name));
    let name = base;
    for (let i = 2; names.has(name); i++) name = `${base} (${i})`;
    const pack = { ...buildPack(name), auto: true };
    if (autos[0] && packContent(autos[0]) === packContent(pack)) return;
    await window.api.savePack(pack);
    for (const old of autos.slice(AUTO_PACK_KEEP - 1)) await window.api.trashPack(old.name);
    if (tabPacks.classList.contains('active')) refreshPacksList();
  } catch (e) {
    console.warn('auto preset:', e);
  }
}

async function refreshPacksList() {
  const all = await window.api.getPacks();
  packsList.innerHTML = '';

  if (all.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'detail-placeholder';
    empty.textContent = t('packs.noPacks');
    empty.style.marginTop = '20px';
    packsList.appendChild(empty);
    return;
  }

  // The user's own presets, then the auto presets (newest first) under a grey heading.
  const autos = all.filter((p) => p.auto).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  const packs = [...all.filter((p) => !p.auto), ...autos];
  for (const pack of packs) {
    if (pack === autos[0]) {
      const head = document.createElement('div');
      head.className = 'pack-group-head';
      head.textContent = t('autoPack.heading');
      packsList.appendChild(head);
    }
    const item = document.createElement('div');
    item.className = 'pack-item';

    const info = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'pack-name';
    nameEl.textContent = pack.name;
    const meta = document.createElement('div');
    meta.className = 'pack-meta';
    const date = new Date(pack.savedAt);
    meta.textContent = `${pack.activeMods?.length || 0} mods \u00B7 ${date.toLocaleDateString()}`;
    info.append(nameEl, meta);

    const actions = document.createElement('div');
    actions.className = 'pack-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn btn-primary';
    loadBtn.textContent = t('packs.load');
    loadBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal(t('confirm.loadPack', { name: pack.name }));
      if (!confirmed) return;
      applyPack(pack);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger-subtle';
    delBtn.textContent = t('packs.del');
    delBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal(t('confirm.deletePack', { name: pack.name }));
      if (!confirmed) return;
      await window.api.deletePack(pack.name);
      refreshPacksList();
      setStatus(t('status.packDeleted', { name: pack.name }), 'success');
    });

    const cmpBtn = document.createElement('button');
    cmpBtn.className = 'btn';
    cmpBtn.textContent = t('packCmp.btn');
    cmpBtn.title = t('packCmp.btnTip');
    cmpBtn.addEventListener('click', () => comparePacks(pack, packs));

    actions.append(loadBtn, cmpBtn, delBtn);
    item.append(info, actions);
    packsList.appendChild(item);
  }
}

// ===== Compare presets =====
// A preset next to the current state or another preset: the mods on in only one of them, and how
// many of the mods on in both load in another order.
function packSide(pack) {
  if (!pack) {
    const on = mods.filter((m) => m.active && !m.missing);
    return { keys: on.map((m) => m.filename), order: loadOrderFiles() };
  }
  // keys: newer presets keep the file paths of the mods (copies apart), older ones the file names
  const byPath = new Map(mods.filter((m) => m.filePath).map((m) => [m.filePath, m.filename]));
  const keyOf = (k) => (k.startsWith('missing:') ? k.slice(8) : byPath.get(k) || k.split(/[\\/]/).pop());
  const keys = (pack.active || pack.activeMods || []).map(keyOf);
  return { keys, order: (pack.order || pack.activeMods || []).map((k) => (String(k).includes('\\') ? keyOf(k) : k)) };
}

function comparePacks(pack, packs) {
  const { box, close } = openWideModal('km-pack-cmp');
  let other = ''; // '' = the current state, else the other preset's name
  const label = (k) => modByFile(k)?.displayName || String(k).replace(/\.mod$/i, '');
  const draw = () => {
    const a = packSide(pack);
    const b = packSide(other ? packs.find((p) => p.name === other) : null);
    const inA = new Set(a.keys), inB = new Set(b.keys);
    const onlyA = a.keys.filter((k) => !inB.has(k)).map(label).sort((x, y) => x.localeCompare(y));
    const onlyB = b.keys.filter((k) => !inA.has(k)).map(label).sort((x, y) => x.localeCompare(y));
    // the mods on in both: the ones whose place among them differs
    const both = (list) => list.filter((k) => inA.has(k) && inB.has(k));
    const oa = both(a.order), ob = both(b.order);
    const moved = oa.length === ob.length ? oa.filter((k, i) => ob[i] !== k).length : 0;
    const bName = other || t('packCmp.current');
    const col = (title, list) => `<div class="pack-cmp-col"><div class="pack-cmp-head">${escapeText(title)} <span class="km-muted">${list.length}</span></div>
      ${list.length ? `<ul>${list.map((n) => `<li>${escapeText(n)}</li>`).join('')}</ul>` : `<div class="km-muted">${escapeText(t('packCmp.none'))}</div>`}</div>`;
    box.innerHTML = `<div class="modal-title">${escapeText(t('packCmp.title'))}</div>
      <div class="pack-cmp-pick"><b>${escapeText(pack.name)}</b> ↔
        <select class="modal-input km-narrow" data-r="other">
          <option value="" ${other ? '' : 'selected'}>${escapeText(t('packCmp.current'))}</option>
          ${packs.filter((p) => p.name !== pack.name).map((p) => `<option value="${escapeText(p.name)}" ${p.name === other ? 'selected' : ''}>${escapeText(p.name)}</option>`).join('')}
        </select></div>
      <div class="pack-cmp-cols">${col(t('packCmp.onlyIn', { name: pack.name }), onlyA)}${col(t('packCmp.onlyIn', { name: bName }), onlyB)}</div>
      <div class="km-muted">${escapeText(!onlyA.length && !onlyB.length && !moved ? t('packCmp.same') : t('packCmp.moved', { n: moved }))}</div>
      <div class="modal-buttons"><button class="btn btn-primary" data-r="close">${escapeText(t('exp.close'))}</button></div>`;
  };
  box.addEventListener('change', (e) => { if (e.target.dataset.r === 'other') { other = e.target.value; draw(); } });
  box.addEventListener('click', (e) => { if (e.target.closest('[data-r="close"]')) close(); });
  draw();
}

async function applyPack(pack) {
  // Restore categories
  categories = pack.categories || [];
  modCategories = pack.modCategories || {};
  modOrders = pack.modOrders || {};

  if (pack.placement) {
    // Each copy back to its place and on/off; the actual order as saved (📌 pins kept, and
    // more pins where mods came or went since)
    const placement = new Map(pack.placement);
    const active = new Set(pack.active || []);
    const parked = new Set(pack.parked || []);
    for (const mod of mods) {
      mod.category = placement.get(layoutKeyOf(mod)) || UNCATEGORIZED;
      if (mod.category !== UNCATEGORIZED && !categories.some((c) => c.id === mod.category)) mod.category = UNCATEGORIZED;
      mod.active = active.has(layoutKeyOf(mod));
      mod.parked = parked.has(layoutKeyOf(mod));
    }
    if (Number.isInteger(pack.uncatPos)) config.uncatPos = pack.uncatPos;
    if (typeof pack.uncatNoLoad === 'boolean') config.uncatNoLoad = pack.uncatNoLoad;
    if ('sortDefault' in pack) { if (pack.sortDefault) config.sortDefault = structuredClone(pack.sortDefault); else delete config.sortDefault; }
    if ('uncatSort' in pack) { if (pack.uncatSort) config.uncatSort = structuredClone(pack.uncatSort); else delete config.uncatSort; }
    syncModCategories();
    pins = new Set(pack.pins || []);
    adoptOrder(pack.order || [], true);
  } else {
    // A pack from an older version: on/off by file name, the order from the categories
    const activeSet = new Set(pack.activeMods || []);
    for (const mod of mods) {
      mod.active = activeSet.has(mod.filename);
    }
    applyCategoriesToMods();
    syncModCategories();
    pins.clear();
    rebuildOrder([]);
  }
  await persistConfig();
  renderColumns();

  modCount.textContent = t('modCount', { total: mods.length, active: mods.filter((m) => m.active).length });
  setStatus(t('status.packLoaded', { name: pack.name }), 'success');
}

// ===== AI Sort =====

// AI Sort Guide modal (kept for reference, opened from tutorial)
const aiGuideModal = document.getElementById('ai-guide-modal');
const aiGuideClose = document.getElementById('ai-guide-close');
if (aiGuideClose) {
  aiGuideClose.addEventListener('click', () => {
    aiGuideModal.classList.add('hidden');
  });
}

const aiExportBtn = document.getElementById('ai-export-btn');
const aiImportBtn = document.getElementById('ai-import-btn');

function getWorkshopId(mod) {
  const parts = mod.filePath.replace(/\\/g, '/').split('/');
  const contentIdx = parts.indexOf('content');
  if (contentIdx >= 0 && contentIdx + 2 < parts.length) {
    return parts[contentIdx + 2];
  }
  return null;
}

const BATCH_SIZE = 50;

function showExportChoiceModal() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('ai-export-modal');
    const uncatBtn = document.getElementById('ai-export-uncat');
    const uncatCompactBtn = document.getElementById('ai-export-uncat-compact');
    const compactBtn = document.getElementById('ai-export-compact');
    const allBtn = document.getElementById('ai-export-all');
    const splitBtn = document.getElementById('ai-export-split');
    const cancelBtn = document.getElementById('ai-export-cancel');
    const warning = document.getElementById('ai-export-warning');

    const activeMods = mods.filter((m) => m.active);
    const uncatCount = activeMods.filter((m) => m.category === UNCATEGORIZED).length;
    const sortedCount = activeMods.length - uncatCount;
    const modsToSort = uncatCount > 0 ? uncatCount : activeMods.length;
    const batchCount = Math.ceil(modsToSort / BATCH_SIZE);

    const uncatCountEl = document.getElementById('ai-export-uncat-count');
    if (uncatCount > 50) {
      uncatCountEl.textContent = `${uncatCount} mods — not recommended, use Compact instead`;
      uncatBtn.classList.add('export-not-recommended');
    } else {
      uncatCountEl.textContent = `${uncatCount} mods to sort, ${sortedCount} already placed`;
      uncatBtn.classList.remove('export-not-recommended');
    }
    document.getElementById('ai-export-uncat-compact-count').textContent =
      `${uncatCount} mods to sort — compact, single file`;
    document.getElementById('ai-export-compact-count').textContent =
      `${activeMods.length} mods — compact format, single file`;
    document.getElementById('ai-export-all-count').textContent =
      `${activeMods.length} mods — full descriptions`;
    document.getElementById('ai-export-split-count').textContent =
      `${batchCount} files with ~${BATCH_SIZE} mods each`;

    if (modsToSort > 100) {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }

    overlay.classList.remove('hidden');

    function cleanup() {
      overlay.classList.add('hidden');
      uncatBtn.removeEventListener('click', onUncat);
      uncatCompactBtn.removeEventListener('click', onUncatCompact);
      compactBtn.removeEventListener('click', onCompact);
      allBtn.removeEventListener('click', onAll);
      splitBtn.removeEventListener('click', onSplit);
      cancelBtn.removeEventListener('click', onCancel);
    }

    function onUncat() { cleanup(); resolve('uncategorized'); }
    function onUncatCompact() { cleanup(); resolve('uncategorized-compact'); }
    function onCompact() { cleanup(); resolve('compact'); }
    function onAll() { cleanup(); resolve('all'); }
    function onSplit() { cleanup(); resolve('split'); }
    function onCancel() { cleanup(); resolve(null); }

    uncatBtn.addEventListener('click', onUncat);
    uncatCompactBtn.addEventListener('click', onUncatCompact);
    compactBtn.addEventListener('click', onCompact);
    allBtn.addEventListener('click', onAll);
    splitBtn.addEventListener('click', onSplit);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function buildPromptHeader(catNames) {
  let h = '';
  h += 'I need you to sort my Kenshi mods into the correct load order categories.\n\n';
  h += 'Use this load order guide as reference:\n';
  h += 'https://steamcommunity.com/sharedfiles/filedetails/?id=1850250979\n\n';
  h += 'Reply with ONLY the sorted list using this exact format — nothing else:\n\n';
  h += '[Category Name]\n';
  h += 'filename.mod\n\n';
  h += '[Next Category]\n';
  h += 'anothermod.mod\n\n';
  h += 'Important:\n';
  h += '- Start your reply with [ — no intro text, nothing before it\n';
  h += '- End your reply with the last .mod filename — no notes after it\n';
  h += '- No markdown, no code blocks, no commentary, no reasoning\n';
  h += '- Use the exact filenames I provide (case-sensitive, with .mod)\n';
  h += '- Use the exact category names in square brackets\n';
  h += '- Every mod in this prompt must appear exactly once\n';
  h += '- Include empty categories too (just the [Header])\n';
  h += '- Put anything you are unsure about in [Uncategorized]\n\n';
  h += 'My categories in load order:\n';
  h += catNames.map((n) => `  ${n}`).join('\n');
  h += '\n\n';
  return h;
}

function buildModEntry(mod, workshopDetails) {
  let e = `=== MOD: ${mod.displayName} ===\n`;
  e += `Filename: ${mod.realFile}\n`;
  e += `Source: ${mod.source}\n`;
  if (mod.author) e += `Author: ${mod.author}\n`;
  let desc = mod.description || '';
  const wid = getWorkshopId(mod);
  if (wid && workshopDetails[wid]) desc = workshopDetails[wid].description || desc;
  if (desc) e += `\nDescription:\n${desc}\n`;
  e += '\n---\n\n';
  return e;
}

function buildModEntryCompact(mod, workshopDetails) {
  let e = `${mod.realFile}`;
  const wid = getWorkshopId(mod);
  const detail = wid ? workshopDetails[wid] : null;
  const tags = detail?.tags;
  if (tags && tags.length > 0) e += ` | Tags: ${tags.join(', ')}`;
  let desc = (detail?.description || mod.description || '').replace(/\[.*?\]/g, '').replace(/\n/g, ' ').trim();
  if (desc.length > 200) desc = desc.substring(0, 200) + '...';
  if (desc) e += ` | ${desc}`;
  return e + '\n';
}

function buildPromptFooter(count) {
  let f = '---\n\n';
  f += `That is all ${count} mods. Sort them into the categories above.\n\n`;
  f += 'IMPORTANT: I am pasting your response directly into a machine parser.\n';
  f += 'The parser reads ONLY lines matching [Category Name] and filename.mod — everything else is discarded.\n';
  f += 'So please just give me the clean sorted list with no other text.\n';
  return f;
}

function buildCurrentSortSection(sortedCats) {
  let s = '=== MY CURRENT SORTED MODS (keep these in place) ===\n\n';
  for (const cat of sortedCats) {
    const catMods = getModsForCategory(cat.id).filter((m) => m.active);
    s += `[${cat.name}]\n`;
    for (const mod of catMods) s += `${mod.realFile}\n`;
    s += '\n';
  }
  return s;
}

aiExportBtn.addEventListener('click', async () => {
  const activeMods = mods.filter((m) => m.active);
  if (activeMods.length === 0) {
    setStatus(t('status.noModsExport'), 'error');
    return;
  }

  const choice = await showExportChoiceModal();
  if (!choice) return;

  const uncatMods = activeMods.filter((m) => m.category === UNCATEGORIZED);
  const sortedCats = [...categories].sort((a, b) => a.order - b.order);
  const catNames = sortedCats.map((c) => c.name);
  catNames.push('Uncategorized');

  const isUncatMode = choice === 'uncategorized' || choice === 'uncategorized-compact';
  if (isUncatMode && uncatMods.length === 0) {
    setStatus(t('status.allSorted'), 'success');
    return;
  }

  const modsToDescribe = (choice === 'all' || choice === 'compact') ? activeMods : uncatMods;
  setStatus(t('status.fetchingSteam', { count: modsToDescribe.length }));
  aiExportBtn.disabled = true;

  const workshopIds = modsToDescribe
    .filter((m) => m.source === 'steam')
    .map(getWorkshopId)
    .filter(Boolean);

  let workshopDetails = {};
  if (workshopIds.length > 0) {
    workshopDetails = await withBusy(t('busy.steam', { count: workshopIds.length }), () => window.api.fetchWorkshopDetails(workshopIds));
  }

  if (choice === 'split') {
    // === SPLIT MODE — multiple files ===
    const batches = [];
    for (let i = 0; i < modsToDescribe.length; i += BATCH_SIZE) {
      batches.push(modsToDescribe.slice(i, i + BATCH_SIZE));
    }

    const filePath = await window.api.saveFileDialog('kenshi_ai_sort_batch_1.txt');
    if (!filePath) {
      setStatus(t('status.exportCancelled'));
      aiExportBtn.disabled = false;
      return;
    }

    const baseDir = filePath.replace(/[/\\][^/\\]+$/, '');
    const baseName = filePath.replace(/^.*[/\\]/, '').replace(/\.txt$/, '').replace(/_?\d+$/, '');

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      let output = buildPromptHeader(catNames);

      // Always include current sort context
      output += buildCurrentSortSection(sortedCats);

      output += `=== UNSORTED MODS — BATCH ${i + 1} of ${batches.length} (place these into the right categories) ===\n\n`;

      for (const mod of batch) {
        output += buildModEntry(mod, workshopDetails);
      }

      output += buildPromptFooter(batch.length);

      const batchPath = `${baseDir}/${baseName}_${i + 1}.txt`;
      await window.api.writeFile(batchPath, output);
    }

    setStatus(t('status.exportedBatch', { mods: modsToDescribe.length, batches: batches.length }), 'success');
  } else {
    // === SINGLE FILE MODE ===
    let output = buildPromptHeader(catNames);

    if (choice === 'uncategorized-compact') {
      output += 'I already have some mods sorted. Keep them in their current categories and positions.\n';
      output += 'I need you to place ONLY the unsorted mods into the right categories.\n';
      output += 'Each unsorted mod line has: filename | Steam tags | short description.\n\n';
      output += buildCurrentSortSection(sortedCats);
      output += '=== UNSORTED MODS (place these into the right categories) ===\n\n';
      for (const mod of uncatMods) {
        output += buildModEntryCompact(mod, workshopDetails);
      }
      output += '\n';
      output += `That is all. Place the ${uncatMods.length} unsorted mods while keeping sorted mods in place.\n\n`;
      output += 'IMPORTANT: I am pasting your response directly into a machine parser.\n';
      output += 'The parser reads ONLY lines matching [Category Name] and filename.mod — everything else is discarded.\n';
      output += 'So please just give me the clean sorted list with no other text.\n';
    } else if (choice === 'compact') {
      output += 'Sort ALL of these mods from scratch.\n';
      output += 'Each line below has: filename | Steam tags | short description.\n\n';
      for (const mod of activeMods) {
        output += buildModEntryCompact(mod, workshopDetails);
      }
      output += '\n';
      output += buildPromptFooter(activeMods.length);
    } else if (choice === 'all') {
      output += 'Sort ALL of these mods from scratch:\n\n';
      for (const mod of activeMods) {
        output += buildModEntry(mod, workshopDetails);
      }
      output += buildPromptFooter(activeMods.length);
    } else {
      output += 'I already have some mods sorted. Keep them in their current categories and positions.\n';
      output += 'I need you to place ONLY the unsorted mods into the right categories.\n\n';
      output += buildCurrentSortSection(sortedCats);
      output += '=== UNSORTED MODS (place these into the right categories) ===\n\n';
      for (const mod of uncatMods) {
        output += buildModEntry(mod, workshopDetails);
      }
      output += '---\n\n';
      output += `That is all. Place the ${uncatMods.length} unsorted mods into the right categories while keeping the already-sorted mods in place.\n\n`;
      output += 'IMPORTANT: I am pasting your response directly into a machine parser.\n';
      output += 'The parser reads ONLY lines matching [Category Name] and filename.mod — everything else is discarded.\n';
      output += 'So please just give me the clean sorted list with no other text.\n';
    }

    const filePath = await window.api.saveFileDialog('kenshi_ai_sort_prompt.txt');
    if (!filePath) {
      setStatus(t('status.exportCancelled'));
      aiExportBtn.disabled = false;
      return;
    }
    await window.api.writeFile(filePath, output);
    setStatus(t('status.exportedPrompt', { count: modsToDescribe.length }), 'success');
  }

  aiExportBtn.disabled = false;
});

// Import AI response
aiImportBtn.addEventListener('click', () => {
  const overlay = document.getElementById('ai-import-modal');
  const textarea = document.getElementById('ai-import-textarea');
  const okBtn = document.getElementById('ai-import-ok');
  const cancelBtn = document.getElementById('ai-import-cancel');

  textarea.value = '';
  overlay.classList.remove('hidden');
  textarea.focus();

  function cleanup() {
    overlay.classList.add('hidden');
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
  }

  function onCancel() { cleanup(); }

  function onOk() {
    const text = textarea.value;
    cleanup();
    parseAndApplyAiResponse(text);
  }

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
});

function parseAndApplyAiResponse(text) {
  // Strip everything before the first [ and after the last .mod line
  const firstBracket = text.indexOf('[');
  if (firstBracket > 0) text = text.substring(firstBracket);

  const lastMod = text.lastIndexOf('.mod');
  if (lastMod > 0) {
    const lineEnd = text.indexOf('\n', lastMod);
    if (lineEnd > 0) text = text.substring(0, lineEnd);
  }

  // Strip markdown code blocks if the AI wrapped it
  text = text.replace(/^```[a-z]*\n?/gm, '').replace(/\n?```$/gm, '');

  const lines = text.split(/\r?\n/);
  let currentCat = null;
  const assignments = {}; // catName -> [filename, ...]

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Check for category header: [Category Name]
    const catMatch = line.match(/^\[(.+)\]$/);
    if (catMatch) {
      currentCat = catMatch[1].trim();
      if (!assignments[currentCat]) assignments[currentCat] = [];
      continue;
    }

    // Otherwise it's a mod filename (be lenient — accept lines ending in .mod)
    if (currentCat && line.match(/\.mod$/i)) {
      // Strip any leading numbering like "1. " or "- "
      line = line.replace(/^[\d]+\.\s*/, '').replace(/^[-*]\s*/, '').trim();
      if (line.endsWith('.mod')) {
        assignments[currentCat].push(line);
      }
    }
  }

  // Map category names to IDs
  const catNameMap = {};
  for (const cat of categories) {
    catNameMap[cat.name.toLowerCase()] = cat.id;
  }
  catNameMap['uncategorized'] = UNCATEGORIZED;

  let matched = 0;
  let unmatched = 0;

  // Apply assignments
  for (const [catName, filenames] of Object.entries(assignments)) {
    const catId = catNameMap[catName.toLowerCase()];
    if (!catId) {
      unmatched += filenames.length;
      continue;
    }

    for (const filename of filenames) {
      const mod = mods.find((m) => m.filename === filename);
      if (!mod) { unmatched++; continue; }

      mod.category = catId;
      mod.active = true;
      if (catId !== UNCATEGORIZED) {
        modCategories[mod.filename] = catId;
      } else {
        delete modCategories[mod.filename];
      }
      matched++;
    }

    // Set the order for this category
    modOrders[catId] = filenames.filter((f) => mods.find((m) => m.filename === f));
  }

  syncModCategories();
  persistConfig();
  renderColumns();

  const activeCount = mods.filter((m) => m.active).length;
  modCount.textContent = `${mods.length} mods, ${activeCount} active`;

  if (unmatched > 0) {
    setStatus(t('status.aiAppliedPartial', { matched, unmatched }), 'success');
  } else {
    setStatus(t('status.aiApplied', { matched }), 'success');
  }
}

// ===== Detail Translation =====

const TRANSLATE_FROM_LANGS = ['auto', 'en', 'ja', 'ru', 'zh-CN', 'zh-TW', 'ko', 'de', 'fr', 'es', 'pt', 'pl', 'tr'];
const TRANSLATE_TO_LANGS = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'ru', 'de', 'fr', 'es', 'pt', 'pl', 'tr'];

const translateNameCb = document.getElementById('translate-name');
const translateDescCb = document.getElementById('translate-desc');
const translateFromSel = document.getElementById('translate-from');
const translateToSel = document.getElementById('translate-to');
const detailNameTranslated = document.getElementById('detail-name-translated');
const detailDescEl = document.getElementById('detail-desc');
const detailDescTranslated = document.getElementById('detail-desc-translated');
const detailDescStatus = document.getElementById('detail-desc-status');
const detailDescToggle = document.getElementById('detail-desc-toggle');

const steamDescCache = new Map();    // workshop id -> cleaned Steam page description
const translationCache = new Map();  // "sl|tl|text" -> { text, detected }
let detailTextRequest = 0;
let showOriginalDesc = false;

function translateLangName(code) {
  if (code === 'auto') return t('translate.auto');
  try {
    return new Intl.DisplayNames([currentLocale], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

function fillTranslateControls() {
  const saved = (config && config.translate) || {};
  const fill = (sel, codes, value) => {
    sel.innerHTML = '';
    for (const code of codes) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = translateLangName(code);
      sel.appendChild(opt);
    }
    sel.value = codes.includes(value) ? value : codes[0];
  };
  fill(translateFromSel, TRANSLATE_FROM_LANGS, saved.from || 'auto');
  fill(translateToSel, TRANSLATE_TO_LANGS, saved.to || 'ko');
  translateNameCb.checked = saved.name === true;
  translateDescCb.checked = saved.desc !== false;
}

function onTranslateSettingChange() {
  if (config) {
    config.translate = {
      name: translateNameCb.checked,
      desc: translateDescCb.checked,
      from: translateFromSel.value,
      to: translateToSel.value,
    };
    persistConfig();
  }
  if (selectedMod) refreshDetailText(selectedMod);
}

[translateNameCb, translateDescCb, translateFromSel, translateToSel].forEach((el) => {
  el.addEventListener('change', onTranslateSettingChange);
});

detailDescToggle.addEventListener('click', () => {
  showOriginalDesc = !showOriginalDesc;
  updateDescToggle();
});

function updateDescToggle() {
  const translated = !detailDescTranslated.classList.contains('hidden');
  detailDescToggle.classList.toggle('hidden', !translated);
  detailDescEl.classList.toggle('hidden', translated && !showOriginalDesc);
  detailDescToggle.textContent = t(showOriginalDesc ? 'translate.hideOriginal' : 'translate.showOriginal');
}

// Steam descriptions use BBCode; keep the text and drop the markup.
function cleanSteamDescription(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, '')
    .replace(/\[previewyoutube=[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, '')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\*\]/g, '• ')
    .replace(/\[hr\](\[\/hr\])?/gi, '────────')
    .replace(/\[\/?(h[1-6]|b|i|u|s|strike|spoiler|noparse|url|list|olist|quote|code|table|tr|th|td)(=[^\]]*)?\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function getSteamDescription(mod) {
  if (mod.source !== 'steam') return '';
  const id = getWorkshopId(mod);
  if (!id) return '';
  if (steamDescCache.has(id)) return steamDescCache.get(id);
  const details = await window.api.fetchWorkshopDetails([id]);
  if (!details[id]) return '';  // request failed; try again next time
  const desc = cleanSteamDescription(details[id].description);
  steamDescCache.set(id, desc);
  return desc;
}

async function translateCached(texts, sl, tl) {
  const key = (text) => `${sl}|${tl}|${text}`;
  const missing = [...new Set(texts.filter((text) => !translationCache.has(key(text))))];
  if (missing.length > 0) {
    const results = await window.api.translateTexts(missing, sl, tl);
    missing.forEach((text, i) => translationCache.set(key(text), results[i]));
  }
  return texts.map((text) => translationCache.get(key(text)));
}

// Fills in the Steam page description and the translations for the selected mod.
async function refreshDetailText(mod) {
  const request = ++detailTextRequest;
  const isCurrent = () => request === detailTextRequest && selectedMod === mod;

  detailNameTranslated.classList.add('hidden');
  detailDescTranslated.classList.add('hidden');
  detailDescStatus.classList.remove('error');
  detailDescStatus.textContent = '';
  updateDescToggle();

  let desc = mod.description || '';
  const steamDesc = await getSteamDescription(mod);
  if (!isCurrent()) return;
  if (steamDesc) desc = steamDesc;
  detailDescEl.textContent = desc || t('detail.noDescription');
  const sourceNote = steamDesc ? t('translate.steamPage') : '';
  detailDescStatus.textContent = sourceNote;

  const texts = [];
  if (translateNameCb.checked && mod.displayName) texts.push(mod.displayName);
  if (translateDescCb.checked && desc) texts.push(desc);
  if (texts.length === 0) return;

  const sl = translateFromSel.value;
  const tl = translateToSel.value;
  detailDescStatus.textContent = [sourceNote, t('translate.translating')].filter(Boolean).join(' · ');

  let results;
  try {
    results = await translateCached(texts, sl, tl);
  } catch {
    if (!isCurrent()) return;
    detailDescStatus.textContent = [sourceNote, t('translate.failed')].filter(Boolean).join(' · ');
    detailDescStatus.classList.add('error');
    return;
  }
  if (!isCurrent()) return;

  let i = 0;
  if (translateNameCb.checked && mod.displayName) {
    const name = results[i++].text.trim();
    if (name && name !== mod.displayName) {
      detailNameTranslated.textContent = name;
      detailNameTranslated.classList.remove('hidden');
    }
  }
  if (translateDescCb.checked && desc) {
    const r = results[i++];
    detailDescTranslated.textContent = r.text;
    detailDescTranslated.classList.remove('hidden');
    const from = translateLangName(r.detected || sl);
    detailDescStatus.textContent = [sourceNote, `${from} → ${translateLangName(tl)}`].filter(Boolean).join(' · ');
  } else {
    detailDescStatus.textContent = sourceNote;
  }
  updateDescToggle();
}

// ===== Detail Panel =====

function updateDetailPanel() {
  const placeholder = detailPanel.querySelector('.detail-placeholder');
  MEMO.show(selectedMod); // 📝 (editing.js)

  if (!selectedMod) {
    placeholder.classList.remove('hidden');
    detailContent.classList.add('hidden');
    return;
  }

  placeholder.classList.add('hidden');
  detailContent.classList.remove('hidden');

  const detailImage = document.getElementById('detail-image');
  if (selectedMod.imagePath) {
    detailImage.src = 'file:///' + selectedMod.imagePath.replace(/\\/g, '/');
    detailImage.classList.remove('hidden');
  } else {
    detailImage.classList.add('hidden');
    detailImage.src = '';
  }

  // Update mod page webview if that tab is active
  if (tabModpage.classList.contains('active') && selectedMod.url) {
    modpageView.src = selectedMod.url;
  }

  document.getElementById('detail-name').textContent = selectedMod.displayName;
  document.getElementById('detail-author').textContent = selectedMod.author || t('detail.unknown');
  document.getElementById('detail-version').textContent = selectedMod.version || t('detail.na');
  document.getElementById('detail-source').textContent = selectedMod.source === 'steam' ? t('detail.sourceStream') : t('detail.sourceLocal');
  document.getElementById('detail-path').textContent = selectedMod.filePath;
  document.getElementById('detail-desc').textContent = selectedMod.description || t('detail.noDescription');
  refreshDetailText(selectedMod);

  const depsRow = document.getElementById('detail-deps-row');
  const depsEl = document.getElementById('detail-deps');
  if (selectedMod.dependencies && selectedMod.dependencies.length > 0) {
    depsRow.classList.remove('hidden');
    fillDepList(depsEl, selectedMod, selectedMod.dependencies);
  } else {
    depsRow.classList.add('hidden');
  }

  const refsRow = document.getElementById('detail-refs-row');
  const refsEl = document.getElementById('detail-refs');
  if (selectedMod.references && selectedMod.references.length > 0) {
    refsRow.classList.remove('hidden');
    fillDepList(refsEl, selectedMod, selectedMod.references);
  } else {
    refsRow.classList.add('hidden');
  }

  // Missing dependencies warning
  const allDeps = (selectedMod.dependencies || []).concat(selectedMod.references || []);
  const missingDeps = allDeps.filter((dep) => !isDepInstalled(dep));
  const missingRow = document.getElementById('detail-missing-row');
  const missingEl = document.getElementById('detail-missing');
  if (missingDeps.length > 0) {
    missingRow.classList.remove('hidden');
    missingEl.textContent = missingDeps.join(', ');
  } else {
    missingRow.classList.add('hidden');
  }

  // "Needed by" — mods that depend on the selected mod
  const neededByRow = document.getElementById('detail-needed-by-row');
  const neededByEl = document.getElementById('detail-needed-by');
  const dependents = mods.filter((m) => m !== selectedMod && needsMod(m, selectedMod));
  if (dependents.length > 0) {
    neededByRow.classList.remove('hidden');
    fillDependents(neededByEl, selectedMod, dependents);
  } else {
    neededByRow.classList.add('hidden');
  }

  updateDetailExtras(selectedMod);

  // Update conflicts tab if it's active
  if (tabConflicts.classList.contains('active')) {
    renderConflictsTab();
  }
}

// ===== Conflicts Tab =====

function getConflictRelationship(selfFilename, otherFilename, selfConflicts) {
  // Check if these two mods share any conflict
  let hasConflict = false;
  let selfWinsAny = false;
  let otherWinsAny = false;

  for (const c of selfConflicts) {
    const otherEntry = c.allMods.find((m) => m.filename === otherFilename);
    if (!otherEntry) continue;
    hasConflict = true;
    if (c.winner === selfFilename) selfWinsAny = true;
    if (c.winner === otherFilename) otherWinsAny = true;
  }

  if (!hasConflict) return null;
  // If self is the overall winner for any shared conflict
  if (selfWinsAny) return 'overwriting';
  // If other is the overall winner for any shared conflict
  if (otherWinsAny) return 'overwritten';
  // Neither wins — a third mod overrides both
  return 'dead';
}

function renderConflictsTab() {
  const placeholder = document.getElementById('conflicts-placeholder');
  const content = document.getElementById('conflicts-content');
  const title = document.getElementById('conflicts-title');

  content.innerHTML = '';

  if (!conflictData) {
    placeholder.textContent = t('conflicts.clickCheck');
    placeholder.classList.remove('hidden');
    return;
  }

  if (!selectedMod) {
    placeholder.textContent = t('conflicts.selectMod');
    placeholder.classList.remove('hidden');
    return;
  }

  placeholder.classList.add('hidden');

  const modConflicts = conflictData.modConflicts[selectedMod.realFile];

  if (!modConflicts || modConflicts.length === 0) {
    title.textContent = `${selectedMod.displayName} — Conflicts`;
    const noConf = document.createElement('div');
    noConf.className = 'no-conflicts';
    noConf.textContent = t('conflicts.noConflicts');
    content.appendChild(noConf);
    return;
  }

  // Group conflicts by other mod
  const byMod = {}; // otherModFilename -> { conflicts: [], loadOrder }

  for (const c of modConflicts) {
    for (const m of c.allMods) {
      if (m.filename === selectedMod.realFile) continue;
      if (!byMod[m.filename]) {
        byMod[m.filename] = { conflicts: [], loadOrder: m.loadOrder };
      }
      byMod[m.filename].conflicts.push(c);
    }
  }

  const modNames = Object.keys(byMod);
  title.textContent = `${selectedMod.displayName} — conflicts with ${modNames.length} mods`;

  // Sort by load order
  modNames.sort((a, b) => byMod[a].loadOrder - byMod[b].loadOrder);

  for (const otherMod of modNames) {
    const info = byMod[otherMod];
    const displayName = otherMod.replace(/\.mod$/i, '');

    // Categorize conflicts by winner
    const greenConflicts = info.conflicts.filter((c) => c.winner === selectedMod.realFile);
    const redConflicts = info.conflicts.filter((c) => c.winner === otherMod);
    const deadConflicts = info.conflicts.filter((c) => c.winner !== selectedMod.realFile && c.winner !== otherMod);

    // Dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'conflict-dropdown';

    // Header (clickable)
    const header = document.createElement('div');
    header.className = 'conflict-dropdown-header';

    const arrow = document.createElement('span');
    arrow.className = 'conflict-dropdown-arrow';
    arrow.textContent = '\u25B6';

    const nameEl = document.createElement('span');
    nameEl.className = 'conflict-dropdown-name';
    nameEl.textContent = `#${info.loadOrder} ${displayName}`;

    const countEl = document.createElement('span');
    countEl.className = 'conflict-count-badge';
    countEl.textContent = info.conflicts.length;

    // Build header status labels based on winner categories
    const statusWrap = document.createElement('span');
    statusWrap.style.marginLeft = '6px';
    statusWrap.style.fontSize = '10px';

    if (greenConflicts.length > 0) {
      const s = document.createElement('span');
      s.className = 'conflict-mod-winner';
      s.textContent = `this mod overrides (${greenConflicts.length})`;
      statusWrap.appendChild(s);
    }
    if (redConflicts.length > 0) {
      if (statusWrap.childNodes.length > 0) statusWrap.append(' · ');
      const s = document.createElement('span');
      s.className = 'conflict-mod-loser';
      s.textContent = `overrides this mod (${redConflicts.length})`;
      statusWrap.appendChild(s);
    }
    if (deadConflicts.length > 0) {
      if (statusWrap.childNodes.length > 0) statusWrap.append(' · ');
      const s = document.createElement('span');
      s.className = 'conflict-mod-dead';
      s.textContent = `both overridden (${deadConflicts.length})`;
      statusWrap.appendChild(s);
    }

    header.append(arrow, nameEl, countEl, statusWrap);

    // Body (hidden by default)
    const body = document.createElement('div');
    body.className = 'conflict-dropdown-body hidden';

    // Green section — this mod wins
    if (greenConflicts.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'conflict-sub-section';
      const secTitle = document.createElement('div');
      secTitle.className = 'conflict-mod-winner';
      secTitle.textContent = `${selectedMod.displayName} overrides ${displayName} on ${greenConflicts.length} properties:`;
      sec.appendChild(secTitle);
      renderPropertyList(sec, greenConflicts);
      body.appendChild(sec);
    }

    // Red section — other mod wins
    if (redConflicts.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'conflict-sub-section';
      const secTitle = document.createElement('div');
      secTitle.className = 'conflict-mod-loser';
      secTitle.textContent = `${displayName} overrides ${selectedMod.displayName} on ${redConflicts.length} properties:`;
      sec.appendChild(secTitle);
      renderPropertyList(sec, redConflicts);
      body.appendChild(sec);
    }

    // Yellow section — both overridden by a third mod
    if (deadConflicts.length > 0) {
      // Group dead conflicts by actual winner for clarity
      const byWinner = {};
      for (const c of deadConflicts) {
        if (!byWinner[c.winner]) byWinner[c.winner] = [];
        byWinner[c.winner].push(c);
      }
      for (const [winnerFile, conflicts] of Object.entries(byWinner)) {
        const winnerName = winnerFile.replace(/\.mod$/i, '');
        const sec = document.createElement('div');
        sec.className = 'conflict-sub-section';
        const secTitle = document.createElement('div');
        secTitle.className = 'conflict-mod-dead';
        secTitle.textContent = `Both overridden by ${winnerName} on ${conflicts.length} properties:`;
        sec.appendChild(secTitle);
        renderPropertyList(sec, conflicts);
        body.appendChild(sec);
      }
    }

    header.addEventListener('click', () => {
      const isOpen = !body.classList.contains('hidden');
      body.classList.toggle('hidden');
      arrow.textContent = isOpen ? '\u25B6' : '\u25BC';
    });

    dropdown.append(header, body);
    content.appendChild(dropdown);
  }
}

function renderPropertyList(container, conflicts) {
  // Group by item type+name
  const grouped = {};
  for (const c of conflicts) {
    const groupKey = `${c.type}: ${c.name}`;
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(c);
  }

  for (const [group, entries] of Object.entries(grouped)) {
    const item = document.createElement('div');
    item.className = 'conflict-prop-group';

    const itemTitle = document.createElement('div');
    itemTitle.className = 'conflict-key';
    itemTitle.textContent = `${group} (${entries.length})`;
    item.appendChild(itemTitle);

    for (const c of entries) {
      const prop = document.createElement('div');
      prop.className = 'conflict-prop';

      const hasValues = c.values && Object.keys(c.values).length > 0;

      // Check if this is a clickable zone file
      const isZone = /^zone\.\d+\.\d+\.zone$/i.test(c.key);

      if (hasValues) {
        // Expandable property with value details
        const propHeader = document.createElement('div');
        propHeader.className = 'conflict-prop-header';

        const arrow = document.createElement('span');
        arrow.className = 'conflict-prop-arrow';
        arrow.textContent = '\u25B6';

        const keySpan = document.createElement('span');
        keySpan.textContent = c.key;
        if (c.keyDesc) {
          keySpan.title = c.keyDesc;
          const desc = document.createElement('span');
          desc.className = 'conflict-prop-desc';
          desc.textContent = ` — ${c.keyDesc}`;
          keySpan.appendChild(desc);
        }
        if (isZone) {
          keySpan.className = 'conflict-prop-zone';
          keySpan.title = t('zoneMap.clickToView');
          keySpan.addEventListener('click', (e) => { e.stopPropagation(); showZoneOnMap(c.key); });
        }

        propHeader.append(arrow, keySpan);

        const valuesDiv = document.createElement('div');
        valuesDiv.className = 'conflict-values-list hidden';

        // Winner row first (green, larger)
        const winnerVal = c.values[c.winner];
        if (winnerVal !== undefined) {
          const winnerName = c.winner.replace(/\.mod$/i, '');
          const winRow = document.createElement('div');
          winRow.className = 'conflict-value-row conflict-value-winner';

          const winMod = document.createElement('span');
          winMod.className = 'conflict-value-mod';
          winMod.textContent = winnerName + ':';

          const winVal = document.createElement('span');
          winVal.className = 'conflict-value-val';
          winVal.textContent = winnerVal;

          winRow.append(winMod, winVal);
          valuesDiv.appendChild(winRow);

          // Divider
          const divider = document.createElement('div');
          divider.className = 'conflict-value-divider';
          valuesDiv.appendChild(divider);
        }

        // Other mod values
        for (const [modFile, val] of Object.entries(c.values)) {
          if (modFile === c.winner) continue;
          const modName = modFile.replace(/\.mod$/i, '');
          const row = document.createElement('div');
          row.className = 'conflict-value-row';

          const modSpan = document.createElement('span');
          modSpan.className = 'conflict-value-mod';
          modSpan.textContent = modName + ':';

          const valSpan = document.createElement('span');
          valSpan.className = 'conflict-value-val';
          valSpan.textContent = val;

          row.append(modSpan, valSpan);
          valuesDiv.appendChild(row);
        }

        propHeader.addEventListener('click', () => {
          const open = !valuesDiv.classList.contains('hidden');
          valuesDiv.classList.toggle('hidden');
          arrow.textContent = open ? '\u25B6' : '\u25BC';
        });

        prop.append(propHeader, valuesDiv);
      } else if (isZone) {
        const keySpan = document.createElement('span');
        keySpan.className = 'conflict-prop-zone';
        keySpan.textContent = c.key;
        keySpan.title = 'Click to view on map';
        keySpan.addEventListener('click', () => showZoneOnMap(c.key));
        prop.appendChild(keySpan);
      } else {
        prop.textContent = c.key;
      }

      item.appendChild(prop);
    }

    container.appendChild(item);
  }
}

// ===== Default Categories =====

const DEFAULT_CATEGORIES = [
  { name: 'UI, Graphics, Performance', color: '#4a9f4a' },
  { name: 'Animations',               color: '#4a6fa5' },
  { name: 'New Races & Race Edits',    color: '#a5894a' },
  { name: 'Animals',                  color: '#8a6b3e' },
  { name: 'Game Starts',              color: '#7a4aa5' },
  { name: 'Faction Edits & Additions', color: '#4aa5a5' },
  { name: 'Buildings',                color: '#6b8f3e' },
  { name: 'Armor & Weapons',          color: '#a54a4a' },
  { name: 'Overhauls & World Changes', color: '#cc7a33' },
  { name: 'Patches',                  color: '#a54a7a' },
  { name: 'Economy',                  color: '#5a8a5a' },
];

function ensureDefaultCategories() {
  if (categories.length === 0) {
    categories = DEFAULT_CATEGORIES.map((def, i) => ({
      id: generateId(),
      name: def.name,
      color: def.color,
      order: i,
    }));
  }
}

// ===== Language Switching =====

const setupLangSelect = document.getElementById('setup-language-select');
const tutorialLangSelect = document.getElementById('tutorial-language-select');

function syncLangSelects(locale) {
  if (setupLangSelect) setupLangSelect.value = locale;
  if (tutorialLangSelect) tutorialLangSelect.value = locale;
}

const APP_MENU_KEYS = [
  'file', 'quit', 'edit', 'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
  'view', 'reload', 'forceReload', 'devTools', 'resetZoom', 'zoomIn', 'zoomOut', 'fullscreen', 'menuBar',
  'moveMenu', 'window', 'minimize', 'zoom', 'rememberWindow', 'close', 'help', 'github', 'steamGuide', 'discord',
];

// The window menu lives in the main process; send it labels in the UI language.
function updateAppMenu() {
  const labels = {};
  for (const key of APP_MENU_KEYS) labels[key] = t('menu.' + key);
  labels.fileItems = menuItemsWithKeys(fileMenuItems());
  labels.editItems = menuItemsWithKeys(editMenuItems());
  labels.moveItems = menuItemsWithKeys(moveMenuItems());
  labels.helpItems = menuItemsWithKeys(helpMenuItems());
  window.api.setAppMenu(labels);
}

async function changeLanguage(locale) {
  await setLocale(locale);
  syncLangSelects(locale);
  window.api.kmtLang(locale).catch(() => {}); // the translator window follows
  updateAppMenu();
  updateLaunchButton();
  fillTranslateControls();
  if (selectedMod) refreshDetailText(selectedMod);
  if (uncategorizedPinned) {
    pinUncatBtn.textContent = t('toolbar.unpinUncat');
  } else {
    pinUncatBtn.textContent = t('toolbar.pinUncat');
  }
  if (config) {
    config.language = locale;
    localizeCategoryNames();
    persistConfig();
    if (!mainScreen.classList.contains('hidden')) renderColumns();
  }
}

if (setupLangSelect) {
  setupLangSelect.addEventListener('change', (e) => changeLanguage(e.target.value));
}
if (tutorialLangSelect) {
  tutorialLangSelect.addEventListener('change', (e) => changeLanguage(e.target.value));
}

// ===== Init =====

async function init() {
  config = await window.api.getConfig();

  // Init i18n with saved language or default to English
  const savedLang = (config && config.language) || 'en';
  await initI18n(savedLang);
  BOOT.text(t('boot.loading'));
  BOOT.step(10, t('boot.config'));
  syncLangSelects(savedLang);
  updateAppMenu();
  fillTranslateControls();

  if (config && config.gamePath) {
    categories = config.categories || [];
    modCategories = config.modCategories || {};
    modOrders = config.modOrders || {};
    if (typeof config.mapZoomSpeed === 'number') mapZoomSpeed = config.mapZoomSpeed;
    if (typeof config.columnScrollSpeed === 'number') columnScrollSpeed = config.columnScrollSpeed;
    if (typeof config.columnScrollSpeedV === 'number') columnScrollSpeedV = config.columnScrollSpeedV;
    // The old pinned Uncategorized side panel is gone: Uncategorized is a normal column now.
    uncategorizedPinned = false;
    if (config.orderPanelWidth) document.getElementById('order-panel').style.width = config.orderPanelWidth + 'px';
    if (config.zoomFactor && config.zoomFactor !== 1) window.api.setZoom(config.zoomFactor);
    if (uncategorizedPinned) {
      pinUncatBtn.classList.add('btn-pinned-active');
      pinUncatBtn.textContent = t('toolbar.unpinUncat');
    }
    // Default to Kenshi theme unless explicitly set to false
    if (config.kenshiTheme !== false) {
      document.body.classList.add('kenshi-theme');
      themeToggleCb.checked = true;
    }
    tutorialDismissed = config.tutorialDismissed || false;
    if (!tutorialDismissed) {
      tutorialModal.classList.remove('hidden');
    }
    ensureDefaultCategories();
    localizeCategoryNames();
    applyColumnWidth();
    applyPanelFold(); // (panel-fold.js)
    showMainScreen();
    showTutorialFirst();
    if (config.autoUpdateCheck !== false) autoCheckForUpdate();
  } else {
    config = config || { categories: [], modCategories: {}, modOrders: {} };
    categories = config.categories || [];
    modCategories = config.modCategories || {};
    modOrders = config.modOrders || {};
    // First launch: the dark theme (kept from the folder setup on: persistConfig saves it)
    document.body.classList.remove('kenshi-theme');
    themeToggleCb.checked = false;
    ensureDefaultCategories();
    localizeCategoryNames();
    setupScreen.classList.remove('hidden');
    BOOT.done();
    autoDetect();
  }
}

// After every script has loaded: with no config file yet, getConfig answers before
// editing.js has run, and init would call its functions too early (blank window).
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
