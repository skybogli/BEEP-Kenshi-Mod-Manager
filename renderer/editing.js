// Editing helpers loaded after app.js (it shares app.js's globals):
// the actual load order (with 📌 pins) and its panel on the left, unsaved-change
// tracking, keyboard editing (select all / move / paste / Shift+arrows), category
// order (Uncategorized included) and sort rules, category layouts with auto
// classify, the settings dialog, a busy overlay for long jobs, and Alt+H / Alt+M.

const UNCAT_COLOR = '#555';

function uncatName() {
  return t('category.uncategorized');
}

function catById(catId) {
  return catId === UNCATEGORIZED ? { id: UNCATEGORIZED, name: uncatName(), color: UNCAT_COLOR } : categories.find((c) => c.id === catId);
}

function modByFile(filename) {
  return mods.find((m) => m.filename === filename);
}

function escapeText(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Save, re-render and record one undo step after a layout change.
function commitLayout() {
  syncModCategories();
  persistConfig();
  renderColumns();
}

// ===== Category order =====
// Uncategorized is a column like the others (by default the first one); its place is
// config.uncatPos, an index into the full list.

function uncatPos() {
  return Number.isInteger(config?.uncatPos) ? config.uncatPos : 0;
}

// Category ids left to right (= load order).
function orderedCatIds() {
  const ids = [...categories].sort((a, b) => a.order - b.order).map((c) => c.id);
  ids.splice(Math.max(0, Math.min(uncatPos(), ids.length)), 0, UNCATEGORIZED);
  return ids;
}

function setCategoryOrder(ids) {
  let k = 0;
  ids.forEach((id, i) => {
    if (id === UNCATEGORIZED) config.uncatPos = i;
    else catById(id).order = k++;
  });
}

function catFiles(catId) {
  return getModsForCategory(catId).map((m) => m.filename);
}

// ===== Actual load order and 📌 pins =====
// Unpinned mods follow the category layout. A pinned mod keeps its place right after the
// unpinned mod that preceded it, so it stays put when other mods move or turn on/off.
// Loading takes mods.cfg as the actual order and pins just enough mods to explain where
// it differs from the categories.

let actualOrder = [];
let pins = new Set();
const keepPinned = new Set(); // mods placed by hand this time (stay pinned)

// Active mods in category order (a filename once, as in mods.cfg).
function layoutActiveOrder() {
  const seen = new Set();
  const out = [];
  for (const id of orderedCatIds()) {
    for (const m of getModsForCategory(id)) {
      if (m.active && !seen.has(m.filename)) { seen.add(m.filename); out.push(m.filename); }
    }
  }
  return out;
}

// `moving`: mods moved this time; they don't anchor pinned mods.
function rebuildOrder(prev = actualOrder, moving = null) {
  const layout = layoutActiveOrder();
  const active = new Set(layout);
  for (const f of [...pins]) if (!active.has(f)) pins.delete(f);
  const queue = layout.filter((f) => !pins.has(f));
  const inQueue = new Set(queue);
  const after = new Map();
  const seen = new Set();
  let anchor = null;
  for (const f of prev) {
    if (pins.has(f)) {
      if (seen.has(f)) continue;
      seen.add(f);
      if (!after.has(anchor)) after.set(anchor, []);
      after.get(anchor).push(f);
    } else if (inQueue.has(f) && !moving?.has(f)) {
      anchor = f;
    }
  }
  const order = [...(after.get(null) || [])];
  for (const f of queue) order.push(f, ...(after.get(f) || []));
  for (const f of pins) if (!seen.has(f)) order.push(f);
  actualOrder = order;
}

// Drop pins that make no difference.
function prunePins() {
  const order = actualOrder;
  for (const f of [...pins]) {
    pins.delete(f);
    rebuildOrder(order);
    if (!sameOrder(actualOrder, order)) pins.add(f);
  }
  rebuildOrder(order);
}

// Files of `a` in a longest common subsequence of `a` and `b`.
function lcsFiles(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keep = new Set();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { keep.add(a[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return keep;
}

// Take `order` as the actual order, pinning just enough mods to explain where it
// differs from the category layout.
function adoptOrder(order, keepPins = true) {
  const active = new Set(layoutActiveOrder());
  order = [...new Set(order)].filter((f) => active.has(f));
  const kept = new Set(keepPins ? [...pins].filter((f) => order.includes(f)) : []);
  const a = order.filter((f) => !kept.has(f));
  const b = layoutActiveOrder().filter((f) => !kept.has(f));
  if (!sameOrder(a, b)) {
    const keep = lcsFiles(a, b);
    for (const f of a) if (!keep.has(f)) kept.add(f);
  }
  pins = kept;
  rebuildOrder(order);
}

// Inside each category, put the mods that are on in the order of `order` (mods that are
// off keep their rows).
function applyRelativeOrder(order) {
  const rank = new Map(order.map((f, i) => [f, i]));
  syncModCategories();
  for (const catId of orderedCatIds()) {
    const list = catFiles(catId);
    const ranked = list.filter((f) => rank.has(f)).sort((a, b) => rank.get(a) - rank.get(b));
    let k = 0;
    modOrders[catId] = list.map((f) => (rank.has(f) ? ranked[k++] : f));
  }
}

// Called by loadMods() with the order read from mods.cfg. The first time (a config from
// before pins existed) the categories are first lined up with mods.cfg, so only real
// differences get pinned.
function initLoadOrder(cfgOrder) {
  if (!Array.isArray(config.pins)) applyRelativeOrder(cfgOrder);
  pins = new Set(config.pins || []);
  actualOrder = [];
  adoptOrder(cfgOrder);
  config.pins = [...pins];
}

// Called at the start of every render: mods moved in the categories lose their pin
// and follow the layout; mods placed by hand keep theirs.
function syncActualOrder() {
  const moved = [...justMovedMods].filter((f) => !keepPinned.has(f));
  for (const f of moved) pins.delete(f);
  rebuildOrder(actualOrder, moved.length ? new Set(moved) : null);
  keepPinned.clear();
}

// Put `files` at actual position `pos` (1-based), ignoring categories, and pin them.
// Mods that moved up also go to the top of their category.
function setPosition(files, pos) {
  const was = new Map(actualOrder.map((f, i) => [f, i]));
  files = [...new Set(files)].sort((a, b) => (was.get(a) ?? Infinity) - (was.get(b) ?? Infinity));
  const moving = new Set(files);
  const base = actualOrder.filter((f) => !moving.has(f));
  const idx = Math.max(1, Math.min(pos, base.length + 1)) - 1;
  const order = [...base.slice(0, idx), ...files, ...base.slice(idx)];
  const movedUp = files.filter((f) => !was.has(f) || order.indexOf(f) < was.get(f));
  syncModCategories();
  for (const catId of orderedCatIds()) {
    const list = catFiles(catId);
    const top = list.filter((f) => movedUp.includes(f));
    if (top.length) modOrders[catId] = [...top, ...list.filter((f) => !movedUp.includes(f))];
  }
  for (const f of files) {
    const m = modByFile(f);
    if (m) m.active = true;
    pins.add(f);
    keepPinned.add(f);
    justMovedMods.add(f);
  }
  rebuildOrder(order);
  prunePins();
}

function pinFiles(files) {
  files.forEach((f) => { if (modByFile(f)?.active) { pins.add(f); keepPinned.add(f); } });
  commitLayout();
  setStatus(t('pin.pinned', { count: files.length }), 'success');
}

function unpinFiles(files) {
  files.forEach((f) => pins.delete(f));
  rebuildOrder();
  commitLayout();
  setStatus(t('pin.unpinned', { count: files.length }), 'success');
}

async function unpinAll() {
  if (!pins.size) return;
  const ok = await choiceModal(t('pin.resetTitle'), t('pin.resetText', { count: pins.size }), [
    { key: 'cancel', text: t('modal.cancel') }, { key: 'ok', text: t('pin.resetBtn'), primary: true }]);
  if (ok !== 'ok') return;
  pins.clear();
  rebuildOrder();
  commitLayout();
  setStatus(t('pin.resetDone'), 'success');
}

// ===== Mods with the same file name =====
// The same .mod can exist more than once (a local copy and Workshop subscriptions). Each
// copy is its own entry that can be placed, moved, sorted and pinned on its own: the first
// copy (local first) keeps the plain file name as its key, as before; the others are keyed
// "name::source:folder". mods.cfg only stores names, so only one copy of a name can be on;
// which one is remembered in config.dupActive. `realFile` is always the real .mod name.

function copyTag(mod) {
  const parts = mod.filePath.replace(/\\/g, '/').split('/');
  return `${mod.source}:${parts[parts.length - 2]}`;
}

function assignModKeys(list) {
  const groups = new Map();
  for (const m of list) {
    m.realFile = m.filename;
    if (!groups.has(m.filename)) groups.set(m.filename, []);
    groups.get(m.filename).push(m);
  }
  const remembered = config.dupActive || {};
  for (const [real, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => ((a.source === 'steam') - (b.source === 'steam')) || a.filePath.localeCompare(b.filePath));
    group.forEach((m, i) => { if (i) m.filename = `${real}::${copyTag(m)}`; });
    const on = group.some((m) => m.active);
    const keep = group.find((m) => m.filename === remembered[real]) || group[0];
    group.forEach((m) => { m.active = on && m === keep; });
  }
  return list;
}

function sameNameCopies(mod) {
  return mods.filter((m) => m !== mod && m.realFile === mod.realFile);
}

// Real file names in load order, each once: what mods.cfg gets.
function loadOrderFiles() {
  const seen = new Set();
  const out = [];
  for (const key of actualOrder) {
    const real = modByFile(key)?.realFile || key;
    if (!seen.has(real)) { seen.add(real); out.push(real); }
  }
  return out;
}

// Called at the start of every render: if two copies of a name are on, the one just
// turned on stays and the others go off. Also remembers which copy is on.
let prevActiveKeys = null;
let copyNotice = null; // shown after the render (the render ends with the dependency status)
function enforceOneCopy() {
  const on = new Map();
  for (const m of mods) {
    if (!m.active) continue;
    if (!on.has(m.realFile)) on.set(m.realFile, []);
    on.get(m.realFile).push(m);
  }
  for (const group of on.values()) {
    if (group.length < 2) continue;
    const fresh = prevActiveKeys ? group.filter((m) => !prevActiveKeys.has(m.filename)) : [];
    const keep = fresh[0] || group[0];
    for (const m of group) if (m !== keep) m.active = false;
    copyNotice = keep.displayName;
  }
  prevActiveKeys = new Set(mods.filter((m) => m.active).map((m) => m.filename));
  const dup = {};
  for (const m of mods) if (m.active && sameNameCopies(m).length) dup[m.realFile] = m.filename;
  config.dupActive = dup;
}

// ===== Categories that don't load (🚫) =====
// A category can be set not to load: its mods stay off (out of mods.cfg and the actual order)
// whatever their check box, and whether they were on is kept (mod.parked) for when they leave
// it. Uncategorized's switch is config.uncatNoLoad (on for a new setup), the others' cat.noLoad.

let newSetup = false; // the folder setup just ran (app.js)
let noLoadNotice = false;

function catNoLoad(catId) {
  return catId === UNCATEGORIZED ? config?.uncatNoLoad === true : !!catById(catId)?.noLoad;
}

// Called at every render and save: mods in a 🚫 category go off (remembered), mods that left
// one come back on (unless another copy of the name is on now).
function applyNoLoad() {
  for (const m of mods) {
    if (m.missing) continue;
    if (catNoLoad(m.category)) {
      if (m.active) { m.active = false; m.parked = true; }
    } else if (m.parked) {
      m.parked = false;
      if (!mods.some((o) => o !== m && o.active && o.realFile === m.realFile)) m.active = true;
    }
  }
}

function parkedKeys() {
  return mods.filter((m) => m.parked).map(layoutKeyOf);
}

function setNoLoadFlag(catId, on) {
  if (catId === UNCATEGORIZED) { if (config) config.uncatNoLoad = !!on; return; }
  const c = catById(catId);
  if (c && categories.includes(c)) { if (on) c.noLoad = true; else delete c.noLoad; }
}

function setCatNoLoad(catId, on) {
  setNoLoadFlag(catId, on);
  applyNoLoad();
  syncModCategories();
  persistConfig();
  renderColumns();
  setStatus(t(on ? 'noLoad.on' : 'noLoad.off', { name: catById(catId)?.name || '' }), 'success');
}

function headerNoLoadButton(catId) {
  const on = catNoLoad(catId);
  const b = document.createElement('span');
  b.className = 'column-move-btn km-noload-btn' + (on ? ' on' : '');
  b.textContent = '🚫';
  b.title = t(on ? 'noLoad.tipOn' : 'noLoad.tipOff');
  b.addEventListener('click', (e) => { e.stopPropagation(); setCatNoLoad(catId, !catNoLoad(catId)); });
  return b;
}

// Called by loadMods() before the load order is set up: who was on before going into a 🚫
// category, and Uncategorized's switch the first time. A new setup gets a 🚫 Uncategorized
// unless mods that are on already sit there (they'd drop out of the game); an older config keeps
// Uncategorized loading.
function initNoLoad() {
  const parked = new Set(config.parked || []);
  for (const m of mods) m.parked = parked.has(layoutKeyOf(m));
  if (typeof config.uncatNoLoad !== 'boolean') {
    const onThere = mods.some((m) => m.active && !m.missing && m.category === UNCATEGORIZED);
    config.uncatNoLoad = newSetup && !onThere;
    noLoadNotice = newSetup && onThere;
  }
}

// ===== Detail panel: Steam page / folders / tags =====

const STEAM_WORKSHOP_URL = 'https://steamcommunity.com/app/233860/workshop/';

function openWorkshopSite() {
  window.api.openExternal(STEAM_WORKSHOP_URL);
}

function folderOf(filePath) {
  return filePath.replace(/[\\/][^\\/]+$/, '');
}

function detailFolders(mod) {
  if (mod.missing) {
    const id = ghostWorkshopId(mod.realFile);
    return { install: null, workshop: null, steamUrl: id ? 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + id : null, workshopId: id };
  }
  const steam = mod.source === 'steam';
  // A Workshop mod linked into the game's Mods folder is "installed" there.
  const linked = steam && linkedMods.has(mod.realFile) && config.gamePath
    ? config.gamePath.replace(/[\\/]+$/, '') + '\\Mods\\' + mod.realFile.replace(/\.mod$/i, '')
    : null;
  return {
    install: steam ? linked : folderOf(mod.filePath),
    workshop: steam ? folderOf(mod.filePath) : null,
    steamUrl: steam ? mod.url : null,
    workshopId: steam ? workshopIdOf(mod) : null,
  };
}

let detailTagsRequest = 0;

// Buttons, Workshop tags and the other copies under the file row (called from updateDetailPanel).
function updateDetailExtras(mod) {
  const box = document.getElementById('km-detail-extras');
  if (!box) return;
  if (!mod) { box.innerHTML = ''; return; }
  updateDepFix(mod);
  const f = detailFolders(mod);
  const tags = f.workshopId ? config.workshopTags?.[f.workshopId] : null;
  const copies = sameNameCopies(mod);
  box.innerHTML = `<div class="km-detail-buttons">
      <button class="btn btn-subbar" data-open="steam" ${f.steamUrl ? '' : 'disabled'} title="${escapeText(f.steamUrl || '')}">${escapeText(t('detail.steamPage'))}${copyIcon(t('detail.copyUrl'))}</button>
      <button class="btn btn-subbar" data-open="install" ${f.install ? '' : 'disabled'} title="${escapeText(f.install || '')}">${escapeText(t('detail.installFolder'))}${copyIcon(t('detail.copyPath'))}</button>
      <button class="btn btn-subbar" data-open="workshop" ${f.workshop ? '' : 'disabled'} title="${escapeText(f.workshop || '')}">${escapeText(t('detail.workshopFolder'))}${copyIcon(t('detail.copyPath'))}</button>
    </div>
    ${tags?.length ? `<div class="km-detail-tags">${tags.map((tag) => `<span class="km-tag">${escapeText(tag)}</span>`).join('')}</div>` : ''}
    ${copies.length ? `<div class="km-detail-copies">
      <div class="km-copies-title">${escapeText(t('detail.copies', { count: copies.length }))}</div>
      ${copies.map((m, i) => `<div class="km-copy"><span class="source-badge ${m.source}">${escapeText(m.source)}</span>
        <a data-copy="${i}" title="${escapeText(t('detail.selectCopy'))}">${escapeText(catById(m.category)?.name || '')} · ${escapeText(t(m.active ? 'detail.copyOn' : 'detail.copyOff'))}</a>
        <div class="km-muted">${escapeText(folderOf(m.filePath))}</div></div>`).join('')}
      <div class="km-muted">${escapeText(t('detail.copiesNote'))}</div>
    </div>` : ''}`;
  // The 📋 inside a button copies the address / folder instead of opening it.
  const button = (key, text, open) => box.querySelector(`[data-open="${key}"]`).onclick = (e) => {
    if (e.target.closest('.km-copy-icon')) copyToClipboard(text);
    else open();
  };
  button('steam', f.steamUrl, () => window.api.openExternal(f.steamUrl));
  button('install', f.install, () => window.api.openFolder(f.install));
  button('workshop', f.workshop, () => window.api.openFolder(f.workshop));
  updateDetailLinks(mod, f);
  box.querySelectorAll('[data-copy]').forEach((a) => a.onclick = () => {
    const copy = copies[+a.dataset.copy];
    setSelection([copy.filename]);
    renderColumns();
    columnsContainer.querySelector(`.mod-card[data-filename="${CSS.escape(copy.filename)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  // Tags not fetched yet: get them once, then redraw if this mod is still shown.
  if (f.workshopId && !tags) {
    const req = ++detailTagsRequest;
    window.api.fetchWorkshopDetails([f.workshopId]).then((res) => {
      const d = res?.[f.workshopId];
      if (!d) return;
      (config.workshopTags ||= {})[f.workshopId] = d.tags || [];
      if (req === detailTagsRequest && selectedMod === mod) updateDetailExtras(mod);
    }).catch(() => {});
  }
}

// ===== Detail panel: dependencies you can click =====
// Required / referenced mods and "Used by" are listed one per line; click one to go to it.
// A problem is red, with the warning on the line below.

// Select a mod and scroll to it (its category is opened if it was collapsed).
function jumpToMod(mod) {
  if (minimizedCategories.has(mod.category)) minimizedCategories.delete(mod.category);
  editFocus = { area: 'cat', cat: mod.category };
  setSelection([mod.filename]);
  renderColumns();
  requestAnimationFrame(() => {
    const sel = `.mod-card[data-filename="${CSS.escape(mod.filename)}"]`;
    columnsContainer.querySelector(`.category-column[data-category="${CSS.escape(mod.category)}"] ${sel}`)?.scrollIntoView({ block: 'center', inline: 'nearest' });
    orderList.querySelector(sel)?.scrollIntoView({ block: 'nearest' });
  });
}

const DEP_WARNING = { missing: 'deps.warnMissing', off: 'deps.warnOff', after: 'deps.warnAfter', before: 'deps.warnBefore' };

// What is wrong with `mod` needing `depMod`: 'missing' | 'off' | 'after' (it loads
// later than `mod`) | null.
function depState(mod, depMod) {
  if (!depMod) return 'missing';
  if (!depMod.active) return 'off';
  const pos = actualOrder.indexOf(mod.filename);
  const depPos = actualOrder.indexOf(depMod.filename);
  if (mod.active && pos >= 0 && depPos >= 0 && pos < depPos) return 'after';
  return null;
}

function depItem(text, target, state, tip) {
  const item = document.createElement('div');
  item.className = 'km-dep-item';
  const name = document.createElement('span');
  name.className = 'km-dep' + (state ? ' km-dep-bad' : '') + (target ? ' km-dep-link' : '');
  name.textContent = text;
  name.title = [tip, target ? t('detail.jumpTip') : ''].filter(Boolean).join('\n');
  if (target) name.addEventListener('click', () => jumpToMod(target));
  item.appendChild(name);
  if (state) {
    const why = document.createElement('div');
    why.className = 'km-dep-reason';
    why.textContent = `(${t(DEP_WARNING[state])})`;
    item.appendChild(why);
  }
  return item;
}

function fillDepList(el, mod, deps) {
  el.replaceChildren(...deps.map((dep) => {
    const depMod = findDepMod(dep);
    return depItem(dep, depMod, depState(mod, depMod), depMod ? depMod.displayName : '');
  }));
}

// "Used by": mods that list this one. Red when that mod is on but loads before this one.
function fillDependents(el, mod, dependents) {
  el.replaceChildren(...dependents.map((m) => {
    const pos = actualOrder.indexOf(m.filename);
    const myPos = actualOrder.indexOf(mod.filename);
    const early = m.active && mod.active && pos >= 0 && myPos >= 0 && pos < myPos;
    return depItem(m.displayName, m, early ? 'before' : null, '');
  }));
}

// Required / referenced mods that load after `mod` (it is on).
function depsLoadingAfter(mod) {
  if (!mod?.active) return [];
  const out = [];
  for (const dep of (mod.dependencies || []).concat(mod.references || [])) {
    const depMod = findDepMod(dep);
    if (depMod && depState(mod, depMod) === 'after' && !out.includes(depMod)) out.push(depMod);
  }
  return out;
}

// Put `mod` right after the last of its required mods in the actual order, and pin it.
function placeAfterDeps(mod) {
  const after = depsLoadingAfter(mod);
  if (!after.length) return;
  const rest = actualOrder.filter((f) => f !== mod.filename);
  const last = after.reduce((a, b) => (rest.indexOf(a.filename) > rest.indexOf(b.filename) ? a : b));
  setPosition([mod.filename], rest.indexOf(last.filename) + 2);
  commitLayout();
  setStatus(t('deps.placed', { name: mod.displayName, after: last.displayName, pos: actualOrder.indexOf(mod.filename) + 1 }), 'success');
}

// The button under the required mods in the detail panel.
function updateDepFix(mod) {
  const box = document.getElementById('km-dep-fix');
  if (!box) return;
  box.replaceChildren();
  if (!depsLoadingAfter(mod).length) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-subbar km-dep-fix-btn';
  btn.textContent = '📌 ' + t('deps.placeAfter');
  btn.title = t('deps.placeAfterTip');
  btn.addEventListener('click', () => placeAfterDeps(mod));
  box.appendChild(btn);
}

// The same action in the mod context menu (right under "Send to #").
function updateDepFixMenu(bulkMods) {
  const el = document.getElementById('mod-context-fix-deps');
  const targets = bulkMods.filter((m) => depsLoadingAfter(m).length);
  el.classList.toggle('hidden', !targets.length);
  el.textContent = '📌 ' + t('deps.placeAfter') + (targets.length > 1 ? ` (${targets.length})` : '');
  el.onclick = () => {
    hideContextMenu();
    for (const m of targets) placeAfterDeps(m);
  };
}

// ===== Busy overlay =====
// Long jobs cover the window so nothing else can be changed meanwhile.

let busyDepth = 0;

function isBusy() {
  return busyDepth > 0;
}

async function withBusy(text, fn) {
  const overlay = document.getElementById('busy-overlay');
  busyDepth++;
  if (busyDepth === 1) {
    document.activeElement?.blur?.();
    hideContextMenu();
    overlay.classList.remove('hidden');
  }
  document.getElementById('busy-text').textContent = text;
  try {
    return await fn();
  } finally {
    busyDepth--;
    if (!busyDepth) overlay.classList.add('hidden');
  }
}

function busyText(text) {
  if (isBusy()) document.getElementById('busy-text').textContent = text;
}

// ===== Small dialogs =====

// A dialog with several buttons; resolves with the clicked button's key (null on Esc).
function choiceModal(title, text, buttons) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-box km-choice">
      <div class="modal-title">${escapeText(title)}</div>
      <div class="km-choice-text">${escapeText(text)}</div>
      <div class="modal-buttons">${buttons.map((b) => `<button class="btn${b.primary ? ' btn-primary' : ''}" data-key="${b.key}">${escapeText(b.text)}</button>`).join('')}</div>
    </div>`;
    const done = (key) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(key);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
    };
    overlay.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => done(b.dataset.key)));
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    overlay.querySelector('.btn-primary')?.focus();
  });
}

// A wide dialog whose content is drawn by the caller; returns { box, close }.
function openWideModal(extraClass = '', onEscape = null) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'modal-box km-wide ' + extraClass;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const onKey = (e) => {
    if (e.key === 'Escape' && overlay.isConnected && !document.querySelector('.km-choice')) {
      e.preventDefault();
      e.stopPropagation();
      if (onEscape) onEscape(); else close();
    }
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);
  return { box, close };
}

function dialogOpen() {
  return isBusy() || !!document.querySelector('.modal-overlay:not(.hidden)');
}

// ===== Actual load order panel (left) =====

const orderPanel = document.getElementById('order-panel');
const orderList = document.getElementById('order-mods');

function depProblems(mod, position) {
  const problems = [];
  for (const dep of (mod.dependencies || []).concat(mod.references || [])) {
    const depMod = findDepMod(dep);
    if (!depMod) problems.push(`${dep} — ${t('deps.notInstalled')}`);
    else if (!depMod.active) problems.push(`${dep} — ${t('deps.notActive')}`);
    else if (position[mod.filename] < position[depMod.filename]) problems.push(`${dep} — ${t('deps.loadsAfter')}`);
  }
  return problems;
}

// Ctrl+click: in or out of the selection. A mod taken out isn't the shown one any more (it
// stayed marked as selected): the last one still selected is, or none.
function ctrlToggle(mod) {
  if (selectedMods.has(mod.filename)) {
    selectedMods.delete(mod.filename);
    if (selectedMod?.filename === mod.filename) selectedMod = modByFile([...selectedMods].pop()) || null;
  } else {
    selectedMods.add(mod.filename);
    selectedMod = mod;
  }
  lastClickedMod = mod;
}

// Only the selection changed: mark the cards (and what the selected mod conflicts with) and
// show it in the detail panel, without drawing every list again.
let selDrawnFor = null;
function redrawSelection() {
  // the tutorial shown at start: the first mod picked (any list, mouse or keys) shows its details
  if (tutorialUntilPick && selectedMod) { tutorialUntilPick = false; switchTab(tabDetails); }
  const rel = selectedMod && conflictData ? conflictData.modConflicts[selectedMod.realFile] : null;
  for (const card of document.querySelectorAll('#category-columns .mod-card, #pinned-uncat-panel .mod-card, #order-mods .mod-card')) {
    const f = card.dataset.filename;
    card.classList.toggle('selected', selectedMods.has(f) || selectedMod?.filename === f);
    if (!card.closest('#order-mods')) {
      const m = rel && f !== selectedMod.filename ? modByFile(f) : null;
      const r = m ? getConflictRelationship(selectedMod.realFile, m.realFile, rel) : null;
      card.classList.toggle('conflict-highlight-green', r === 'overwriting');
      card.classList.toggle('conflict-highlight-red', r === 'overwritten');
      card.classList.toggle('conflict-highlight-yellow', r === 'dead');
    }
  }
  if (selDrawnFor !== selectedMod) updateDetailPanel();
  selDrawnFor = selectedMod;
  showEditFocus();
}

let orderPanelKey = null; // what the list was last drawn from

function renderOrderPanel() {
  // Only the selection changed (a click, Ctrl+click…): just mark it — drawing the whole list
  // again (with every mod's dependency check) was most of the time a click took.
  const key = [actualOrder.map((f) => f + ':' + (modByFile(f)?.displayName || '')).join('|'), [...pins].join('|'), categories.map((c) => c.id + c.color + c.name).join('|'),
    currentLocale, mods.length, mods.filter((m) => m.active).length].join('#');
  if (key === orderPanelKey && orderList.querySelector('.mod-card, .order-empty')) {
    for (const card of orderList.querySelectorAll('.mod-card')) {
      const f = card.dataset.filename;
      card.classList.toggle('selected', selectedMods.has(f) || selectedMod?.filename === f);
    }
    return;
  }
  orderPanelKey = key;
  const scroll = orderList.scrollTop;
  const position = Object.fromEntries(actualOrder.map((f, i) => [f, i + 1]));
  const frag = document.createDocumentFragment();
  for (const filename of actualOrder) {
    const mod = modByFile(filename);
    if (!mod) continue;
    const cat = catById(mod.category) || catById(UNCATEGORIZED);
    const card = document.createElement('div');
    card.className = 'mod-card order-card';
    card.dataset.filename = filename;
    card.draggable = true;
    card.style.borderLeftColor = cat.color;
    if (selectedMods.has(filename) || selectedMod?.filename === filename) card.classList.add('selected');
    const problems = depProblems(mod, position);
    if (problems.length) card.classList.add('dep-highlight-red');
    const pinned = pins.has(filename);
    card.title = `${mod.displayName}\n${t('order.category')}: ${cat.name}` + (pinned ? '\n📌 ' + t('pin.tip') : '') + problems.map((p) => '\n• ' + p).join('');
    card.innerHTML = `<span class="card-handle">${position[filename]}</span>
      <span class="card-checkbox"><input type="checkbox" checked></span>
      <span class="card-name">${escapeText(mod.displayName)}</span>
      ${pinned ? `<span class="km-pin" title="${escapeText(t('pin.tip'))}">📌</span>` : ''}`;
    frag.appendChild(card);
  }
  if (!actualOrder.length) {
    const empty = document.createElement('div');
    empty.className = 'order-empty';
    empty.textContent = t('order.empty');
    frag.appendChild(empty);
  }
  orderList.replaceChildren(frag);
  orderList.scrollTop = scroll;
  document.getElementById('order-count').textContent = actualOrder.length + (pins.size ? ` · 📌${pins.size}` : '');
  document.getElementById('order-reset-btn').disabled = !pins.size;
}

document.getElementById('order-reset-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  unpinAll();
});

orderList.addEventListener('click', (e) => {
  const card = e.target.closest('.mod-card');
  if (!card) return;
  const mod = modByFile(card.dataset.filename);
  if (!mod) return;
  if (e.target.matches('input[type="checkbox"]')) {
    e.stopPropagation();
    const targets = selectedMods.has(mod.filename) && selectedMods.size > 1 ? [...selectedMods] : [mod.filename];
    for (const f of targets) { const m = modByFile(f); if (m) m.active = false; }
    commitLayout();
    return;
  }
  if (e.shiftKey && lastClickedMod) {
    const a = actualOrder.indexOf(lastClickedMod.filename);
    const b = actualOrder.indexOf(mod.filename);
    if (a >= 0 && b >= 0) {
      if (!e.ctrlKey) selectedMods.clear();
      actualOrder.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((f) => selectedMods.add(f));
    }
  } else if (e.ctrlKey || e.metaKey) {
    ctrlToggle(mod);
    redrawSelection();
    return;
  } else {
    selectedMods.clear();
    selectedMods.add(mod.filename);
  }
  selectedMod = mod;
  lastClickedMod = mod;
  redrawSelection();
});

orderList.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.mod-card');
  if (!card) return;
  e.preventDefault();
  e.stopPropagation();
  const mod = modByFile(card.dataset.filename);
  if (!selectedMods.has(mod.filename)) {
    selectedMods.clear();
    selectedMods.add(mod.filename);
    selectedMod = mod;
  }
  showModContextMenu(e.clientX, e.clientY, mod);
});

orderList.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.mod-card');
  if (!card) return;
  const f = card.dataset.filename;
  const files = selectedMods.has(f) && selectedMods.size > 1 ? actualOrder.filter((x) => selectedMods.has(x)) : [f];
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', files.join('\n'));
  requestAnimationFrame(() => card.classList.add('dragging'));
});

orderList.addEventListener('dragend', () => {
  orderList.querySelectorAll('.dragging, .drop-above, .drop-below').forEach((c) => c.classList.remove('dragging', 'drop-above', 'drop-below'));
  orderPanel.classList.remove('drag-over-column');
});

function orderDropTarget(e) {
  const card = e.target.closest('.mod-card');
  if (!card || card.classList.contains('dragging')) return null;
  const r = card.getBoundingClientRect();
  return { card, below: e.clientY > r.top + r.height / 2 };
}

orderList.addEventListener('dragover', (e) => {
  if (draggingCategory) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  orderList.querySelectorAll('.drop-above, .drop-below').forEach((c) => c.classList.remove('drop-above', 'drop-below'));
  const target = orderDropTarget(e);
  if (target) target.card.classList.add(target.below ? 'drop-below' : 'drop-above');
  orderPanel.classList.toggle('drag-over-column', !target);
});

orderList.addEventListener('dragleave', (e) => {
  if (!orderList.contains(e.relatedTarget)) {
    orderList.querySelectorAll('.drop-above, .drop-below').forEach((c) => c.classList.remove('drop-above', 'drop-below'));
    orderPanel.classList.remove('drag-over-column');
  }
});

// Dropping here sets the actual position (categories stay as they are) and pins.
orderList.addEventListener('drop', (e) => {
  if (draggingCategory) return;
  e.preventDefault();
  const files = (e.dataTransfer.getData('text/plain') || '').split('\n').filter((f) => modByFile(f));
  const target = orderDropTarget(e);
  orderList.querySelectorAll('.drop-above, .drop-below').forEach((c) => c.classList.remove('drop-above', 'drop-below'));
  orderPanel.classList.remove('drag-over-column');
  if (!files.length) return;
  const rest = actualOrder.filter((f) => !files.includes(f));
  let pos = rest.length + 1;
  if (target) pos = rest.indexOf(target.card.dataset.filename) + 1 + (target.below ? 1 : 0);
  setPosition(files, pos);
  setSelection(files);
  commitLayout();
});

// Order panel width
(() => {
  const handle = document.getElementById('order-resize-handle');
  let dragging = false;
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const left = orderPanel.getBoundingClientRect().left;
    orderPanel.style.width = Math.max(160, Math.min(520, e.clientX - left)) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    config.orderPanelWidth = orderPanel.offsetWidth;
    persistConfig();
  });
})();

// ===== Focus (where select all / paste / Shift+arrows act) =====

let editFocus = null; // { area: 'order' } | { area: 'cat', cat }

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest) return;
  if (e.target.closest('#order-panel')) editFocus = { area: 'order' };
  else {
    const col = e.target.closest('.category-column');
    if (col) editFocus = { area: 'cat', cat: col.dataset.category };
  }
  showEditFocus();
}, true);

function showEditFocus() {
  orderPanel.classList.toggle('kb-focus', editFocus?.area === 'order');
  document.querySelectorAll('.category-column').forEach((col) =>
    col.classList.toggle('kb-focus', editFocus?.area === 'cat' && col.dataset.category === editFocus.cat));
}

// ===== Select all / move / paste / keyboard moves =====

let clipboardFiles = [];

function selectedInOrder() {
  const layout = orderedCatIds().flatMap((id) => catFiles(id));
  return [...new Set(layout.filter((f) => selectedMods.has(f)))];
}

function setSelection(files, last = files[files.length - 1]) {
  selectedMods = new Set(files);
  selectedMod = last ? modByFile(last) : null;
  lastClickedMod = selectedMod;
}

function scrollToSelected() {
  if (!selectedMod) return;
  const sel = `.mod-card[data-filename="${CSS.escape(selectedMod.filename)}"]`;
  requestAnimationFrame(() => {
    (editFocus?.area === 'order' ? orderList : columnsContainer).querySelector(sel)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function selectAllInFocus() {
  if (!editFocus) {
    setStatus(t('edit.needFocus'), 'error');
    return;
  }
  const files = editFocus.area === 'order' ? [...actualOrder] : catFiles(editFocus.cat);
  setSelection(files);
  renderColumns();
  setStatus(t('edit.selected', { count: files.length }), 'success');
}

function pickForMove() {
  const files = selectedInOrder();
  if (!files.length) {
    setStatus(t('edit.noSelection'), 'error');
    return;
  }
  clipboardFiles = files;
  renderColumns();
  setStatus(t('edit.picked', { count: files.length }), 'success');
}

function clearClipboard() {
  if (!clipboardFiles.length) return;
  clipboardFiles = [];
  renderColumns();
}

async function askTopBottom(where) {
  const choice = await choiceModal(t('edit.pasteTitle'), t('edit.askTop', { cat: where }), [
    { key: 'cancel', text: t('modal.cancel') }, { key: 'bottom', text: t('edit.bottom') }, { key: 'top', text: t('edit.top'), primary: true }]);
  return choice === 'cancel' ? null : choice;
}

async function pasteMods() {
  const files = clipboardFiles.filter(modByFile);
  if (!files.length) {
    setStatus(t('edit.clipEmpty'), 'error');
    return;
  }
  const target = lastClickedMod && selectedMods.has(lastClickedMod.filename) && !files.includes(lastClickedMod.filename) ? lastClickedMod : null;
  if (editFocus?.area === 'order') {
    const rest = actualOrder.filter((f) => !files.includes(f));
    let pos;
    if (target && rest.includes(target.filename)) pos = rest.indexOf(target.filename) + 2;
    else {
      const where = await askTopBottom(t('order.title'));
      if (!where) return;
      pos = where === 'top' ? 1 : rest.length + 1;
    }
    setPosition(files, pos);
  } else {
    let catId;
    let before = null;
    syncModCategories();
    if (target) {
      catId = target.category;
      const list = catFiles(catId).filter((f) => !files.includes(f));
      before = list[list.indexOf(target.filename) + 1] || null;
    } else {
      catId = editFocus?.area === 'cat' && catById(editFocus.cat) ? editFocus.cat : UNCATEGORIZED;
      const list = catFiles(catId).filter((f) => !files.includes(f));
      if (list.length) {
        const where = await askTopBottom(catById(catId).name);
        if (!where) return;
        before = where === 'top' ? list[0] : null;
      }
    }
    for (const f of files) moveMod(modByFile(f), catId, before, true);
  }
  clipboardFiles = [];
  setSelection(files);
  commitLayout();
  setStatus(t('edit.pasted', { count: files.length }), 'success');
}

// Shift+↑/↓: one step — in the actual order when the order panel has focus (the mods
// get pinned there), otherwise inside the category.
function moveSelectionStep(dir) {
  if (!selectedMods.size || !lastClickedMod) return;
  if (editFocus?.area === 'order') {
    const sel = actualOrder.filter((f) => selectedMods.has(f));
    if (!sel.length) return;
    const rest = actualOrder.filter((f) => !selectedMods.has(f));
    if (dir < 0) {
      const prev = actualOrder.slice(0, actualOrder.indexOf(sel[0])).reverse().find((f) => !selectedMods.has(f));
      if (!prev) return;
      setPosition(sel, rest.indexOf(prev) + 1);
    } else {
      const next = actualOrder.slice(actualOrder.indexOf(sel[sel.length - 1]) + 1).find((f) => !selectedMods.has(f));
      if (!next) return;
      setPosition(sel, rest.indexOf(next) + 2);
    }
  } else {
    const catId = lastClickedMod.category;
    syncModCategories();
    const list = catFiles(catId);
    const sel = list.filter((f) => selectedMods.has(f));
    if (!sel.length) return;
    const rest = list.filter((f) => !selectedMods.has(f));
    let before;
    if (dir < 0) {
      before = list.slice(0, list.indexOf(sel[0])).reverse().find((f) => !selectedMods.has(f));
      if (!before) return;
    } else {
      const next = list.slice(list.indexOf(sel[sel.length - 1]) + 1).find((f) => !selectedMods.has(f));
      if (!next) return;
      before = rest[rest.indexOf(next) + 1] || null;
    }
    for (const f of sel) moveMod(modByFile(f), catId, before, true);
    noteAutoSorted(catId);
  }
  commitLayout();
  scrollToSelected();
}

// Shift+←/→ (±1) and Ctrl+Shift+←/→ (±Infinity): to another category, keeping the row.
function moveSelectionAcross(step) {
  if (!selectedMods.size || !lastClickedMod) return;
  const cats = orderedCatIds();
  const from = cats.indexOf(lastClickedMod.category);
  const to = step === -Infinity ? 0 : step === Infinity ? cats.length - 1 : from + step;
  if (from === -1 || to < 0 || to >= cats.length || to === from) return;
  const target = cats[to];
  syncModCategories();
  const files = selectedInOrder().filter((f) => modByFile(f).category !== target);
  for (const f of files) {
    const row = catFiles(modByFile(f).category).indexOf(f);
    const list = catFiles(target).filter((x) => !files.includes(x));
    moveMod(modByFile(f), target, list[row] || null, true);
  }
  editFocus = { area: 'cat', cat: target };
  commitLayout();
  showEditFocus();
  scrollToSelected();
}

// Ctrl+Shift+↑/↓: top / bottom of the category, or of the actual order in the panel.
function moveSelectionToEdge(top) {
  if (!selectedMods.size || !lastClickedMod) return;
  if (editFocus?.area === 'order') {
    const sel = actualOrder.filter((f) => selectedMods.has(f));
    if (!sel.length) return;
    setPosition(sel, top ? 1 : Infinity);
  } else {
    syncModCategories();
    const byCat = new Map();
    for (const f of selectedInOrder()) {
      const c = modByFile(f).category;
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(f);
    }
    for (const [catId, files] of byCat) {
      const first = catFiles(catId).find((f) => !files.includes(f)) || null;
      for (const f of files) moveMod(modByFile(f), catId, top ? first : null, true);
      noteAutoSorted(catId);
    }
  }
  commitLayout();
  scrollToSelected();
}

// Move a whole category (◀ ▶, header drag, Ctrl+Shift+Alt+←/→). The columns are the load
// order, so its mods move in the actual order too — except pinned ones, unless the user
// lets them go along.
async function moveCategoryTo(catId, to) {
  const ids = orderedCatIds();
  const i = ids.indexOf(catId);
  if (i === -1 || to < 0 || to >= ids.length || to === i) return;
  const block = [...new Set(catFiles(catId))].filter((f) => modByFile(f)?.active);
  const pinned = block.filter((f) => pins.has(f));
  if (pinned.length) {
    const choice = await choiceModal(t('catMove.title'), t('catMove.text', { name: catById(catId).name, count: pinned.length }), [
      { key: 'cancel', text: t('modal.cancel') },
      { key: 'keep', text: t('catMove.keep') },
      { key: 'move', text: t('catMove.move'), primary: true },
    ]);
    if (!choice || choice === 'cancel') return;
    if (choice === 'move') pinned.forEach((f) => pins.delete(f));
  }
  const prev = [...actualOrder];
  ids.splice(i, 1);
  ids.splice(to, 0, catId);
  setCategoryOrder(ids);
  rebuildOrder(prev, new Set(block));
  prunePins();
  commitLayout();
  // the view follows it (on the next frame: the redraw puts the old scroll position back first)
  requestAnimationFrame(() => columnsContainer.querySelector(`.category-column[data-category="${CSS.escape(catId)}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
}

function moveCategoryBy(catId, step) {
  return moveCategoryTo(catId, orderedCatIds().indexOf(catId) + step);
}

function moveFocusedCategory(step) {
  const catId = editFocus?.area === 'cat' ? editFocus.cat : lastClickedMod?.category;
  if (!catId || !catById(catId)) return;
  editFocus = { area: 'cat', cat: catId };
  moveCategoryBy(catId, step).then(showEditFocus);
}

const EDIT_COMMANDS = {
  selectAll: selectAllInFocus,
  move: pickForMove,
  paste: pasteMods,
  stepUp: () => moveSelectionStep(-1),
  stepDown: () => moveSelectionStep(1),
  catPrev: () => moveSelectionAcross(-1),
  catNext: () => moveSelectionAcross(1),
  top: () => moveSelectionToEdge(true),
  bottom: () => moveSelectionToEdge(false),
  catFirst: () => moveSelectionAcross(-Infinity),
  catLast: () => moveSelectionAcross(Infinity),
  colLeft: () => moveFocusedCategory(-1),
  colRight: () => moveFocusedCategory(1),
  colFirst: () => moveFocusedCategoryToEnd(false),
  colLast: () => moveFocusedCategoryToEnd(true),
};

function runEditCommand(cmd) {
  if (isBusy()) return;
  if (isEditableTarget(document.activeElement)) {
    window.api.nativeEdit(cmd === 'move' ? 'cut' : cmd);
    return;
  }
  if (dialogOpen() || mainScreen.classList.contains('hidden')) return;
  EDIT_COMMANDS[cmd]?.();
}

// Mod context menu: pin / unpin entries (called from showModContextMenu).
function updatePinMenu(bulkMods) {
  updateDepFixMenu(bulkMods);
  updateSubscribeMenu(bulkMods);
  const files = [...new Set(bulkMods.filter((m) => m.active).map((m) => m.filename))];
  const pinned = files.filter((f) => pins.has(f));
  const unpinned = files.filter((f) => !pins.has(f));
  const pinEl = document.getElementById('mod-context-pin');
  const unpinEl = document.getElementById('mod-context-unpin');
  pinEl.classList.toggle('hidden', !unpinned.length);
  unpinEl.classList.toggle('hidden', !pinned.length);
  pinEl.textContent = '📌 ' + t('pin.pinHere') + (unpinned.length > 1 ? ` (${unpinned.length})` : '');
  unpinEl.textContent = '📌 ' + t('pin.unpin') + (pinned.length > 1 ? ` (${pinned.length})` : '');
  pinEl.onclick = () => { hideContextMenu(); pinFiles(unpinned); };
  unpinEl.onclick = () => { hideContextMenu(); unpinFiles(pinned); };
}

// ===== Unsaved changes =====
// "Saved" = the load order last read from or written to mods.cfg, plus the layout at that
// moment, categories included (order, names, colors). Refresh / closing without saving goes
// back to all of it.

let savedOrderKey = null;
let savedCatsKey = null; // the categories (order, names, colors) at the last save
let savedLayout = null;
let savedLayoutKey = null; // taken at the first render after markSaved (placeholders are in by then)

function markSaved(order) {
  savedOrderKey = JSON.stringify(order);
  importMarks = new Map(); // saved (or loaded): the import marks are done
  savedLayout = captureLayout();
  savedLayoutKey = null;
  savedCatsKey = catsKey();
  updateDirtyUI();
}

// The categories as they show: their order (Uncategorized's place too), names and colors.
function catsKey() {
  return JSON.stringify(orderedCatIds().map((id) => { const c = categories.find((x) => x.id === id); return c ? [id, c.name, c.color] : [id]; }));
}

// Where the mods are: each category (by id, not by its place) with its mods in order. (The
// categories' own order, names and colors: catsKey.)
function layoutKey() {
  return JSON.stringify(orderedCatIds().slice().sort().map((id) => [id, getModsForCategory(id).map((m) => m.filename)]).filter(([, files]) => files.length));
}

function isDirty() {
  if (savedOrderKey === null) return false;
  if (JSON.stringify(actualOrder) !== savedOrderKey) return true;
  if (savedCatsKey !== null && catsKey() !== savedCatsKey) return true;
  return savedLayoutKey !== null && layoutKey() !== savedLayoutKey;
}

function updateDirtyUI() {
  if (savedOrderKey !== null && savedLayoutKey === null && mods.length) savedLayoutKey = layoutKey();
  const dirty = isDirty();
  saveBtn.classList.toggle('dirty', dirty);
  saveBtn.textContent = t('toolbar.save') + (dirty ? ' *' : '');
  saveBtn.title = dirty ? t('unsaved.saveTip') : '';
}

async function refreshWithConfirm() {
  if (isBusy() || dialogOpen()) return;
  if (isDirty()) {
    const choice = await choiceModal(t('unsaved.refreshTitle'), t('unsaved.refreshText'), [
      { key: 'cancel', text: t('modal.cancel') }, { key: 'revert', text: t('unsaved.revert'), primary: true }]);
    if (choice !== 'revert') return;
    if (savedLayout) restoreLayout(savedLayout); // the categories go back too
  }
  loadMods();
}

refreshBtn.removeEventListener('click', loadMods);
refreshBtn.addEventListener('click', refreshWithConfirm);

window.api.onConfirmClose(async () => {
  window.api.closeAck();
  if (await updateBlocksClose()) return; // an update downloading / being unpacked (app.js)
  if (mainScreen.classList.contains('hidden') || !isDirty()) {
    await forgetSteamRecords({ quiet: true, closing: true });
    window.api.closeNow();
    return;
  }
  const choice = await choiceModal(t('unsaved.closeTitle'), t('unsaved.closeText'), [
    { key: 'cancel', text: t('modal.cancel') },
    { key: 'discard', text: t('unsaved.discard') },
    { key: 'save', text: t('unsaved.saveClose'), primary: true },
  ]);
  if (choice === 'save') {
    const result = await window.api.saveLoadOrder({ gamePath: config.gamePath, activeModFilenames: loadOrderFiles() });
    if (!result.success) {
      setStatus(t('status.saveError', { error: result.error }), 'error');
      return;
    }
    await autoPackAfterSave(); // (app.js; before the window goes)
  } else if (choice === 'discard') {
    if (savedLayout) restoreLayout(savedLayout); // the categories go back too
  } else {
    return;
  }
  await persistConfig();
  await forgetSteamRecords({ quiet: true, closing: true });
  window.api.closeNow();
});

// ===== Sort rules =====
// A category can have a sort rule (the shared default or its own), by each mod's
// original name. A sort that would change the order of mods that are on asks whether
// the actual load order should follow ("apply") or stay as it is ("keep", 📌 where it
// differs). Auto sort keeps a category sorted and remembers that answer.

const SORT_CLASSES = ['digit', 'hangul', 'latin', 'other'];
const sortCollator = new Intl.Collator(['en', 'ko'], { numeric: true, sensitivity: 'base' });
const HANGUL = String.raw`ᄀ-ᇿ㄰-㆏가-힯`;
const SORT_RUNS = new RegExp(String.raw`\d+|[a-z]+|[${HANGUL}]+|[^\sa-z\d${HANGUL}]+`, 'gi');
const HANGUL_RE = new RegExp(`[${HANGUL}]`);

function defaultSortSpec() {
  return { dir: 'asc', classes: [...SORT_CLASSES], active: 'ignore', auto: false };
}

function sortDefault() {
  const d = { ...defaultSortSpec(), ...(config.sortDefault || {}) };
  d.classes = [...d.classes];
  return d;
}

// Stored rule: category.sort (or config.uncatSort) = { mode: 'default' | 'custom', spec?, auto, order }.
function storedSort(catId) {
  return catId === UNCATEGORIZED ? config.uncatSort : catById(catId)?.sort;
}

function setStoredSort(catId, value) {
  if (catId === UNCATEGORIZED) {
    if (value) config.uncatSort = value; else delete config.uncatSort;
    return;
  }
  const cat = catById(catId);
  if (value) cat.sort = value; else delete cat.sort;
}

function sortRule(catId, stored = storedSort(catId), def = sortDefault()) {
  if (!stored || !['default', 'custom'].includes(stored.mode)) return null;
  const spec = stored.mode === 'default' ? { ...def } : { ...defaultSortSpec(), ...stored.spec };
  return { ...spec, auto: !!stored.auto, order: stored.order === 'keep' ? 'keep' : 'apply' };
}

function charClass(run) {
  const c = run.charAt(0);
  if (/[0-9]/.test(c)) return 'digit';
  if (/[a-z]/i.test(c)) return 'latin';
  return HANGUL_RE.test(c) ? 'hangul' : 'other';
}

// Names compare piece by piece (runs of digits, Latin, Hangul, other), so the
// character priority applies all the way through.
function sortKey(name, rank) {
  return (name.match(SORT_RUNS) || []).map((run) => ({ run, cls: rank.get(charClass(run)) ?? 9, num: /^\d/.test(run) ? Number(run) : null }));
}

function compareKeys(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    const d = (x.cls - y.cls) || (x.num !== null && y.num !== null ? x.num - y.num : sortCollator.compare(x.run, y.run));
    if (d) return d;
  }
  return a.length - b.length;
}

function sortFiles(files, spec) {
  const rank = new Map(spec.classes.map((c, i) => [c, i]));
  const dir = spec.dir === 'desc' ? -1 : 1;
  const keyed = files.map((f) => {
    const m = modByFile(f);
    return { f, key: sortKey(m ? m.displayName : f, rank), on: !!m?.active };
  });
  keyed.sort((a, b) => {
    if (spec.active !== 'ignore' && a.on !== b.on) return (a.on ? -1 : 1) * (spec.active === 'first' ? 1 : -1);
    const first = (a.key[0]?.cls ?? 9) - (b.key[0]?.cls ?? 9);
    return first || dir * compareKeys(a.key, b.key) || dir * (a.f < b.f ? -1 : a.f > b.f ? 1 : 0);
  });
  return keyed.map((k) => k.f);
}

function isSortedBy(catId, spec) {
  const list = catFiles(catId);
  return sameOrder(sortFiles(list, spec), list);
}

function sortCategory(catId, spec) {
  if (!spec || isSortedBy(catId, spec)) return false;
  modOrders[catId] = sortFiles(catFiles(catId), spec);
  return true;
}

// Would sorting change the actual order of this category's mods that are on?
function changesLoadOrder(catId, spec) {
  const pos = new Map(actualOrder.map((f, i) => [f, i]));
  const on = sortFiles(catFiles(catId), spec).filter((f) => pos.has(f));
  return on.some((f, i) => i > 0 && pos.get(on[i - 1]) > pos.get(f));
}

// 'apply' | 'keep' | null (cancelled)
async function askLoadOrder(names) {
  const choice = await choiceModal(t('sortRule.orderTitle'), t('sortRule.orderAsk', { names: names.join(', ') }), [
    { key: 'cancel', text: t('modal.cancel') },
    { key: 'keep', text: t('sortRule.orderKeep') },
    { key: 'apply', text: t('sortRule.orderApply'), primary: true },
  ]);
  return choice === 'cancel' ? null : choice;
}

// Sort categories. entries: [{ catId, spec, mode: 'apply' | 'keep' }].
function applySorts(entries) {
  let changed = 0;
  syncModCategories();
  const prev = [...actualOrder];
  const applied = entries.filter((e) => e.mode !== 'keep');
  for (const e of applied) {
    if (sortCategory(e.catId, e.spec)) changed++;
    for (const f of catFiles(e.catId)) pins.delete(f);
  }
  if (applied.length) {
    rebuildOrder(prev);
    prunePins();
  }
  const mid = [...actualOrder];
  let kept = false;
  for (const e of entries.filter((x) => x.mode === 'keep')) {
    if (sortCategory(e.catId, e.spec)) { changed++; kept = true; }
  }
  if (kept) adoptOrder(mid);
  return changed;
}

// Called at the start of every render: auto-sorted categories that went out of order.
function applyAutoSorts() {
  const jobs = orderedCatIds().map((catId) => ({ catId, spec: sortRule(catId) }))
    .filter((j) => j.spec?.auto && !isSortedBy(j.catId, j.spec));
  if (!jobs.length) return;
  applySorts(jobs.map((j) => ({ ...j, mode: j.spec.order })));
  persistConfig();
  if (justMovedMods.size) setStatus(t('sortRule.autoKept', { name: catById(jobs[0].catId).name }));
}

function noteAutoSorted(catId) {
  if (sortRule(catId)?.auto) setStatus(t('sortRule.autoKept', { name: catById(catId).name }));
}

// 'none' | 'auto' | 'sorted' | 'loose' (moved since it was sorted)
function sortState(catId) {
  const rule = sortRule(catId);
  if (!rule) return 'none';
  if (rule.auto) return 'auto';
  return isSortedBy(catId, rule) ? 'sorted' : 'loose';
}

function specLabel(spec) {
  const order = spec.classes.map((c) => t('sortRule.class.' + c)).join(' › ');
  return [t('sortRule.dir.' + spec.dir), order, t('sortRule.activeShort.' + spec.active)].join(' · ');
}

function sortTip(catId) {
  const rule = sortRule(catId);
  return t('sortRule.state.' + sortState(catId)) + (rule ? '\n' + specLabel(rule) : '')
    + (rule?.auto ? '\n' + t('sortRule.orderShort.' + rule.order) : '') + '\n' + t('sortRule.btnTip');
}

async function sortNow(catId) {
  const spec = sortRule(catId) || sortDefault();
  let mode = sortRule(catId)?.order || 'apply';
  if (changesLoadOrder(catId, spec)) {
    mode = await askLoadOrder([catById(catId).name]);
    if (!mode) return;
  }
  applySorts([{ catId, spec, mode }]);
  const stored = storedSort(catId);
  if (stored) stored.order = mode;
  commitLayout();
  setStatus(t('sortRule.sorted', { name: catById(catId).name }), 'success');
}

async function setAutoSort(catId, on) {
  const base = sortRule(catId) ? storedSort(catId) : { mode: 'default' };
  let order = sortRule(catId)?.order || 'apply';
  if (on) {
    const spec = sortRule(catId, { ...base, auto: true });
    if (changesLoadOrder(catId, spec)) {
      order = await askLoadOrder([catById(catId).name]);
      if (!order) return;
    }
  }
  setStoredSort(catId, { ...base, auto: on, order });
  if (on) applySorts([{ catId, spec: sortRule(catId), mode: order }]);
  commitLayout();
  setStatus(t(on ? 'sortRule.autoOn' : 'sortRule.autoOff', { name: catById(catId).name }), 'success');
}

// One dialog: the default rule, and each category's rule, auto flag and what auto sort
// does to the actual order.
function sortModal(focusId = null) {
  const draft = { def: sortDefault(), rows: new Map(), cats: catEditDraft() };
  for (const catId of orderedCatIds()) {
    const s = storedSort(catId);
    draft.rows.set(catId, {
      mode: sortRule(catId) ? s.mode : 'none',
      spec: s?.spec ? { ...defaultSortSpec(), ...structuredClone(s.spec) } : sortDefault(),
      auto: !!s?.auto,
      order: s?.order === 'keep' ? 'keep' : 'apply',
      orderTouched: false,
      now: false,
    });
  }
  const snapshot = () => JSON.stringify({ def: draft.def, rows: [...draft.rows], cats: catEditKey(draft.cats) });
  const before = snapshot();
  const stored = (r) => (r.mode === 'none' ? null : {
    mode: r.mode,
    ...(r.mode === 'custom' ? { spec: structuredClone({ ...r.spec, auto: undefined }) } : {}),
    auto: r.auto,
    order: r.order,
  });
  const { box, close } = openWideModal();

  const seg = (key, value, options) => `<span class="km-seg">${options.map((o) =>
    `<button type="button" class="${o === value ? 'on' : ''}" data-set="${key}" data-val="${o}">${escapeText(t(`sortRule.${key}.${o}`))}</button>`).join('')}</span>`;
  const specHtml = (spec, target) => `
    <div class="km-spec" data-target="${escapeText(target)}">
      <div class="km-spec-line"><span class="km-spec-lbl">${escapeText(t('sortRule.dirLabel'))}</span>${seg('dir', spec.dir, ['asc', 'desc'])}</div>
      <div class="km-spec-line"><span class="km-spec-lbl" title="${escapeText(t('sortRule.classesTip'))}">${escapeText(t('sortRule.classesLabel'))}</span>
        <span class="km-chips">${spec.classes.map((c, i) => `<span class="km-chip"><button type="button" data-mv="${i}" data-d="-1" ${i ? '' : 'disabled'}>◀</button>${i + 1}. ${escapeText(t('sortRule.class.' + c))}<button type="button" data-mv="${i}" data-d="1" ${i < spec.classes.length - 1 ? '' : 'disabled'}>▶</button></span>`).join('')}</span></div>
      <div class="km-spec-line"><span class="km-spec-lbl">${escapeText(t('sortRule.activeLabel'))}</span>${seg('active', spec.active, ['first', 'last', 'ignore'])}</div>
    </div>`;
  const rowHtml = (catId) => {
    const cat = catById(catId);
    const r = draft.rows.get(catId);
    const rule = sortRule(catId, stored(r), draft.def);
    const files = catFiles(catId);
    const preview = rule ? sortFiles(files, rule).slice(0, 4).map((f) => modByFile(f)?.displayName || f).join(' · ') : '';
    const ed = draft.cats;
    const color = ed.colors[catId] || cat.color;
    const name = ed.names[catId] ?? cat.name;
    const editable = catId !== UNCATEGORIZED;
    if (ed.deleted.has(catId)) {
      return `<div class="km-sort-row deleted" data-id="${escapeText(catId)}"><div class="km-sort-main">
        <span class="km-swatch" style="background:${color}"></span>
        <span class="km-sort-name">${escapeText(name)}</span>
        <span class="km-desc">${escapeText(t('sortEdit.deleted'))}</span>
        <button type="button" class="btn btn-subbar sort-restore" data-k="restore">${escapeText(t('sortEdit.restore'))}</button>
      </div></div>`;
    }
    return `<div class="km-sort-row${catId === focusId ? ' focus' : ''}" data-id="${escapeText(catId)}" title="${escapeText(t('sortEdit.dragTip'))}">
      <div class="km-sort-main">
        ${editable ? `<label class="km-swatch sort-color" style="background:${color}" title="${escapeText(t('sortEdit.colorTip'))}"><input type="color" data-k="color" value="${color}"></label>`
          : `<span class="km-swatch" style="background:${color}"></span>`}
        ${!editable ? `<span class="km-sort-name">${escapeText(name)}</span>`
          : ed.renaming === catId ? `<input type="text" class="sort-name-input" data-k="name" value="${escapeText(name)}">`
          : `<span class="km-sort-name sort-name-edit" data-k="rename" title="${escapeText(t('sortEdit.nameTip'))}">${escapeText(name)}</span>`}
        <select data-k="mode">${['none', 'default', 'custom'].map((m) => `<option value="${m}" ${m === r.mode ? 'selected' : ''}>${escapeText(t('sortRule.mode.' + m))}</option>`).join('')}</select>
        <label class="km-sort-auto" title="${escapeText(t('sortRule.autoTip'))}"><input type="checkbox" data-k="auto" ${r.auto ? 'checked' : ''} ${r.mode === 'none' ? 'disabled' : ''}> ${escapeText(t('sortRule.auto'))}</label>
        ${r.auto && r.mode !== 'none' ? `<select data-k="order" title="${escapeText(t('sortRule.orderTip'))}">${['apply', 'keep'].map((o) => `<option value="${o}" ${o === r.order ? 'selected' : ''}>${escapeText(t('sortRule.orderShort.' + o))}</option>`).join('')}</select>` : ''}
        <button type="button" class="btn btn-subbar${r.now ? ' btn-primary' : ''}" data-k="now" title="${escapeText(t('sortRule.nowTip'))}">${escapeText(t(r.now ? 'sortRule.nowMarked' : 'sortRule.now'))}</button>
        ${editable ? `<button type="button" class="sort-del" data-k="delete" title="${escapeText(t('sortEdit.deleteTip'))}">✕</button>` : '<span class="sort-del-space"></span>'}
      </div>
      ${preview ? `<div class="km-preview">${escapeText(t('sortRule.preview'))}: ${escapeText(preview)}${files.length > 4 ? ' …' : ''}</div>` : ''}
      ${r.mode === 'custom' ? `<div class="km-custom">${specHtml(r.spec, catId)}
        <div class="km-spec-actions">
          <button type="button" class="btn btn-subbar" data-k="load-def">${escapeText(t('sortRule.loadDefault'))}</button>
          <button type="button" class="btn btn-subbar" data-k="save-def">${escapeText(t('sortRule.saveAsDefault'))}</button>
        </div></div>` : ''}
    </div>`;
  };

  const draw = () => {
    const rowsEl = box.querySelector('.km-sort-rows');
    const scroll = rowsEl ? rowsEl.scrollTop : null;
    box.innerHTML = `<div class="modal-title">⇅ ${escapeText(t('sortRule.title'))}</div>
      <p class="km-desc">${escapeText(t('sortRule.desc'))}</p>
      <div class="km-default">
        <div class="km-subtitle">${escapeText(t('sortRule.defaultTitle'))}</div>
        ${specHtml(draft.def, '__def')}
        <div class="km-spec-line"><span class="km-spec-lbl"></span><label title="${escapeText(t('sortRule.autoTip'))}"><input type="checkbox" data-def-auto ${draft.def.auto ? 'checked' : ''}> ${escapeText(t('sortRule.defAuto'))}</label></div>
        <div class="km-spec-actions">
          <button type="button" class="btn btn-subbar" data-bulk="apply" title="${escapeText(t('sortRule.applyAllTip'))}">${escapeText(t('sortRule.applyAll'))}</button>
          <button type="button" class="btn btn-subbar" data-bulk="auto-on">${escapeText(t('sortRule.autoAllOn'))}</button>
          <button type="button" class="btn btn-subbar" data-bulk="auto-off">${escapeText(t('sortRule.autoAllOff'))}</button>
          <button type="button" class="btn btn-subbar" data-bulk="none">${escapeText(t('sortRule.noneAll'))}</button>
        </div>
      </div>
      <div class="km-subtitle">${escapeText(t('sortRule.rowsTitle'))}</div>
      <p class="km-desc sort-edit-hint">${escapeText(t('sortEdit.hint'))}</p>
      <div class="km-sort-rows">${draft.cats.order.map(rowHtml).join('')}</div>
      <div class="modal-buttons"><button class="btn" data-r="cancel">${escapeText(t('modal.cancel'))}</button><button class="btn btn-primary" data-r="ok">${escapeText(t('sortRule.apply'))}</button></div>`;
    const rows = box.querySelector('.km-sort-rows');
    if (scroll !== null) rows.scrollTop = scroll;
    else if (focusId) rows.querySelector('.km-sort-row.focus')?.scrollIntoView({ block: 'nearest' });
    const nameInput = rows.querySelector('.sort-name-input');
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
      const done = (keep) => {
        if (draft.cats.renaming === null) return;
        const id = draft.cats.renaming;
        draft.cats.renaming = null;
        const value = nameInput.value.trim();
        if (keep && value) draft.cats.names[id] = value;
        draw();
      };
      nameInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(false); }
      });
      nameInput.addEventListener('blur', () => done(true));
    }
    // Press and hold a row, then drag: a new place for that category (before `beforeId`).
    sortReorderDrop = (id, to, beforeId) => {
      if (!draft.cats.order.includes(id)) return;
      const order = draft.cats.order.filter((x) => x !== id);
      const at = !beforeId ? order.length : order.includes(beforeId) ? order.indexOf(beforeId) : 0;
      order.splice(at, 0, id);
      draft.cats.order = order;
      draw();
    };
  };

  const specOf = (target) => (target === '__def' ? draft.def : draft.rows.get(target).spec);

  const apply = async () => {
    close();
    if (snapshot() === before) return;
    for (const id of draft.cats.deleted) draft.rows.delete(id);
    const defChanged = JSON.stringify(draft.def) !== JSON.stringify(sortDefault());
    const jobs = [];
    for (const [catId, r] of draft.rows) {
      const next = stored(r);
      const changed = JSON.stringify(storedSort(catId) || null) !== JSON.stringify(next) || (defChanged && r.mode === 'default');
      if (next && (r.now || changed)) jobs.push({ catId, r, spec: sortRule(catId, next, draft.def) });
    }
    // One question for every category whose sort would move mods that are on, unless
    // its auto-sort row already says what to do with the actual order.
    const ask = jobs.filter((j) => !(j.r.auto && j.r.orderTouched) && changesLoadOrder(j.catId, j.spec));
    let answer = null;
    if (ask.length) {
      answer = await askLoadOrder(ask.map((j) => catById(j.catId).name));
      if (!answer) {
        setStatus(t('sortRule.cancelled'));
        return;
      }
    }
    applyCategoryEdits(draft.cats);
    config.sortDefault = structuredClone({ ...draft.def });
    const modes = new Map();
    for (const [catId, r] of draft.rows) {
      const job = jobs.find((j) => j.catId === catId);
      if (job && ask.includes(job)) r.order = answer;
      setStoredSort(catId, stored(r));
      if (job) modes.set(catId, r.order);
    }
    const n = applySorts(jobs.map((j) => ({ catId: j.catId, spec: sortRule(j.catId), mode: modes.get(j.catId) })));
    commitLayout();
    setStatus(t('sortRule.applied', { count: n }), 'success');
  };

  box.addEventListener('click', (e) => {
    const nameEl = e.target.closest('[data-k="rename"]');
    if (nameEl) {
      draft.cats.renaming = nameEl.closest('.km-sort-row').dataset.id;
      return draw();
    }
    const el = e.target.closest('button');
    if (!el) return;
    const specEl = el.closest('.km-spec');
    const rowEl = el.closest('.km-sort-row');
    if (el.dataset.r === 'cancel') return close();
    if (el.dataset.r === 'ok') return apply();
    if (specEl && el.dataset.set) specOf(specEl.dataset.target)[el.dataset.set] = el.dataset.val;
    else if (specEl && el.dataset.mv) {
      const classes = specOf(specEl.dataset.target).classes;
      const i = +el.dataset.mv;
      const j = i + +el.dataset.d;
      [classes[i], classes[j]] = [classes[j], classes[i]];
    } else if (el.dataset.bulk) {
      for (const r of draft.rows.values()) {
        if (el.dataset.bulk === 'apply') Object.assign(r, { mode: 'default', auto: draft.def.auto, now: true });
        if (el.dataset.bulk === 'auto-on') Object.assign(r, { mode: r.mode === 'none' ? 'default' : r.mode, auto: true });
        if (el.dataset.bulk === 'auto-off') r.auto = false;
        if (el.dataset.bulk === 'none') Object.assign(r, { mode: 'none', auto: false, now: false });
      }
    } else if (rowEl && el.dataset.k === 'delete') draft.cats.deleted.add(rowEl.dataset.id);
    else if (rowEl && el.dataset.k === 'restore') draft.cats.deleted.delete(rowEl.dataset.id);
    else if (rowEl) {
      const r = draft.rows.get(rowEl.dataset.id);
      if (el.dataset.k === 'now') {
        r.now = !r.now;
        if (r.now && r.mode === 'none') r.mode = 'default';
      } else if (el.dataset.k === 'load-def') r.spec = { ...structuredClone(draft.def), auto: undefined };
      else if (el.dataset.k === 'save-def') draft.def = { ...structuredClone(r.spec), auto: draft.def.auto };
      else return;
    } else return;
    draw();
  });
  box.addEventListener('change', (e) => {
    const el = e.target;
    const rowEl = el.closest('.km-sort-row');
    if (el.matches('[data-def-auto]')) draft.def.auto = el.checked;
    else if (rowEl && el.dataset.k === 'color') draft.cats.colors[rowEl.dataset.id] = el.value;
    else if (el.dataset.k === 'name') return;
    else if (rowEl && el.dataset.k === 'mode') {
      const r = draft.rows.get(rowEl.dataset.id);
      const was = r.mode;
      r.mode = el.value;
      if (r.mode === 'none') Object.assign(r, { auto: false, now: false });
      else if (was === 'none') r.auto = draft.def.auto;
    } else if (rowEl && el.dataset.k === 'auto') draft.rows.get(rowEl.dataset.id).auto = el.checked;
    else if (rowEl && el.dataset.k === 'order') Object.assign(draft.rows.get(rowEl.dataset.id), { order: el.value, orderTouched: true });
    else return;
    draw();
  });

  draw();
}

// ===== Sort dialog: editing the categories themselves =====

function catEditDraft() {
  return { order: orderedCatIds(), names: {}, colors: {}, deleted: new Set(), renaming: null };
}
function catEditKey(ed) {
  return JSON.stringify([ed.order, ed.names, ed.colors, [...ed.deleted]]);
}

// The dialog's rows are drawn again on every change: one drag handler (cat-menus.js,
// CM.sortRows) calls the open dialog's own drop.
let sortReorderDrop = null;

// Names, colors, deletions, then the new order (the moved categories' 📌 pins are released, as
// when moving one with ◀ ▶, so their mods follow them in the actual order).
function applyCategoryEdits(ed) {
  for (const [id, name] of Object.entries(ed.names)) {
    const cat = catById(id);
    if (!cat || ed.deleted.has(id) || name === cat.name) continue;
    cat.name = name;
    delete cat.def;
  }
  for (const [id, color] of Object.entries(ed.colors)) {
    const cat = catById(id);
    if (cat) cat.color = color;
  }
  const prev = [...actualOrder];
  for (const id of ed.deleted) if (id !== UNCATEGORIZED && catById(id)) removeCategory(id);
  const now = orderedCatIds();
  const next = ed.order.filter((id) => now.includes(id));
  if (next.join('\n') !== now.join('\n')) {
    const stay = new Set(longestKeptOrder(next.map((id) => now.indexOf(id))).map((i) => next[i]));
    const block = next.filter((id) => !stay.has(id)).flatMap((id) => catFiles(id).filter((f) => modByFile(f)?.active));
    block.forEach((f) => pins.delete(f));
    setCategoryOrder(next);
    rebuildOrder(prev, new Set(block));
  } else if (ed.deleted.size) rebuildOrder(prev);
  prunePins();
}

// Positions (in `seq`) of the longest run of categories still in their old order: those didn't
// move, the others did.
function longestKeptOrder(seq) {
  const len = seq.map(() => 1);
  const from = seq.map(() => -1);
  seq.forEach((v, i) => {
    for (let j = 0; j < i; j++) if (seq[j] < v && len[j] + 1 > len[i]) { len[i] = len[j] + 1; from[i] = j; }
  });
  let i = len.indexOf(Math.max(...len));
  const out = [];
  while (i !== -1) { out.unshift(i); i = from[i]; }
  return out;
}

// ===== Category header extras =====

// ✎ rename (next to the name).
function headerRenameButton(catId) {
  if (catId === UNCATEGORIZED) return [];
  const rename = document.createElement('span');
  rename.className = 'column-move-btn km-rename-btn';
  rename.textContent = '✎';
  rename.title = t('category.rename');
  rename.addEventListener('click', (e) => { e.stopPropagation(); renameCategory(catId); });
  return [rename];
}

// ===== Not installed mods: Steam Workshop subscribe queue (subscribe-queue.js) =====
// Required mods that aren't installed are known only by file name, so their queue entry is
// a Workshop search; mods from an import that carries Workshop ids get their own page.

const WORKSHOP_SEARCH = 'https://steamcommunity.com/workshop/browse/?appid=233860&searchtext=';
let importWorkshopIds = {}; // real file name -> Workshop id, from the last import

function queueItem(file) {
  const id = ghostWorkshopId(file);
  const title = file.replace(/\.mod$/i, '');
  if (id) {
    return { id: file, title, url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + id, steamUrl: 'steam://url/CommunityFilePage/' + id };
  }
  const url = WORKSHOP_SEARCH + encodeURIComponent(title);
  return { id: file, title, url, steamUrl: 'steam://openurl/' + url, search: true };
}

// Required / referenced mods of the mods that are on, that aren't installed at all.
function missingRequired(from = mods.filter((m) => m.active)) {
  const out = new Set();
  for (const m of from) {
    for (const dep of (m.dependencies || []).concat(m.references || [])) if (!isDepInstalled(dep, false)) out.add(dep);
  }
  return [...out];
}

// Ghost cards (imported or moved mods that aren't installed) and missing required mods.
function missingFiles() {
  const have = new Set(mods.filter((m) => !m.missing).map((m) => m.realFile));
  return [...new Set([...Object.keys(ghostStore()).filter((f) => !have.has(f)), ...missingRequired()])];
}

// The ones still to subscribe to (subscribed in the queue = waiting for Steam's download).
function toSubscribeFiles() {
  ensurePending();
  return missingFiles().filter((f) => !subscribedPending.has(f));
}

// Workshop id of a mod that isn't installed: from the import, or remembered from when it was
// installed (config.knownWs, filled by syncGhostMods).
function ghostWorkshopId(file) {
  return ghostStore()[file]?.ws || importWorkshopIds[file] || config.knownWs?.[file] || null;
}

function openSubscribeQueue(files) {
  if (!files.length) { setStatus(t('sq.none'), 'success'); return; }
  const { box, close } = openWideModal('km-sq', () => box.querySelector('[data-q="close"]').click());
  subscribeQueue(box, {
    items: files.map(queueItem),
    allowAuto: !!config.subAuto,
    gap: config.subGap ?? SQ_DEFAULT_GAP,
    byCount: config.subGapByCount !== false,
    tr: t,
    openExternal: (url) => window.api.openExternal(url),
    onSettings: (v) => { Object.assign(config, v); persistConfig(); },
    onClose: (items) => {
      for (const it of items) {
        if (it.status === 'subscribed') subscribedPending.add(it.id);
        else if (it.checked) subscribedPending.delete(it.id); // its page says: not subscribed
      }
      savePending();
      close();
      renderColumns();
      setStatus(t('sq.closed', { n: items.filter((it) => it.status === 'subscribed').length }), 'success');
    },
  });
}

function updateMissingButton() {
  const n = toSubscribeFiles().length;
  document.getElementById('missing-count').textContent = n || '';
  document.getElementById('missing-btn').disabled = !n;
}
document.getElementById('missing-btn').addEventListener('click', () => openSubscribeQueue(toSubscribeFiles()));

// Mod context menu: the selection's required mods that aren't installed.
function updateSubscribeMenu(bulkMods) {
  const el = document.getElementById('mod-context-subscribe');
  const ghosts = bulkMods.filter((m) => m.missing).map((m) => m.realFile);
  const files = [...new Set([...ghosts, ...missingRequired(bulkMods.filter((m) => !m.missing))])];
  el.classList.toggle('hidden', !files.length);
  el.textContent = ghosts.length && ghosts.length === files.length ? t('sq.ctx', { n: files.length }) : t('sq.ctxRequired', { n: files.length });
  el.onclick = () => { hideContextMenu(); openSubscribeQueue(files); };
  // A placeholder from an import can be taken off the list (required ones come back while needed).
  const rm = document.getElementById('mod-context-ghost-remove');
  const stored = ghosts.filter((f) => ghostStore()[f]);
  rm.classList.toggle('hidden', !stored.length);
  rm.textContent = t('ghost.menuRemove') + (stored.length > 1 ? ` (${stored.length})` : '');
  rm.onclick = () => {
    hideContextMenu();
    for (const f of stored) { delete ghostStore()[f]; delete modCategories[f]; }
    persistConfig();
    renderColumns();
  };
}

// ===== Mods that aren't installed: placeholder mods =====
// A mod that isn't installed (turned on by an import, or required by a mod that is on) is
// added to the mod list as a placeholder (missing: true): it has a card, a category and a
// place like any mod, so it is selected, dragged, moved with Shift+arrows, sent to a category
// and so on with the others — it just can't be turned on (it never reaches mods.cfg). Once a
// refresh finds the real mod, that mod takes the same key, so it lands in the same place; it
// is turned on and marked "new" until Save.

const subscribedPending = new Set(); // real file names subscribed in the queue this session
let newlyInstalled = new Set();      // mod keys that were placeholders and are installed now
let lastGhostFiles = [];

// config.ghosts: real file name -> { cat, after, ws } for mods an import turned on that
// aren't installed: where they go the first time (category id, the key they follow;
// null = top), and the Workshop id. After that their place is kept like any mod's.
function ghostStore() {
  return (config.ghosts ||= {});
}

function placeholderMod(file) {
  return {
    filename: file, realFile: file, displayName: file.replace(/\.mod$/i, ''), source: 'missing', missing: true,
    active: false, filePath: '', author: '', version: '', description: '', dependencies: [], references: [],
    imagePath: null, url: null, category: UNCATEGORIZED,
  };
}

// The placeholders that should exist now: stored ghosts not installed + missing required mods.
function wantedGhosts() {
  const have = new Set(mods.filter((m) => !m.missing).map((m) => m.realFile));
  const out = new Map(); // file -> needed by
  for (const file of Object.keys(ghostStore())) if (!have.has(file)) out.set(file, []);
  for (const m of mods.filter((x) => x.active && !x.missing)) {
    for (const dep of (m.dependencies || []).concat(m.references || [])) {
      if (isDepInstalled(dep, false)) continue;
      if (!out.has(dep)) out.set(dep, []);
      out.get(dep).push(m.displayName);
    }
  }
  return out;
}

// Add / drop placeholders to match; keep them off (renderColumns calls this first).
function syncGhostMods() {
  // Remember the Workshop id of every installed Workshop mod, so it is still known after the
  // mod is deleted or unsubscribed.
  const known = (config.knownWs ||= {});
  let learned = false;
  for (const m of mods) {
    if (m.missing) continue;
    const id = workshopIdOf(m);
    if (id && known[m.realFile] !== id) { known[m.realFile] = id; learned = true; }
  }
  if (learned) window.api.saveConfig(config);
  const want = wantedGhosts();
  mods = mods.filter((m) => !m.missing || want.has(m.realFile));
  for (const [file, needBy] of want) {
    let m = mods.find((x) => x.realFile === file);
    if (!m) {
      m = placeholderMod(file);
      mods.push(m);
      // First time: the category / place the import gave it, unless it already has one.
      const g = ghostStore()[file];
      if (!modCategories[file] && g?.cat && g.cat !== UNCATEGORIZED && categories.some((c) => c.id === g.cat)) modCategories[file] = g.cat;
      m.category = modCategories[file] && (modCategories[file] === UNCATEGORIZED || categories.some((c) => c.id === modCategories[file])) ? modCategories[file] : UNCATEGORIZED;
      const order = modOrders[m.category] || (modOrders[m.category] = []);
      if (!order.includes(file) && g && g.after !== undefined) {
        const i = g.after ? order.indexOf(g.after) : -1;
        order.splice(g.after === null ? 0 : i >= 0 ? i + 1 : order.length, 0, file);
      }
    }
    m.needBy = needBy;
    m.active = false;
  }
  lastGhostFiles = [...want.keys()];
}

// loadMods() calls this after reading the mod folders again: placeholders whose mod is there
// now are that mod (same key, same place), turned on.
function noteNewlyInstalled() {
  ensurePending();
  const store = ghostStore();
  let changed = false;
  for (const file of new Set([...lastGhostFiles, ...Object.keys(store)])) {
    const mod = mods.find((m) => m.realFile === file && !m.missing);
    if (!mod) continue;
    newlyInstalled.add(mod.filename);
    if (subscribedPending.delete(file)) changed = true;
    mod.active = store[file]?.on !== false; // import settings: "off (info only)"
    if (store[file]) { delete store[file]; changed = true; }
  }
  if (changed) { config.subscribed = [...subscribedPending]; persistConfig(); }
}

// Placeholder cards: ⬇ instead of the check box, dashed, "not installed" / "subscribed".
// Subscribed-but-not-installed is kept in config.subscribed, so it survives a restart.
let pendingLoaded = false;
// The saved list must be read before anything changes or saves it.
function ensurePending() {
  if (pendingLoaded || !config) return;
  pendingLoaded = true;
  for (const x of config.subscribed || []) subscribedPending.add(x);
}
function savePending() {
  ensurePending();
  config.subscribed = [...subscribedPending];
  persistConfig();
}

function applyGhostCards() {
  ensurePending();
  document.querySelectorAll('.mod-card[data-filename]').forEach((card) => {
    const mod = modByFile(card.dataset.filename);
    if (newlyInstalled.has(card.dataset.filename) && mod && !mod.missing && !card.querySelector('.new-badge')) {
      card.classList.add('newly');
      card.insertAdjacentHTML('beforeend', `<span class="new-badge">${escapeText(t('ghost.new'))}</span>`);
    }
    if (!mod?.missing || card.classList.contains('ghost')) return;
    const pending = subscribedPending.has(mod.realFile);
    card.classList.add('ghost');
    card.classList.toggle('pending', pending);
    card.classList.remove('dep-highlight-red', 'dep-highlight-orange');
    const noWs = !pending && !ghostWorkshopId(mod.realFile);
    card.classList.toggle('no-ws', noWs);
    card.title = mod.realFile + (mod.needBy?.length ? '\n' + t('ghost.requiredTip', { list: mod.needBy.slice(0, 5).join(', ') }) : '') + (pending ? '\n' + t('ghost.pendingTip') : '') + (noWs ? '\n' + t('ghost.noWsTip') : '');
    const icon = document.createElement('span');
    icon.className = 'ghost-icon';
    icon.textContent = pending ? '⏳' : '⬇';
    icon.title = t(pending ? 'ghost.pendingTip' : 'ghost.queueTip');
    const box = card.querySelector('.card-checkbox');
    if (box) box.replaceWith(icon); else card.prepend(icon);
    card.querySelectorAll('.source-badge, .card-source').forEach((b) => b.remove());
    card.insertAdjacentHTML('beforeend', `<span class="ghost-badge">${escapeText(t(pending ? 'ghost.pending' : noWs ? 'ghost.noWs' : 'ghost.badge'))}</span>`);
  });
}

// ⬇ on a placeholder: the subscribe queue with it (and the other selected placeholders).
document.addEventListener('click', (e) => {
  const icon = e.target.closest?.('.ghost-icon');
  if (!icon) return;
  e.stopPropagation();
  e.preventDefault();
  const file = modByFile(icon.closest('.mod-card').dataset.filename)?.realFile;
  const others = [...selectedMods].map(modByFile).filter((m) => m?.missing && m.realFile !== file).map((m) => m.realFile);
  openSubscribeQueue([file, ...others]);
}, true);

// ===== Import with preview =====
// An exported list is not applied at once: a preview shows what would change, grouped by
// colour, and lets the user choose
//   - "all": the sender's categories, placement, load order and on/off, or
//   - "mods": only on/off; my categories and load order stay.
// Mods that aren't installed go to the subscribe queue. The changed mods keep a colour mark
// until Save or "Clear import marks".

const IMPORT_KINDS = ['subscribe', 'on', 'off', 'order', 'category'];
let importMarks = new Map(); // mod key (filename) -> kind

// The extra data line of an export: actual order and Workshop ids (older files have none).
const EXPORT_DATA_PREFIX = '# BEEP-DATA ';

function exportDataLine(list = mods, o = EXPORT_ALL) {
  const ws = {};
  for (const m of list) { const id = m.missing ? ghostWorkshopId(m.realFile) : workshopIdOf(m); if (id) ws[m.realFile] = id; }
  const files = new Set(list.map((m) => m.realFile));
  // 🚫 categories by name (Uncategorized as 'Uncategorized'), when the categories come along
  const noLoad = o.cats ? orderedCatIds().filter(catNoLoad).map((id) => (id === UNCATEGORIZED ? 'Uncategorized' : catById(id).name)) : [];
  // 📝 notes of these mods, when chosen (older versions ignore them)
  const notes = {};
  if (o.memo) for (const m of list) { const text = MEMO.get(m.filename); if (text) notes[m.filename] = text; }
  return EXPORT_DATA_PREFIX + JSON.stringify({
    v: 1, savedAt: Date.now(), scope: o.scope, ...(o.cats ? { noLoad } : { noCats: true }),
    ...(o.pins ? { order: loadOrderFiles().filter((f) => files.has(f)) } : {}), ws,
    ...(Object.keys(notes).length ? { notes } : {}),
  });
}

function parseImportText(content) {
  const raw = content.split('\n').map((l) => l.trim());
  let data = {};
  const dataLine = raw.find((l) => l.startsWith(EXPORT_DATA_PREFIX));
  if (dataLine) { try { data = JSON.parse(dataLine.slice(EXPORT_DATA_PREFIX.length)); } catch { /* ignore */ } }
  const lines = raw.filter((l) => l && !l.startsWith('#'));
  const isBeep = lines.some((l) => l.startsWith('[')) && lines.some((l) => l.includes('|'));
  const src = { savedAt: data.savedAt, ws: data.ws || {}, order: data.order || null, entries: [], cats: null };
  if (isBeep) {
    src.cats = [];
    let cur = null;
    for (const line of lines) {
      const m = line.match(/^\[(.+)\]$/);
      if (m) { cur = { name: m[1], files: [] }; src.cats.push(cur); continue; }
      if (!cur) continue;
      const parts = line.split('|');
      const file = parts[0].trim();
      if (!file.endsWith('.mod')) continue;
      const copy = parts.length > 2 ? parts[2].trim() : '';
      const entry = { file, key: copy ? `${file}::${copy}` : file, active: parts.length > 1 ? parts[1].trim() === 'active' : true, cat: cur.name };
      cur.files.push(entry);
      src.entries.push(entry);
    }
  } else {
    const files = lines.filter((l) => l.endsWith('.mod'));
    src.entries = files.map((file) => ({ file, key: file, active: true }));
    src.order = files;
    src.listOnly = true;
  }
  // Exported without categories: one plain list ("Mods only").
  if (data.noCats) src.cats = null;
  src.scope = data.scope || null;
  src.noLoad = Array.isArray(data.noLoad) ? data.noLoad : null; // 🚫 categories (older files: none said)
  src.notes = data.notes && typeof data.notes === 'object' && !Array.isArray(data.notes) ? data.notes : null; // 📝
  return src.entries.length ? src : null;
}

function findImported(entry) {
  return mods.find((m) => !m.missing && m.filename === entry.key) || mods.find((m) => !m.missing && m.realFile === entry.file);
}

function importPlan(src, opts) {
  const plan = new Map();
  const listed = new Set();
  for (const e of src.entries) {
    const mod = findImported(e);
    // Not installed: a place for it (also for mods that were off, when categories come too).
    if (!mod) { if (e.active || (opts.missingTo === 'file' && src.cats)) plan.set(e.file, 'subscribe'); continue; }
    listed.add(mod.filename);
    if (e.active && !mod.active) plan.set(mod.filename, 'on');
    else if (!e.active && mod.active) plan.set(mod.filename, 'off');
  }
  // A plain list names only what is on: the rest goes off.
  if (src.listOnly) for (const m of mods) if (m.active && !listed.has(m.filename)) plan.set(m.filename, 'off');
  if (opts.place === 'file' && src.order) {
    const keyOf = (f) => findImported({ file: f, key: f })?.filename;
    const wanted = src.order.map(keyOf).filter((k) => k && !plan.has(k) && modByFile(k)?.active);
    const set = new Set(wanted);
    const keep = lcsFiles(actualOrder.filter((f) => set.has(f)), wanted);
    for (const k of wanted) if (!keep.has(k)) plan.set(k, 'order');
  }
  if (src.cats && (opts.place === 'file' || opts.missingTo === 'file')) {
    for (const e of src.entries) {
      const mod = findImported(e);
      if (!mod || plan.has(mod.filename)) continue;
      const now = mod.category === UNCATEGORIZED ? 'Uncategorized' : catById(mod.category)?.name;
      const to = e.cat === uncatName() ? 'Uncategorized' : e.cat;
      if (now !== to) plan.set(mod.filename, 'category');
    }
  }
  return plan;
}

// ===== Import settings =====
// What the import changes, on three axes (opts):
//   - place:     'file' — my mods go to the file's categories and places, the load order (and
//                pins) as in the file (also a plain list's order); 'keep' — mine stay;
//   - onoff:     'file' — on/off as in the file (offAbsent: mods of mine it doesn't name go off;
//                keepOff / keepOn: mine that are off / on stay so); 'keep' — mine stay (turnOn:
//                mods on in the file are turned on);
//   - missingTo: mods I don't have come in as placeholders at their place in the file ('file'),
//                at the bottom of Uncategorized ('uncat'), or not at all ('none'); newOn: 'file'
//                / 'off' — whether they're on (so they load once installed).
// Presets (IMPORT_PRESETS): "apply all", "add missing mods only", "missing mods to
// Uncategorized"; changing a detail makes it "custom".
// Below, a board of the mods that change or come in, by target category: a mod can be dragged
// to another category (top / after the mods that are on / bottom), a new category's header
// onto another category to merge it there; with Reset / Undo / Redo. The board is what gets
// applied.

const IMPORT_ZONES = ['top', 'afterActive', 'bottom'];

function importCatKey(name) {
  if (!name || name === 'Uncategorized' || name === uncatName()) return 'id:' + UNCATEGORIZED;
  const c = categories.find((x) => x.name === name);
  return c ? 'id:' + c.id : 'new:' + name;
}

// What a mod of mine will be: on or off.
function importWantsOn(mod, entry, opts) {
  let on = mod.active;
  if (entry && (opts.onoff === 'file' || (opts.turnOn && entry.active))) on = entry.active;
  else if (!entry && opts.offAbsent && opts.onoff === 'file') on = false; // "turn off mods that aren't in the file"
  if (opts.turnOn && entry?.active) on = true;
  if (opts.onoff === 'file' && opts.keepOff && !mod.active) on = false;
  if (opts.onoff === 'file' && opts.keepOn && mod.active) on = true;
  return on;
}

// The board's mods: [{ key, file, label, missing, entry, mod, cat, pos }]
// cat: 'id:<category id>' or 'new:<name>'; pos: 'file' (as in the file), 'stay' (where it is),
// or one of IMPORT_ZONES. moves (key -> { cat, pos }) are the board's drags.
function importEntries(src, opts, moves = {}) {
  const plan = importPlan(src, opts);
  const byFile = opts.missingTo === 'file' && !!src.cats;
  const out = [];
  const seen = new Set();
  const add = (it) => { const mv = moves[it.key]; if (mv) Object.assign(it, mv); out.push(it); };
  for (const e of src.entries) {
    const mod = findImported(e);
    if (!mod) {
      if (opts.missingTo === 'none' || seen.has(e.file)) continue;
      seen.add(e.file);
      add({ key: e.file, file: e.file, label: e.file.replace(/\.mod$/i, ''), missing: true, entry: e,
        cat: byFile ? importCatKey(e.cat) : 'id:' + UNCATEGORIZED, pos: byFile ? 'file' : 'bottom' });
      continue;
    }
    if (seen.has(mod.filename)) continue;
    const byFileMine = opts.place === 'file' && !!src.cats;
    const it = { key: mod.filename, file: mod.realFile, label: mod.displayName, missing: false, entry: e, mod,
      cat: byFileMine && src.cats ? importCatKey(e.cat) : 'id:' + mod.category, pos: byFileMine ? 'file' : 'stay' };
    const changes = importWantsOn(mod, e, opts) !== mod.active || (byFileMine && plan.has(mod.filename) && plan.get(mod.filename) !== 'on' && plan.get(mod.filename) !== 'off') || moves[it.key];
    if (!changes) continue;
    seen.add(mod.filename);
    add(it);
  }
  if (opts.offAbsent && opts.onoff === 'file') {
    for (const mod of mods) {
      if (mod.missing || seen.has(mod.filename) || importWantsOn(mod, null, opts) === mod.active) continue;
      seen.add(mod.filename);
      add({ key: mod.filename, file: mod.realFile, label: mod.displayName, missing: false, entry: null, mod, cat: 'id:' + mod.category, pos: 'stay' });
    }
  }
  return out;
}

// Colour of a board mod, from where it is on the board now.
function importKind(it, plan, opts) {
  if (it.missing) return 'subscribe';
  const on = importWantsOn(it.mod, it.entry, opts);
  if (on !== it.mod.active) return on ? 'on' : 'off';
  if ((it.cat.startsWith('new:') ? null : it.cat.slice(3)) !== it.mod.category) return 'category';
  return plan.get(it.key) === 'order' && opts.place === 'file' ? 'order' : null;
}

// The three presets of the import settings: { place, onoff, missingTo } (applyImport).
const IMPORT_PRESETS = {
  all: { place: 'file', onoff: 'file', missingTo: 'file' },
  fill: { place: 'keep', onoff: 'keep', missingTo: 'file' },
  uncat: { place: 'keep', onoff: 'keep', missingTo: 'uncat' },
};

let importBoard = null; // the open import settings board ({ reset }); Ctrl+R comes through the menu

function importPreview(src) {
  // Three axes (see applyImport); the presets are names for three combinations of them.
  const listFile = !src.cats;
  const presetValues = (p) => {
    const v = { ...IMPORT_PRESETS[p] };
    if (listFile && v.missingTo === 'file') v.missingTo = 'uncat'; // no categories in the file
    return v;
  };
  const presetDefaults = () => ({ keepOff: false, keepOn: false, turnOn: false, offAbsent: !!src.listOnly || src.scope === 'active' });
  // 📝 notes in the file: filled in where I have none (notesOver: replace mine too)
  const opts = { ...presetValues('all'), newOn: 'file', ...presetDefaults(), notes: true, notesOver: false };
  const noteCount = Object.keys(src.notes || {}).filter((k) => modByFile(k)).length;
  const preset = () => Object.keys(IMPORT_PRESETS).find((p) => !(listFile && p === 'fill')
    && ['place', 'onoff', 'missingTo'].every((k) => opts[k] === presetValues(p)[k])) || 'custom';
  let detailsOpen = !!config?.importDetailsOpen;
  let moves = {}; // the board's moves: key -> { cat, pos }
  const undoStack = [];
  const redoStack = [];
  let items = [];
  let edit = false; // "custom edit": every category, moving, selecting, undo
  const collapsed = new Set();
  let selected = new Set();
  let lastClicked = null;
  let focusCat = null; // the category last clicked (Ctrl+A selects its mods)
  let clip = []; // keys cut / copied, waiting for a place (a mod can only be in one place)
  let drag = null; // { keys } or { cat }
  const { box, close } = openWideModal('km-import', () => {
    if (clip.length) { clip = []; draw(); } else close();
  });
  const plan = () => importPlan(src, opts);
  const refresh = () => {
    items = importEntries(src, opts, moves);
    selected = new Set([...selected].filter((k) => items.some((it) => it.key === k)));
    draw();
  };
  const changeMoves = (fn) => { undoStack.push(JSON.stringify(moves)); redoStack.length = 0; fn(); refresh(); };
  const history = (from, to) => { if (!from.length) return; to.push(JSON.stringify(moves)); moves = JSON.parse(from.pop()); refresh(); };
  const reset = () => { if (Object.keys(moves).length) changeMoves(() => { moves = {}; }); };
  importBoard = { reset: () => { if (edit) reset(); } };
  const place = (keys, cat, pos) => changeMoves(() => { for (const k of keys) moves[k] = { cat, pos }; });
  const catName = (key) => (key.startsWith('new:') ? key.slice(4) : key === 'id:' + UNCATEGORIZED ? uncatName() : catById(key.slice(3))?.name || '?');
  const posOrder = { top: 0, file: 1, stay: 1, afterActive: 2, bottom: 3 };
  const boardCats = () => {
    const keys = orderedCatIds().map((id) => 'id:' + id);
    for (const it of items) if (it.cat.startsWith('new:') && !keys.includes(it.cat)) keys.push(it.cat);
    return edit ? keys : keys.filter((k) => items.some((it) => it.cat === k));
  };
  // The board's mods in the order they are shown (for Shift+click and the order of a move).
  const shownOrder = () => boardCats().flatMap((c) => items.filter((it) => it.cat === c).sort((a, b) => posOrder[a.pos] - posOrder[b.pos]).map((it) => it.key));
  const check = (key, text, disabled = false) => `<label class="${disabled ? 'imp-disabled' : ''}"><input type="checkbox" data-o="${key}" ${opts[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${escapeText(text)}</label>`;
  const radio = (name, value, choices) => choices.map(([v, key, off]) => `<label class="${off ? 'imp-disabled' : ''}"><input type="radio" name="${name}" value="${v}" ${value === v ? 'checked' : ''} ${off ? 'disabled' : ''}> ${escapeText(t(key))}</label>`).join('');

  const draw = () => {
    const p = plan();
    const legend = IMPORT_KINDS.map((k) => `<span class="ib-legend imp-${k}"><span class="imp-dot"></span>${escapeText(t('imp.legend.' + k))}</span>`).join('');
    const cats = boardCats();
    const catBox = (key) => {
      const list = items.filter((it) => it.cat === key).sort((a, b) => posOrder[a.pos] - posOrder[b.pos]);
      const isNew = key.startsWith('new:');
      const folded = collapsed.has(key);
      const zone = (z) => `<div class="ib-zone" data-zone="${z}">${escapeText(t(clip.length ? 'imp.pasteHere' : 'imp.zone.' + z, { where: t('imp.zone.' + z) }))}</div>`;
      return `<div class="ib-cat${isNew ? ' ib-new' : ''}${list.length ? '' : ' ib-empty'}${folded ? ' ib-folded' : ''}${edit ? ' ib-editable' : ''}${edit && focusCat === key ? ' ib-focus' : ''}" data-cat="${escapeText(key)}">
        <div class="ib-head"${edit && isNew ? ` draggable="true" data-catdrag="${escapeText(key)}" title="${escapeText(t('imp.mergeTip'))}"` : ''}>
          <button class="ib-fold" data-fold="${escapeText(key)}" title="${escapeText(t(folded ? 'imp.unfold' : 'imp.fold'))}">${folded ? '▸' : '▾'}</button>
          <span class="ib-cat-name">${escapeText(catName(key))}</span>${isNew ? `<span class="ib-new-tag">${escapeText(t('imp.newCat'))}</span>` : ''}<span class="km-muted">${list.length || ''}</span></div>
        ${folded ? '' : `${list.map((it) => {
          const kind = importKind(it, p, opts);
          return `<div class="ib-mod${kind ? ' imp-' + kind : ''}${selected.has(it.key) ? ' ib-sel' : ''}${clip.includes(it.key) ? ' ib-cut' : ''}" ${edit ? 'draggable="true"' : ''} data-key="${escapeText(it.key)}" title="${escapeText(it.label + (kind ? ' · ' + t('imp.legend.' + kind) : ''))}">
            <span class="ib-name">${escapeText(it.label)}</span>${it.pos === 'file' || it.pos === 'stay' ? '' : `<span class="ib-pos">${escapeText(t('imp.zone.' + it.pos))}</span>`}</div>`;
        }).join('')}
        ${edit ? `<div class="ib-zones">${zone('top')}${zone('afterActive')}${zone('bottom')}</div>` : ''}`}
      </div>`;
    };
    const scroll = box.querySelector('.ib-board')?.scrollTop || 0;
    box.innerHTML = `<div class="import-dialog">
      <div class="modal-title">${escapeText(t('imp.title'))}</div>
      <div class="km-muted">${escapeText(t('imp.summary', { date: src.savedAt ? new Date(src.savedAt).toLocaleString() : '-', n: src.entries.filter((e) => e.active).length }))}</div>
      <div class="imp-options">
        <div class="imp-presets">
          ${Object.keys(IMPORT_PRESETS).map((p) => {
            const off = listFile && p === 'fill';
            return `<label class="${off ? 'imp-disabled' : ''}"${off ? ` title="${escapeText(t('imp.presetNoCats'))}"` : ''}><input type="radio" name="imp-preset" value="${p}" ${preset() === p ? 'checked' : ''} ${off ? 'disabled' : ''}>
              <b>${escapeText(t('imp.preset.' + p))}</b> <span class="km-muted">${escapeText(t('imp.presetDesc.' + p))}</span></label>`;
          }).join('')}
          ${preset() === 'custom' ? `<div class="imp-custom">● ${escapeText(t('imp.preset.custom'))}</div>` : ''}
        </div>
        <div class="imp-opt-row imp-load${opts.missingTo === 'none' ? ' imp-disabled' : ''}" title="${escapeText(t('imp.loadTip'))}">
          <b>${escapeText(t('imp.loadTitle'))}</b>
          <span>${escapeText(t('imp.loadWhen'))}</span>
          ${['file', 'off'].map((v) => `<label><input type="radio" name="imp-on" value="${v}" ${opts.newOn === v ? 'checked' : ''} ${opts.missingTo === 'none' ? 'disabled' : ''}> ${escapeText(t(v === 'file' ? 'imp.load.on' : 'imp.load.off'))}</label>`).join('')}
        </div>
        ${noteCount ? `<div class="imp-opt-row"><b>${escapeText(t('memo.impTitle', { n: noteCount }))}</b>${check('notes', t('memo.impTake'))}${check('notesOver', t('memo.impOver'), !opts.notes)}</div>` : ''}
        <details class="imp-details" ${detailsOpen ? 'open' : ''}>
          <summary><b>${escapeText(t('imp.details'))}</b> <span class="km-muted">${escapeText([t('imp.sum.place.' + opts.place), t('imp.sum.onoff.' + opts.onoff), t('imp.sum.missing.' + opts.missingTo)].join(' · '))}</span></summary>
          <div class="imp-detail-row"><span class="imp-detail-lbl">${escapeText(t('imp.d.place'))}</span>${radio('imp-place', opts.place, [['file', 'imp.v.file'], ['keep', 'imp.v.keep']])}</div>
          <div class="imp-detail-row"><span class="imp-detail-lbl">${escapeText(t('imp.d.onoff'))}</span>${radio('imp-onoff', opts.onoff, [['file', 'imp.v.file'], ['keep', 'imp.v.keep']])}</div>
          <div class="imp-detail-sub">${opts.onoff === 'file'
            ? `${check('offAbsent', t('imp.optOffAbsent'))}${check('keepOff', t('imp.optKeepOff'))}${check('keepOn', t('imp.optKeepOn'))}`
            : check('turnOn', t('imp.optTurnOn'))}</div>
          <div class="imp-detail-row"><span class="imp-detail-lbl">${escapeText(t('imp.d.missingTo'))}</span>${radio('imp-missing', opts.missingTo, [['file', 'imp.v.missing.file', listFile], ['uncat', 'imp.v.missing.uncat'], ['none', 'imp.v.missing.none']])}</div>
        </details>
      </div>
      <div class="ib-top"><b>${escapeText(t('imp.board'))}</b>
        <label class="ib-edit"><input type="checkbox" data-r="edit" ${edit ? 'checked' : ''}> ${escapeText(t('imp.customEdit'))}</label>
        <span class="ib-tools">
          <button class="btn btn-subbar" data-r="fold-all">${escapeText(t('imp.foldAll'))}</button>
          <button class="btn btn-subbar" data-r="unfold-all">${escapeText(t('imp.unfoldAll'))}</button>
          ${edit ? `<button class="btn btn-subbar" data-r="undo" ${undoStack.length ? '' : 'disabled'} title="Ctrl+Z">↶ ${escapeText(t('imp.undo'))} (${undoStack.length})</button>
          <button class="btn btn-subbar" data-r="redo" ${redoStack.length ? '' : 'disabled'} title="Ctrl+Y">↷ ${escapeText(t('imp.redo'))} (${redoStack.length})</button>
          <button class="btn btn-subbar" data-r="reset" ${Object.keys(moves).length ? '' : 'disabled'} title="${escapeText(t('imp.resetTip'))} (Ctrl+R)">${escapeText(t('imp.reset'))}</button>` : ''}
        </span></div>
      <div class="km-muted ib-hint">${escapeText(t(!edit ? 'imp.boardTipView' : clip.length ? 'imp.clipTip' : 'imp.boardTip', { n: clip.length }))}</div>
      <div class="ib-legends">${legend}</div>
      <div class="ib-board${clip.length ? ' ib-picking' : ''}">${items.length || edit ? cats.map(catBox).join('') : `<p class="km-muted">${escapeText(t('imp.noChanges'))}</p>`}</div>
      <div class="modal-buttons"><button class="btn" data-r="no">${escapeText(t('modal.cancel'))}</button><button class="btn btn-primary" data-r="ok">${escapeText(t('imp.apply'))}</button></div>
    </div>`;
    const board = box.querySelector('.ib-board');
    if (board) board.scrollTop = scroll;
  };

  box.addEventListener('change', (e) => {
    if (e.target.name === 'imp-preset') { Object.assign(opts, presetValues(e.target.value), presetDefaults()); refresh(); }
    else if (e.target.name === 'imp-place') { opts.place = e.target.value; refresh(); }
    else if (e.target.name === 'imp-onoff') { opts.onoff = e.target.value; refresh(); }
    else if (e.target.name === 'imp-missing') { opts.missingTo = e.target.value; refresh(); }
    else if (e.target.name === 'imp-on') opts.newOn = e.target.value;
    else if (e.target.dataset.r === 'edit') { edit = e.target.checked; if (!edit) { selected.clear(); clip = []; } draw(); box.focus(); }
    else if (e.target.dataset.o) {
      opts[e.target.dataset.o] = e.target.checked;
      if (opts.keepOff) opts.turnOn = false;
      refresh();
    }
  });
  box.addEventListener('toggle', (e) => {
    if (!e.target.matches?.('.imp-details')) return;
    detailsOpen = e.target.open;
    config.importDetailsOpen = detailsOpen;
    persistConfig();
  }, true);
  box.addEventListener('click', (e) => {
    const fold = e.target.closest('[data-fold]')?.dataset.fold;
    if (fold) {
      // The whole row folds / unfolds together (one short box alone doesn't make the row shorter).
      const boxes = [...box.querySelectorAll('.ib-cat')];
      const top = box.querySelector(`.ib-cat[data-cat="${CSS.escape(fold)}"]`).offsetTop;
      const row = boxes.filter((b) => b.offsetTop === top).map((b) => b.dataset.cat);
      const unfold = collapsed.has(fold);
      for (const k of row) { if (unfold) collapsed.delete(k); else collapsed.add(k); }
      draw();
      return;
    }
    const r = e.target.closest('button')?.dataset.r;
    if (r === 'no') close();
    else if (r === 'ok') { close(); applyImport(src, { ...opts, items }); }
    else if (r === 'undo') history(undoStack, redoStack);
    else if (r === 'redo') history(redoStack, undoStack);
    else if (r === 'reset') reset();
    else if (r === 'fold-all') { for (const k of boardCats()) collapsed.add(k); draw(); }
    else if (r === 'unfold-all') { collapsed.clear(); draw(); }
    if (r || !edit) return;
    // A place for what was cut / copied.
    const zone = e.target.closest('.ib-zone');
    if (zone && clip.length) {
      const keys = clip;
      clip = [];
      place(keys, zone.closest('.ib-cat').dataset.cat, zone.dataset.zone);
      return;
    }
    // Selecting: click, Ctrl+click (add / remove), Shift+click (range).
    const catEl = e.target.closest('.ib-cat');
    if (catEl) focusCat = catEl.dataset.cat;
    const mod = modAt(e);
    if (!mod) { if (catEl) draw(); return; }
    const key = mod.dataset.key;
    if (e.shiftKey && lastClicked) {
      const order = shownOrder();
      const [a, b] = [order.indexOf(lastClicked), order.indexOf(key)].sort((x, y) => x - y);
      if (a >= 0) { if (!e.ctrlKey) selected.clear(); for (const k of order.slice(a, b + 1)) selected.add(k); }
    } else if (e.ctrlKey) {
      if (selected.has(key)) selected.delete(key); else selected.add(key);
      lastClicked = key;
    } else {
      selected = new Set([key]);
      lastClicked = key;
    }
    draw();
  });
  // The mod under the mouse, or — in the thin gap between two — the nearer one.
  const modAt = (e) => {
    const hit = e.target.closest?.('.ib-mod');
    if (hit) return hit;
    const cat = e.target.closest?.('.ib-cat');
    if (!cat || e.target.closest('.ib-head, .ib-zone')) return null;
    let best = null;
    let dist = 7;
    for (const m of cat.querySelectorAll('.ib-mod')) {
      const r = m.getBoundingClientRect();
      const d = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
      if (d < dist) { dist = d; best = m; }
    }
    return best;
  };
  box.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || e.target.closest('input, select, textarea') || !edit) return;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.code === 'KeyZ' && !e.shiftKey) { handled(); history(undoStack, redoStack); }
    else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { handled(); history(redoStack, undoStack); }
    else if (e.code === 'KeyR') { handled(); reset(); }
    else if (e.code === 'KeyA') {
      // the mods of the category last clicked
      handled();
      if (!focusCat) { setStatus(t('imp.selectAllWhere'), 'warning'); return; }
      selected = new Set(shownOrder().filter((k) => items.find((it) => it.key === k)?.cat === focusCat));
      draw();
    }
    else if (e.code === 'KeyC' || e.code === 'KeyX') {
      handled();
      if (!selected.size) return;
      clip = shownOrder().filter((k) => selected.has(k));
      draw();
    } else if (e.code === 'KeyV') {
      handled();
      // Ctrl+V: right after the last clicked mod's category, at its bottom.
      if (!clip.length) return;
      const target = items.find((it) => it.key === lastClicked && !clip.includes(it.key));
      if (!target) { setStatus(t('imp.pasteWhere'), 'warning'); return; }
      const keys = clip;
      clip = [];
      place(keys, target.cat, 'bottom');
    }
  });
  box.tabIndex = -1;
  // Drag the selected mods (or the one under the mouse) to a zone of a category, or onto the
  // category (bottom); a new category's header onto another category: all its mods go there.
  box.addEventListener('dragstart', (e) => {
    if (!edit) return;
    const mod = e.target.closest?.('.ib-mod');
    const head = e.target.closest?.('[data-catdrag]');
    if (mod && !selected.has(mod.dataset.key)) {
      // A drag never ends in a click: Ctrl / Shift held while starting it adds to the selection here.
      const key = mod.dataset.key;
      if (e.shiftKey && lastClicked) {
        const order = shownOrder();
        const [a, b] = [order.indexOf(lastClicked), order.indexOf(key)].sort((x, y) => x - y);
        if (a >= 0) for (const k of order.slice(a, b + 1)) selected.add(k);
        selected.add(key);
      } else if (e.ctrlKey) selected.add(key);
      else selected = new Set([key]);
      lastClicked = key;
    }
    drag = mod ? { keys: shownOrder().filter((k) => selected.has(k)) } : head ? { cat: head.dataset.catdrag } : null;
    if (!drag) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'import');
    // The zones lie over the categories (nothing moves under the mouse, or Chromium drops the
    // drag); still not in dragstart itself.
    requestAnimationFrame(() => {
      if (!drag) return;
      box.querySelector('.ib-board')?.classList.add('ib-dragging');
      box.querySelectorAll('.ib-mod').forEach((m) => m.classList.toggle('ib-sel', selected.has(m.dataset.key)));
    });
  });
  const endDrag = () => { drag = null; box.querySelector('.ib-board')?.classList.remove('ib-dragging'); box.querySelectorAll('.ib-over').forEach((x) => x.classList.remove('ib-over')); };
  box.addEventListener('dragend', endDrag);
  box.addEventListener('dragover', (e) => {
    const cat = e.target.closest?.('.ib-cat');
    if (!drag || !cat || cat.dataset.cat === drag.cat) return;
    e.preventDefault();
    e.stopPropagation();
    box.querySelectorAll('.ib-over').forEach((x) => x.classList.remove('ib-over'));
    (e.target.closest('.ib-zone') || cat).classList.add('ib-over');
  });
  box.addEventListener('drop', (e) => {
    const cat = e.target.closest?.('.ib-cat');
    if (!drag || !cat) return;
    e.preventDefault();
    e.stopPropagation();
    const to = cat.dataset.cat;
    const pos = e.target.closest('.ib-zone')?.dataset.zone || 'bottom';
    const d = drag;
    endDrag();
    if (d.keys) place(d.keys, to, pos);
    else if (d.cat && d.cat !== to) place(items.filter((it) => it.cat === d.cat).map((it) => it.key), to, pos);
    else draw();
  });
  refresh();
  box.focus();
}

async function applyImport(src, opts = {}) {
  const o = { place: 'file', onoff: 'file', missingTo: 'file', newOn: 'file', keepOff: false, keepOn: false, turnOn: false, offAbsent: false, ...opts };
  const items = o.items || importEntries(src, o);
  const plan = importPlan(src, o);
  const marks = new Map();
  for (const it of items) {
    if (it.missing) continue;
    const kind = importKind(it, plan, o);
    if (kind) marks.set(it.key, kind);
  }
  // On / off of the mods I have (with the keep / turn-on options).
  // (what it had kept in a 🚫 category goes: the file says now; applyNoLoad keeps it off there)
  const setOn = (mod, entry) => { mod.active = importWantsOn({ active: mod.active || !!mod.parked }, entry, o); mod.parked = false; };
  if (o.place === 'file' && src.cats) {
    // The sender's categories, placement and on/off…
    for (const cat of src.cats) {
      let catId;
      if (cat.name === 'Uncategorized' || cat.name === uncatName()) catId = UNCATEGORIZED;
      else {
        let c = categories.find((x) => x.name === cat.name);
        if (!c) {
          c = { id: generateId(), name: cat.name, color: randomColor(), order: categories.length };
          categories.push(c);
        }
        catId = c.id;
      }
      // 🚫 as in the file (an older file says nothing: mine stay as they are)
      if (src.noLoad) setNoLoadFlag(catId, src.noLoad.includes(catId === UNCATEGORIZED ? 'Uncategorized' : cat.name));
      modOrders[catId] = [];
      for (const e of cat.files) {
        const mod = findImported(e);
        if (!mod) continue;
        mod.category = catId;
        setOn(mod, e);
        if (catId !== UNCATEGORIZED) modCategories[mod.filename] = catId;
        else delete modCategories[mod.filename];
        modOrders[catId].push(mod.filename);
      }
    }
    // …in the file's order (Uncategorized's place too); categories the file doesn't have after them…
    const fileOrder = src.cats.map((cat) => (cat.name === 'Uncategorized' || cat.name === uncatName()
      ? UNCATEGORIZED : categories.find((x) => x.name === cat.name)?.id)).filter(Boolean);
    const inFile = [...new Set(fileOrder)];
    setCategoryOrder([...inFile, ...orderedCatIds().filter((id) => !inFile.includes(id))]);
    syncModCategories();
    // …and the actual load order when the file has it.
    if (src.order) adoptOrder(src.order.map((f) => findImported({ file: f, key: f })?.filename).filter(Boolean), false);
    else { pins.clear(); rebuildOrder([]); }
  } else {
    // My mods stay where they are; on/off as the options say (a plain list's order with "place").
    for (const e of src.entries) {
      const mod = findImported(e);
      if (mod) setOn(mod, e);
    }
    syncModCategories();
    if (o.place === 'file' && src.order) adoptOrder(src.order.map((f) => findImported({ file: f, key: f })?.filename).filter(Boolean), false);
  }

  // "Turn off mods that aren't in the file".
  if (o.offAbsent && o.onoff === 'file') {
    const inFile = new Set(src.entries.map((e) => findImported(e)?.filename).filter(Boolean));
    for (const m of mods) if (!m.missing && !inFile.has(m.filename)) setOn(m, null);
  }

  // Categories the board puts mods in that don't exist yet.
  const catIdOf = (key) => {
    if (key.startsWith('id:')) return key.slice(3);
    const name = key.slice(4);
    let c = categories.find((x) => x.name === name);
    if (!c) {
      c = { id: generateId(), name, color: randomColor(), order: categories.length };
      categories.push(c);
    }
    return c.id;
  };
  const lastActiveIn = (catId, except) => {
    const list = getModsForCategory(catId).filter((m) => m.filename !== except);
    const i = list.map((m) => m.active).lastIndexOf(true);
    return { list: list.map((m) => m.filename), i };
  };

  // Several mods put in the same place keep their board order: each goes after the one before.
  const placed = {}; // 'catId|pos' -> the last mod put there
  // Mods moved on the board: to the chosen category and place.
  for (const it of items) {
    if (it.missing || it.pos === 'file' || it.pos === 'stay') continue;
    const mod = modByFile(it.key);
    if (!mod) continue;
    const catId = catIdOf(it.cat);
    mod.category = catId;
    if (catId === UNCATEGORIZED) delete modCategories[mod.filename]; else modCategories[mod.filename] = catId;
    for (const k of Object.keys(modOrders)) modOrders[k] = (modOrders[k] || []).filter((f) => f !== mod.filename);
    const { list, i } = lastActiveIn(catId, mod.filename);
    const prev = placed[catId + '|' + it.pos];
    let at = prev && list.includes(prev) ? list.indexOf(prev) + 1 : it.pos === 'top' ? 0 : it.pos === 'afterActive' ? i + 1 : list.length;
    // "after the mods that are on" stays below what was put at the top
    const top = placed[catId + '|top'];
    if (it.pos === 'afterActive' && top && list.includes(top)) at = Math.max(at, list.indexOf(top) + 1);
    list.splice(at, 0, mod.filename);
    modOrders[catId] = list;
    placed[catId + '|' + it.pos] = mod.filename;
  }
  syncModCategories();

  // Mods that aren't installed: placeholders where the board has them.
  importWorkshopIds = { ...importWorkshopIds, ...src.ws };
  const missing = o.missingTo !== 'none' ? items.filter((it) => it.missing) : [];
  const store = ghostStore();
  for (const it of missing) {
    // One from an earlier import is placed again.
    mods = mods.filter((m) => !(m.missing && m.realFile === it.file));
    for (const k of Object.keys(modOrders)) modOrders[k] = (modOrders[k] || []).filter((f) => f !== it.file);
    delete modCategories[it.file];
  }
  for (const it of missing) {
    const catId = catIdOf(it.cat);
    let after;
    if (it.pos === 'file') {
      // right after the mod before it in the file's category
      // right after the nearest mod before it (in the file) that is in that category
      const cat = (src.cats || []).find((c) => c.files.includes(it.entry));
      const before = cat ? cat.files.slice(0, cat.files.indexOf(it.entry)).reverse() : [];
      const prev = before.find((e) => { const m = findImported(e); return m ? m.category === catId : missing.some((x) => x.entry === e && catIdOf(x.cat) === catId); });
      after = prev ? (findImported(prev)?.filename || prev.file) : null;
    } else if (placed[catId + '|' + it.pos]) after = placed[catId + '|' + it.pos];
    else if (it.pos === 'top') after = null;
    else {
      const { list, i } = lastActiveIn(catId, it.file);
      const order = (modOrders[catId] || []).filter((f) => f !== it.file);
      if (it.pos === 'afterActive') after = i >= 0 ? list[i] : (placed[catId + '|top'] || null);
      else after = order.length ? order[order.length - 1] : (list.length ? list[list.length - 1] : null);
    }
    if (it.pos !== 'file') placed[catId + '|' + it.pos] = it.file;
    store[it.file] = { cat: catId, after, ws: src.ws[it.file] || null, on: o.newOn === 'off' ? false : !!it.entry?.active };
    if (catId !== UNCATEGORIZED) modCategories[it.file] = catId;
  }
  importMarks = marks;
  await persistConfig();
  renderColumns();
  const notesIn = o.notes !== false && src.notes ? MEMO.merge(src.notes, !!o.notesOver) : 0; // 📝
  setStatus(t('imp.done', { n: marks.size + missing.length }) + (notesIn ? ' · ' + t('memo.imported', { n: notesIn }) : ''), 'success');
  if (missing.length) {
    const files = missing.map((it) => it.file);
    const go = await choiceModal(t('sq.title'), t('imp.subscribeAsk', { n: files.length }), [
      { key: 'no', text: t('modal.close') },
      { key: 'go', text: t('sq.open'), primary: true },
    ]);
    if (go === 'go') openSubscribeQueue(files);
  }
}

// Colour marks on the cards (afterRender calls this).
function applyImportMarks() {
  if (importMarks.size) {
    document.querySelectorAll('.mod-card[data-filename]').forEach((card) => {
      const kind = importMarks.get(card.dataset.filename);
      if (!kind || card.querySelector('.imp-badge')) return;
      card.classList.add('imp-' + kind);
      const badge = document.createElement('span');
      badge.className = 'imp-badge';
      badge.textContent = t('imp.badge.' + kind);
      card.appendChild(badge);
    });
  }
  const btn = document.getElementById('imp-clear-btn');
  btn.classList.toggle('hidden', !importMarks.size);
  btn.textContent = t('imp.clear', { n: importMarks.size });
}
document.getElementById('imp-clear-btn').addEventListener('click', () => { importMarks = new Map(); renderColumns(); });

// What the export panel needs from this app.
const EXP = {
  esc: escapeText,
  smallBtn: 'btn-subbar',
  exportBtn: 'export-list-btn',
  moreBtn: 'export-list-more-btn',
  headerSel: '#category-columns .column-header',
  areaSel: '#category-columns .column-mods, #order-panel',
  extra: ['pins', 'exp.pins'],
  config: () => config,
  saveConfig: (part) => { Object.assign(config, part); window.api.saveConfig(config); },
  blocked: () => dialogOpen() || mainScreen.classList.contains('hidden'),
  selectedCount: () => selectedMods.size,
  catOfHeader: (h) => h.closest('.category-column')?.dataset.category,
  // A category: all of its mods join the selection, or (all in already) leave it.
  toggleCategory: (cat) => {
    const files = getModsForCategory(cat).map((m) => m.filename);
    const all = files.length && files.every((f) => selectedMods.has(f));
    const next = all ? [...selectedMods].filter((f) => !files.includes(f)) : [...new Set([...selectedMods, ...files])];
    setSelection(next, files[files.length - 1]);
    editFocus = { area: 'cat', cat };
    renderColumns();
  },
  toggleMod: (card) => {
    const f = card.dataset.filename;
    if (selectedMods.has(f)) selectedMods.delete(f); else selectedMods.add(f);
    selectedMod = modByFile(f);
    lastClickedMod = selectedMod;
    renderColumns();
  },
  selection: () => [...selectedMods],
  addSelection: (files) => { for (const f of files) if (modByFile(f)) selectedMods.add(f); renderColumns(); },
  clearSel: () => { setSelection([]); renderColumns(); },
  buildApp: (o) => buildExportText(o),
  exportApp: (o) => exportList(o),
  copy: (text) => window.api.copyText(text),
  saveShare: async (text) => {
    const d = new Date();
    const p2 = (x) => String(x).padStart(2, '0');
    const stamp = `${p2(d.getFullYear() % 100)}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const filePath = await window.api.saveFileDialog(`BEEP-mod-links_${stamp}.txt`);
    if (!filePath) return;
    await window.api.writeFile(filePath, text);
    setStatus(t('status.exported'), 'success');
  },
  status: (msg, kind) => setStatus(msg, kind === 'ok' ? 'success' : kind),
  shareItems: (o) => {
    const out = [];
    for (const id of orderedCatIds()) {
      for (const m of getModsForCategory(id)) {
        if (!exportInScope(m, o)) continue;
        const ws = m.missing ? ghostWorkshopId(m.realFile) : workshopIdOf(m);
        out.push({ cat: id === UNCATEGORIZED ? uncatName() : catById(id)?.name || '', title: m.displayName, on: exportIsOn(m), missing: !!m.missing,
          link: ws ? 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + ws : t('exp.noWs') });
      }
    }
    return out;
  },
};

// The selection, for the tools below.
const SEL = {
  has: (k) => selectedMods.has(k),
  set: (k, on) => { if (on) selectedMods.add(k); else selectedMods.delete(k); },
  keyOf: (card) => card.dataset.filename,
  anchor: (k) => { selectedMod = modByFile(k) || null; lastClickedMod = selectedMod; },
  list: () => [...selectedMods],
  replace: (keys) => { selectedMods = new Set(keys.filter((k) => modByFile(k))); },
  // A box or Shift range that took the shown mod out: the last one still selected is shown.
  draw: () => {
    if (selectedMod && !selectedMods.has(selectedMod.filename)) { selectedMod = modByFile([...selectedMods].pop()) || null; lastClickedMod = selectedMod || lastClickedMod; }
    redrawSelection();
  },
  picking: () => exportPicking(),
};

// ===== Selecting: Shift ranges, a box drawn from empty space, short drags =====
// (The same in the main screen and while the Advanced export panel is open.) SEL is this app's
// side: has / set (key, on) / keyOf (card) / anchor (key) / draw ().

// A click whose mouse moved a few pixels starts a drag (cards can be dragged) and the click is
// lost: a drag that ends within 12 px of where it began is that click (nothing is moved).
(() => {
  let down = null;
  let last = null;
  let done = false;
  document.addEventListener('mousedown', (e) => {
    const card = e.button === 0 ? e.target.closest?.('.mod-card') : null;
    down = card ? { x: e.clientX, y: e.clientY, target: e.target, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey } : null;
  }, true);
  document.addEventListener('dragstart', () => { last = null; done = false; }, true);
  document.addEventListener('dragover', (e) => { last = { x: e.clientX, y: e.clientY }; }, true);
  const short = () => down && (!last || Math.hypot(last.x - down.x, last.y - down.y) < 12);
  const asClick = () => {
    if (done || !down) return;
    done = true;
    const d = down;
    setTimeout(() => d.target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, ctrlKey: d.ctrl, shiftKey: d.shift, altKey: d.alt, metaKey: d.meta, clientX: d.x, clientY: d.y })), 0);
  };
  document.addEventListener('drop', (e) => {
    if (!short()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    asClick();
  }, true);
  document.addEventListener('dragend', () => { if (short()) asClick(); }, true);
})();

// Shift+click, as in Explorer: from the anchor (the last mod clicked without Shift — plain or
// Ctrl) to this one, within one list (a category, or the load-order list); the rest of that list
// is let go (Ctrl+Shift: kept), nothing is turned over, and what is selected in other lists stays.
// The anchor stays, so another Shift+click draws the range again from it, Shift held or not. In
// another list (or with no anchor yet) the mod clicked becomes the anchor and is added.
let shiftAnchor = null; // { list, key }
(() => {
  const listOf = (card) => card.closest('.category-column, .order-panel, #order-panel');
  // Lists are drawn again after each click: known by their category (or as the load order).
  const idOf = (list) => (list ? list.dataset.cat || list.dataset.category || 'order' : null);
  const keys = (list) => [...list.querySelectorAll('.mod-card')].map((c) => SEL.keyOf(c));
  // With Shift, Ctrl or Alt held a mod isn't dragged: the press is a click, or a box (below).
  // (Stopping a drag once begun loses the click too: the card isn't draggable for that press.)
  const held = (e) => e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
  document.addEventListener('dragstart', (e) => { if (held(e) && e.target.closest?.('.mod-card')) e.preventDefault(); }, true);
  document.addEventListener('pointerdown', (e) => {
    const card = e.button === 0 && held(e) ? e.target.closest?.('.mod-card[draggable="true"]') : null;
    if (!card) return;
    card.draggable = false;
    const back = () => { document.removeEventListener('pointerup', back, true); setTimeout(() => { card.draggable = true; }); };
    document.addEventListener('pointerup', back, true);
  }, true);
  const cardOf = (e) => {
    if (e.button !== 0) return null;
    const card = e.target.closest?.('.mod-card');
    return card && !e.target.closest('#exp-panel, input, button, a, .ghost-icon') ? card : null;
  };
  // A click without Shift (plain or Ctrl) sets the anchor; the app's own handler does the rest.
  document.addEventListener('click', (e) => {
    const card = e.shiftKey ? null : cardOf(e);
    if (card) shiftAnchor = { list: idOf(listOf(card)), key: SEL.keyOf(card) };
  }, true);
  document.addEventListener('click', (e) => {
    const card = e.shiftKey ? cardOf(e) : null;
    if (!card) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const list = listOf(card);
    const id = idOf(list);
    const key = SEL.keyOf(card);
    const order = list ? keys(list) : [key];
    if (!shiftAnchor || shiftAnchor.list !== id || !order.includes(shiftAnchor.key)) shiftAnchor = { list: id, key };
    const a = order.indexOf(shiftAnchor.key);
    const b = order.indexOf(key);
    if (!(e.ctrlKey || e.metaKey)) for (const k of order) SEL.set(k, false);
    for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) SEL.set(k, true);
    SEL.anchor(key); // (the mod shown; the range's anchor is shiftAnchor)
    SEL.draw();
  }, true);
})();

// A box drawn from empty space (or from a mod, with a key held) selects the mods it touches,
// over several categories too. Alone: these mods (while the export panel is open: added);
// Shift: added; Alt: taken out; Ctrl or Shift+Alt: turned over.
(() => {
  let box = null; // { x, y, el, hit: Set, area, scroll: { left, cols: Map } }
  const AREAS = '#category-columns, #order-mods, .order-mods';
  const start = (e) => {
    if (e.button !== 0 || e.target.closest?.('.column-header, .order-header, button, input, select, a, .ghost-icon, #exp-panel, [class*="resiz"]')) return;
    // On a mod only with Shift, Ctrl or Alt held (without, that's the mod being dragged); and it
    // takes a longer move, so a Shift/Ctrl+click that slips a little is still that click.
    const onCard = !!e.target.closest?.('.mod-card');
    if (onCard && !(e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)) return;
    const area = e.target.closest?.(AREAS);
    if (!area) return;
    // Not on a scroll bar.
    const r = onCard ? null : e.target.getBoundingClientRect?.();
    if (r && (e.clientX > r.left + e.target.clientWidth + 1 || e.clientY > r.top + e.target.clientHeight + 1)) return;
    box = { x: e.clientX, y: e.clientY, el: null, hit: new Set(), area, moved: false, onCard, base: new Set(SEL.list()) };
  };
  const scrollers = () => [box.area, ...box.area.querySelectorAll('.column-mods')];
  const rectOf = (x2, y2) => ({ left: Math.min(box.x, x2), top: Math.min(box.y, y2), right: Math.max(box.x, x2), bottom: Math.max(box.y, y2) });
  let lastX = 0;
  let lastY = 0;
  const update = (x, y, mods) => {
    lastX = x;
    lastY = y;
    const rr = rectOf(x, y);
    Object.assign(box.el.style, { left: rr.left + 'px', top: rr.top + 'px', width: (rr.right - rr.left) + 'px', height: (rr.bottom - rr.top) + 'px' });
    for (const c of box.area.querySelectorAll('.mod-card')) {
      const b = c.getBoundingClientRect();
      if (b.right >= rr.left && b.left <= rr.right && b.bottom >= rr.top && b.top <= rr.bottom && b.height) box.hit.add(SEL.keyOf(c));
    }
    // Shown at once: the selection as it will be.
    const mode = mods.alt && mods.shift ? 'flip' : mods.alt ? 'minus' : mods.ctrl ? 'flip' : mods.shift || SEL.picking() ? 'plus' : 'only';
    box.mode = mode;
    for (const c of box.area.querySelectorAll('.mod-card')) {
      const k = SEL.keyOf(c);
      const inBox = box.hit.has(k);
      const was = box.base.has(k);
      const on = mode === 'only' ? inBox : mode === 'plus' ? was || inBox : mode === 'minus' ? was && !inBox : was !== inBox;
      c.classList.toggle('box-pick', on);
    }
  };
  document.addEventListener('mousedown', start, true);
  document.addEventListener('mousemove', (e) => {
    if (!box) return;
    if (!box.moved) {
      if (Math.hypot(e.clientX - box.x, e.clientY - box.y) < (box.onCard ? 12 : 5)) return;
      box.moved = true;
      box.el = document.createElement('div');
      box.el.className = 'select-box';
      document.body.appendChild(box.el);
      document.body.classList.add('box-selecting');
      box.timer = setInterval(() => {
        // Near an edge: scroll that way (the start point moves along).
        if (!box) return;
        for (const s of scrollers()) {
          const r = s.getBoundingClientRect();
          if (lastX < r.left || lastX > r.right || lastY < r.top || lastY > r.bottom) continue;
          const dx = lastX < r.left + 30 ? -12 : lastX > r.right - 30 ? 12 : 0;
          const dy = s !== box.area && (lastY < r.top + 30 ? -12 : lastY > r.bottom - 30 ? 12 : 0);
          if (dx && s === box.area) { const b = s.scrollLeft; s.scrollLeft += dx; box.x -= s.scrollLeft - b; }
          if (dy) { const b = s.scrollTop; s.scrollTop += dy; if (s.contains(document.elementFromPoint(box.x, box.y))) box.y -= s.scrollTop - b; }
        }
        update(lastX, lastY, box.mods);
      }, 40);
    }
    e.preventDefault();
    box.mods = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
    update(e.clientX, e.clientY, box.mods);
  }, true);
  document.addEventListener('mouseup', (e) => {
    if (!box) return;
    const b = box;
    box = null;
    if (!b.moved) return;
    clearInterval(b.timer);
    b.el.remove();
    document.body.classList.remove('box-selecting');
    document.querySelectorAll('.box-pick').forEach((c) => c.classList.remove('box-pick'));
    const mode = b.mode;
    const keysNow = mode === 'only' ? [] : [...b.base];
    SEL.replace(keysNow);
    for (const k of b.hit) {
      const was = b.base.has(k);
      SEL.set(k, mode === 'only' || mode === 'plus' ? true : mode === 'minus' ? false : !was);
    }
    if (mode === 'only' || mode === 'plus') { const list = [...b.hit]; if (list.length) SEL.anchor(list[list.length - 1]); }
    SEL.draw();
    // The click that ends a box is not a click on empty space (which would clear the selection).
    const swallow = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  }, true);
  // Alt with a box: not the window menu.
  for (const type of ['keydown', 'keyup']) {
    document.addEventListener(type, (e) => { if ((box?.moved || document.body.classList.contains('box-selecting')) && e.key === 'Alt') e.preventDefault(); }, true);
  }
})();

// ===== Advanced export: a panel over the main screen =====
// Opens with a long press on Export, its ▾, File → Advanced export… or Ctrl+Shift+E. It is not
// a dialog: it can be dragged by its title and made small (−), and while it is open the main
// screen only selects — a click on a mod or a category header adds it to the selection or takes
// it out again (several categories and mods add up), Shift+click a range, the selection keys —
// so "Selected mods only" can be built there. Everything else
// (check boxes, dragging, menus, the toolbar, other keys) waits until the panel closes.
// Formats: the app's file (.txt, imports again), a list to share (name + link) to copy or
// save, or the app's file as one string ('BEEP1:…', lib/list-string.js: the same bytes) to copy
// or save. The last choices and the panel's place are kept (EXP.config).

const EXPORT_PRESETS = {
  backup: { format: 'app', ...EXPORT_ALL, memo: true }, // (a backup keeps the 📝 notes too)
  share: { format: 'app', ...EXPORT_ALL, scope: 'active', emptyCats: false },
};
// Keys that still work while picking (the rest wait until the panel closes).
const PICK_ACTIONS = new Set(['selUp', 'selDown', 'selLeft', 'selRight', 'selectAll', 'deselect', 'exportAdvanced', 'undo', 'redo']);

let exportPanel = null; // { o, el, draw, mini }

function exportPicking() {
  return !!exportPanel;
}

function exportAdvancedModal() {
  if (exportPanel) { exportPanel.mini = false; exportPanel.draw(); return; }
  if (EXP.blocked()) return;
  const saved = EXP.config().exportOpts || {};
  const o = { format: 'app', ...EXPORT_ALL, ...saved };
  delete o.mini;
  const el = document.createElement('div');
  el.id = 'exp-panel';
  el.className = 'exp-panel';
  el.tabIndex = -1;
  document.body.appendChild(el);
  const banner = document.createElement('div');
  banner.id = 'exp-banner';
  banner.textContent = t('exp.pickBanner');
  document.body.appendChild(banner);
  document.body.classList.add('export-picking');
  const pos = EXP.config().exportPanelPos;
  // Where it was left; the first time right of the middle, a little below the top.
  const at = pos || { x: Math.round(window.innerWidth * 0.62 - 230), y: Math.round(window.innerHeight * 0.16) };
  el.style.left = Math.max(8, at.x) + 'px';
  el.style.top = Math.max(8, at.y) + 'px';
  el.style.right = 'auto';
  // Undo / redo of the selection while the panel is open (Ctrl+Z / Ctrl+Y too).
  const snap = () => JSON.stringify(SEL.list().sort());
  exportPanel = { o, el, mini: !!saved.mini, draw: null, hist: { undo: [], redo: [], last: snap() }, snap };
  const esc = EXP.esc;
  const keep = () => EXP.saveConfig({ exportOpts: { ...o, mini: exportPanel.mini } });

  const draw = () => {
    if (!exportPanel) return;
    const share = o.format === 'share';
    const r = share ? buildShareList(o) : EXP.buildApp(o);
    const n = EXP.selectedCount();
    const preset = Object.entries(EXPORT_PRESETS).find(([, p]) => Object.keys(p).every((k) => p[k] === o[k]))?.[0];
    const check = (key, text, disabled = false) => `<label class="${disabled ? 'imp-disabled' : ''}"><input type="checkbox" data-o="${key}" ${o[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${esc(text)}</label>`;
    const summary = t('exp.summary', { n: r.mods, on: r.on, c: r.cats, m: r.missing }) + ' · ' + t('exp.format.' + o.format);
    const str = o.format === 'string';
    const actions = share
      ? `<button class="btn ${EXP.smallBtn}" data-x="save-share">${esc(t('exp.saveShare'))}</button><button class="btn btn-primary ${EXP.smallBtn}" data-x="copy" ${r.mods ? '' : 'disabled'}>${esc(t('exp.copy'))}</button>`
      : str
        ? `<button class="btn ${EXP.smallBtn}" data-x="save-str" ${r.mods ? '' : 'disabled'}>${esc(t('exp.saveStr'))}</button><button class="btn btn-primary ${EXP.smallBtn}" data-x="copy-str" ${r.mods ? '' : 'disabled'}>${esc(t('exp.copyStr'))}</button>`
        : `<button class="btn btn-primary ${EXP.smallBtn}" data-x="export" ${r.mods ? '' : 'disabled'}>${esc(t('exp.export'))}</button>`;
    el.classList.toggle('mini', exportPanel.mini);
    el.innerHTML = `<div class="exp-head" title="${esc(t('exp.dragTip'))}">
        <b>${esc(t('exp.title'))}</b><span class="exp-sel">${esc(t('exp.selCount', { n }))}</span>${n ? `<button class="exp-link" data-x="clear-sel" title="Esc">${esc(t('exp.clearSel'))}</button>` : ''}<span class="exp-spacer"></span>
        <button class="exp-hbtn exp-hist" data-x="sel-undo" title="${esc(t('exp.selUndo'))}" ${exportPanel.hist.undo.length ? '' : 'disabled'}>↶ ${exportPanel.hist.undo.length}</button>
        <button class="exp-hbtn exp-hist" data-x="sel-redo" title="${esc(t('exp.selRedo'))}" ${exportPanel.hist.redo.length ? '' : 'disabled'}>↷ ${exportPanel.hist.redo.length}</button>
        <button class="exp-hbtn" data-x="mini" title="${esc(t(exportPanel.mini ? 'exp.expand' : 'exp.minimize'))}">${exportPanel.mini ? '▢' : '−'}</button>
        <button class="exp-hbtn" data-x="close" title="${esc(t('exp.close'))}">✕</button>
      </div>
      ${exportPanel.mini ? '' : `<div class="exp-body">
        <div class="exp-presets">
          ${Object.keys(EXPORT_PRESETS).map((k) => `<button class="btn ${EXP.smallBtn}${preset === k ? ' btn-primary' : ''}" data-p="${k}">${esc(t('exp.preset.' + k))}</button>`).join('')}
          <button class="btn ${EXP.smallBtn}" data-x="quick-links" title="${esc(t('exp.quickLinksTip'))}">🔗 ${esc(t('exp.preset.links'))}</button>
        </div>
        <div class="exp-row"><b>${esc(t('exp.formatLabel'))}</b>
          ${['app', 'share', 'string'].map((f) => `<label><input type="radio" name="exp-format" value="${f}" ${o.format === f ? 'checked' : ''}> ${esc(t('exp.format.' + f))}</label>`).join('')}
        </div>
        <div class="exp-row"><b>${esc(t('exp.scope'))}</b>
          ${['all', 'active', 'selected'].map((s) => `<label><input type="radio" name="exp-scope" value="${s}" ${o.scope === s ? 'checked' : ''}> ${esc(t('exp.scope.' + s, { n }))}</label>`).join('')}
        </div>
        <div class="exp-checks">
          ${check('missing', t('exp.missing'))}
          ${check('cats', t(share ? 'exp.catsShare' : 'exp.cats'))}
          ${check('emptyCats', t('exp.emptyCats'), share || !o.cats)}
          ${check(EXP.extra[0], t(EXP.extra[1]), share)}
          ${check('memo', t('exp.memo'), share)}
        </div>
        <div class="exp-hint">${esc(t(o.scope === 'selected' ? 'exp.pickHint' : share ? 'exp.shareNote' : str ? 'exp.strHint' : o.cats ? 'exp.pickHintShort' : 'exp.noCatsNote'))}</div>
      </div>`}
      <div class="exp-foot"><span class="exp-summary">${esc(summary)}</span><span class="exp-spacer"></span>${actions}</div>`;
    // the string's length, once it is made
    if (str && r.mods) window.api.listStrEncode(r.text).then((s) => { const el2 = el.querySelector('.exp-summary'); if (el2 && exportPanel?.o.format === 'string') el2.textContent = summary + ' · ' + t('exp.strLen', { n: s.length }); });
  };
  exportPanel.draw = draw;

  el.addEventListener('change', (e) => {
    if (e.target.name === 'exp-format') o.format = e.target.value;
    else if (e.target.name === 'exp-scope') o.scope = e.target.value;
    else if (e.target.dataset.o) o[e.target.dataset.o] = e.target.checked;
    keep();
    draw();
  });
  el.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-p]')?.dataset.p;
    if (p) { Object.assign(o, EXPORT_PRESETS[p]); keep(); draw(); return; }
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'close') closeExportPanel();
    else if (x === 'clear-sel') EXP.clearSel();
    else if (x === 'sel-undo') exportSelHistory('undo');
    else if (x === 'sel-redo') exportSelHistory('redo');
    else if (x === 'mini') { exportPanel.mini = !exportPanel.mini; keep(); draw(); clampPanel(); }
    else if (x === 'export') { keep(); const opts = { ...o }; closeExportPanel(); EXP.exportApp(opts); }
    else if (x === 'copy') { await EXP.copy(buildShareList(o).text); EXP.status(t('exp.copied', { n: buildShareList(o).mods }), 'ok'); }
    else if (x === 'save-share') { await EXP.saveShare(buildShareList(o).text, o); }
    else if (x === 'copy-str' || x === 'save-str') {
      // the bytes the file would have, as one string
      const s = await window.api.listStrEncode(EXP.buildApp(o).text);
      if (x === 'copy-str') { await EXP.copy(s); EXP.status(t('exp.strCopied', { n: s.length }), 'ok'); return; }
      const d = new Date();
      const p2 = (v) => String(v).padStart(2, '0');
      const file = await window.api.saveFileDialog(`BEEP-mod-list_${p2(d.getFullYear() % 100)}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}_string.txt`);
      if (!file) return;
      try { await window.api.writeFile(file, s + '\n'); EXP.status(t('exp.strSaved', { path: file }), 'ok'); } catch (err) { EXP.status(t('strImp.err.save', { e: err.message }), 'error'); }
    }
    else if (x === 'quick-links') {
      // A list to share, copied at once: the selected mods when "Selected mods only" is chosen
      // (and some are selected), else the mods that are on.
      const scope = o.scope === 'selected' && EXP.selectedCount() ? 'selected' : 'active';
      Object.assign(o, { format: 'share', scope });
      keep();
      draw();
      const list = buildShareList(o);
      await EXP.copy(list.text);
      EXP.status(t('exp.copied', { n: list.mods }), 'ok');
    }
  });

  // Dragged by its title; kept inside the window.
  const clampPanel = () => {
    const r = el.getBoundingClientRect();
    const x = Math.max(4, Math.min(r.left, window.innerWidth - r.width - 4));
    const y = Math.max(4, Math.min(r.top, window.innerHeight - r.height - 4));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    return { x, y };
  };
  el.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.exp-head');
    if (!head || e.target.closest('button') || e.button !== 0) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (ev) => {
      el.style.left = (ev.clientX - dx) + 'px';
      el.style.top = (ev.clientY - dy) + 'px';
      el.style.right = 'auto';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      EXP.saveConfig({ exportPanelPos: clampPanel() });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  draw();
  requestAnimationFrame(clampPanel);
}

// Ctrl+Z / Ctrl+Y (and ↶ ↷) while picking: the selection steps back / forward.
function exportSelHistory(cmd) {
  if (!exportPanel) return;
  const h = exportPanel.hist;
  const from = cmd === 'undo' ? h.undo : h.redo;
  const to = cmd === 'undo' ? h.redo : h.undo;
  if (!from.length) return;
  to.push(h.last);
  h.last = from.pop();
  SEL.replace(JSON.parse(h.last));
  SEL.draw();
  exportPanel.draw();
}

function closeExportPanel() {
  if (!exportPanel) return;
  exportPanel.el.remove();
  document.getElementById('exp-banner')?.remove();
  document.body.classList.remove('export-picking');
  exportPanel = null;
}

// While picking: the main screen only selects.
(() => {
  const inPanel = (e) => !!e.target.closest?.('#exp-panel');
  const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  for (const type of ['dragstart', 'contextmenu', 'dblclick', 'auxclick', 'drop']) {
    document.addEventListener(type, (e) => { if (exportPanel && !inPanel(e)) stop(e); }, true);
  }
  document.addEventListener('mousedown', (e) => {
    if (!exportPanel || inPanel(e) || e.button !== 0) return;
    // A category header selects all of its mods (Ctrl: adds them) — on the press, as the
    // columns may be drawn again before the click ends.
    const header = e.target.closest?.(EXP.headerSel);
    if (header) {
      stop(e);
      const cat = EXP.catOfHeader(header);
      if (cat != null) EXP.toggleCategory(cat);
      return;
    }
    // No text fields, no resizers, no buttons outside the panel.
    if (e.target.closest?.('input, select, textarea, button, [class*="resiz"]')) stop(e);
  }, true);
  document.addEventListener('click', (e) => {
    if (!exportPanel || inPanel(e)) return;
    if (e.target.closest?.(EXP.headerSel)) { stop(e); return; } // done on the press
    const card = e.target.closest?.('.mod-card');
    if (card) {
      // Turning on/off and ⬇ are not allowed.
      if (e.target.closest('input, button, .ghost-icon, a')) { stop(e); return; }
      // A plain click adds the mod or takes it out (selections add up while picking).
      stop(e);
      EXP.toggleMod(card);
      return;
    }
    if (e.target.closest?.(EXP.areaSel)) {
      // Empty space in a column / the load-order list clears the selection: fine.
      if (e.target.closest('input, button, select, a')) stop(e);
      return;
    }
    stop(e);
  }, true);
  // The panel follows the selection (and keeps it for undo).
  const follow = () => {
    if (!exportPanel) return;
    requestAnimationFrame(() => {
      if (!exportPanel) return;
      const h = exportPanel.hist;
      const now = exportPanel.snap();
      if (now !== h.last) { h.undo.push(h.last); h.redo.length = 0; h.last = now; }
      exportPanel.draw();
    });
  };
  document.addEventListener('pointerup', follow, true);
  document.addEventListener('keyup', follow, true);
})();

// A list to share: name — link, by category when asked for.
function buildShareList(o) {
  const items = EXP.shareItems(o); // [{ cat (name or null), title, link, on, missing }]
  const d = new Date();
  const lines = [t('exp.shareHeader', { n: items.length, date: d.toLocaleString() }), ''];
  if (o.cats) {
    const cats = [...new Set(items.map((it) => it.cat))];
    for (const c of cats) {
      const list = items.filter((it) => it.cat === c);
      lines.push(`## ${c} (${list.length})`);
      for (const it of list) lines.push(`${it.title} — ${it.link}`);
      lines.push('');
    }
  } else {
    for (const it of items) lines.push(`${it.title} — ${it.link}`);
  }
  return {
    text: lines.join('\n').trim() + '\n',
    mods: items.length,
    on: items.filter((it) => it.on).length,
    cats: o.cats ? new Set(items.map((it) => it.cat)).size : 0,
    missing: items.filter((it) => it.missing).length,
  };
}

// Export: a click exports everything; a long press (half a second) or ▾ opens the panel.
(() => {
  const btn = document.getElementById(EXP.exportBtn);
  let timer = null;
  let long = false;
  const cancel = () => { clearTimeout(timer); btn.classList.remove('pressing'); };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    long = false;
    btn.classList.add('pressing');
    timer = setTimeout(() => { long = true; btn.classList.remove('pressing'); exportAdvancedModal(); }, 500);
  });
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('click', (e) => {
    if (!long) return;
    long = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.getElementById(EXP.moreBtn).addEventListener('click', exportAdvancedModal);
})();

// ===== Settings reset =====
// Everything back to how a first start finds it: the setup screen (game folder,
// language) comes up again. Cached Workshop tags stay; the category layout stays or is
// reset, as chosen. The UI language stays selected on the setup screen.

const LAYOUT_KEYS = ['categories', 'modCategories', 'modOrders', 'uncatPos', 'uncatSort', 'uncatFit', 'pins', 'categoryScheme', 'sortDefault', 'dupActive'];

async function resetAllSettings() {
  const choice = await choiceModal(t('reset.title'), t('reset.text') + (isDirty() ? '\n\n' + t('reset.unsaved') : ''), [
    { key: 'cancel', text: t('modal.cancel') },
    { key: 'all', text: t('reset.withCats') },
    { key: 'keep', text: t('reset.keepCats'), primary: true },
  ]);
  if (choice !== 'all' && choice !== 'keep') { settingsModal(); return; }
  await persistConfig(); // the current layout into config first
  const fresh = { language: config.language, workshopTags: config.workshopTags };
  if (choice === 'keep') for (const k of LAYOUT_KEYS) if (k in config) fresh[k] = config[k];
  await window.api.saveConfig(fresh);
  await window.api.resetWindow(); // view size 100%, menu bar shown, then the page reloads
}

// ===== Category column widths: →← shrink / ⇼ widen =====
// Each column is the width set in Settings, unless it is fitted: "shrink" makes it only as
// wide as its longest mod name needs (never wider than the set width), "expand" as wide as
// needed to show every name in full. A column's own choice is cat.fit (config.uncatFit for
// Uncategorized); otherwise config.autoShrink decides. Not used in the vertical layout.

let fitPreview = null; // { autoShrink, clearExpand } while Settings shows a change

function ownFit(catId) {
  return catId === UNCATEGORIZED ? config?.uncatFit : catById(catId)?.fit;
}

function setOwnFit(catId, fit) {
  if (catId === UNCATEGORIZED) {
    if (fit) config.uncatFit = fit; else delete config.uncatFit;
    return;
  }
  const cat = catById(catId);
  if (!cat) return;
  if (fit) cat.fit = fit; else delete cat.fit;
}

function fitMode(catId) {
  const auto = fitPreview ? fitPreview.autoShrink : !!config?.autoShrink;
  let fit = ownFit(catId);
  if (fit === 'expand' && fitPreview?.clearExpand) fit = undefined;
  return fit === 'shrink' || fit === 'expand' || fit === 'base' ? fit : (auto ? 'shrink' : 'base');
}

function applyFitWidths() {
  const base = columnWidth();
  columnsContainer.querySelectorAll('.category-column').forEach((col) => {
    col.style.minWidth = '';
    col.style.maxWidth = '';
    col.style.width = '';
    const catId = col.dataset.category;
    // A collapsed column is a narrow strip (style.css) in the side-by-side layout.
    const mode = verticalLayout || col.classList.contains('km-collapsed') ? 'base' : fitMode(catId);
    col.querySelector('.km-fit-shrink')?.classList.toggle('on', mode === 'shrink');
    col.querySelector('.km-fit-expand')?.classList.toggle('on', mode === 'expand');
    if (mode === 'base') return;
    // The width the column's content wants (names unshortened).
    col.style.minWidth = '0';
    col.style.maxWidth = 'none';
    col.style.flex = 'none';
    col.style.width = 'max-content';
    const natural = Math.ceil(col.getBoundingClientRect().width) + 2;
    const w = mode === 'shrink' ? Math.min(natural, base) : Math.min(Math.max(natural, base), 1200);
    col.style.width = '';
    col.style.flex = '';
    col.style.minWidth = col.style.maxWidth = w + 'px';
  });
}

function toggleFit(catId, kind) {
  const auto = !!config.autoShrink;
  const mode = fitMode(catId);
  let fit = kind === 'shrink' ? (mode === 'shrink' ? 'base' : 'shrink') : (mode === 'expand' ? undefined : 'expand');
  // The default needs no setting of its own.
  if (fit === (auto ? 'shrink' : 'base')) fit = undefined;
  setOwnFit(catId, fit);
  persistConfig();
  renderColumns();
}

// Icons instead of →← / ⇼: the two glyphs made a button twice as wide, and ⇼ was hard to see.
// Shrink: arrows in to a middle line; widen: arrows out to the two edges.
const FIT_SVG = '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">';
const SHRINK_ICON = FIT_SVG + '<path d="M6 1.5v9M1 6h3.2M2.6 4.2 4.4 6 2.6 7.8M11 6H7.8M9.4 4.2 7.6 6l1.8 1.8"/></svg>';
const EXPAND_ICON = FIT_SVG + '<path d="M1 1.5v9M11 1.5v9M3 6h6M4.8 4.2 3 6l1.8 1.8M7.2 4.2 9 6 7.2 7.8"/></svg>';
// The same kind of line icon for the marks and memos (emoji looked out of place in the app's font).
const KM_ICONS = {
  new: FIT_SVG + '<path d="M6 1.2v2.6M6 8.2v2.6M1.2 6h2.6M8.2 6h2.6M2.7 2.7l1.6 1.6M7.7 7.7l1.6 1.6M9.3 2.7 7.7 4.3M4.3 7.7 2.7 9.3"/></svg>',
  updated: FIT_SVG + '<path d="M10 5.2A4.1 4.1 0 0 0 2.6 3.6M2 6.8a4.1 4.1 0 0 0 7.4 1.6M2.4 1.6v2.2h2.2M9.6 10.4V8.2H7.4"/></svg>',
  tr: FIT_SVG + '<circle cx="6" cy="6" r="4.6"/><path d="M1.4 6h9.2M6 1.4c1.4 1.3 2 2.9 2 4.6s-.6 3.3-2 4.6M6 1.4C4.6 2.7 4 4.3 4 6s.6 3.3 2 4.6"/></svg>',
  memo: FIT_SVG + '<path d="M2.5 1.5h5l2 2v7h-7z"/><path d="M4.2 5.2h3.6M4.2 7.2h3.6M4.2 9.1h2.2"/></svg>',
};

// →← ⇼ in the header (before ⇅); none in the vertical layout.
function headerFitButtons(catId) {
  if (verticalLayout) return [];
  const make = (cls, icon, tip, kind) => {
    const b = document.createElement('span');
    b.className = 'column-move-btn km-fit-btn ' + cls;
    b.innerHTML = icon;
    b.title = t(tip);
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleFit(catId, kind); });
    return b;
  };
  return [make('km-fit-shrink', SHRINK_ICON, 'category.shrinkTip', 'shrink'), make('km-fit-expand', EXPAND_ICON, 'category.expandTip', 'expand')];
}

function headerSpacer() {
  const s = document.createElement('span');
  s.className = 'km-header-spacer';
  return s;
}

// ⇅ sort (with the other header buttons).
function headerSortButton(catId) {
  const sort = document.createElement('span');
  sort.className = 'column-move-btn km-sort-btn km-sort-' + sortState(catId);
  sort.textContent = '⇅';
  sort.title = sortTip(catId);
  sort.addEventListener('click', (e) => { e.stopPropagation(); sortModal(catId); });
  return sort;
}

// ◀ ▶ for Uncategorized (the other columns get theirs in createColumn).
function headerMoveButtons(catId) {
  const ids = orderedCatIds();
  const i = ids.indexOf(catId);
  const make = (text, title, step, disabled) => {
    const b = document.createElement('span');
    b.className = 'column-move-btn' + (disabled ? ' km-disabled' : '');
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); if (!disabled) moveCategoryBy(catId, step); });
    return b;
  };
  return [
    make(verticalLayout ? '▲' : '◀', t(verticalLayout ? 'category.moveUp' : 'category.moveLeft'), -1, i === 0),
    make(verticalLayout ? '▼' : '▶', t(verticalLayout ? 'category.moveDown' : 'category.moveRight'), 1, i === ids.length - 1),
  ];
}

async function renameCategory(catId) {
  const cat = catById(catId);
  if (!cat || catId === UNCATEGORIZED) return;
  const name = await showInputModal(t('category.namePrompt'), cat.name);
  if (name && name.trim()) {
    cat.name = name.trim();
    delete cat.def;
    commitLayout();
  }
}

// Header drag: reorder categories.
let draggingCategory = null;

function makeHeaderDraggable(header, catId) {
  header.draggable = true;
  header.addEventListener('dragstart', (e) => {
    if (e.target !== header) return;
    draggingCategory = catId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-kenshi-category', catId);
    requestAnimationFrame(() => header.closest('.category-column')?.classList.add('km-col-dragging'));
  });
  header.addEventListener('dragend', () => {
    draggingCategory = null;
    clearCategoryDrop();
  });
}

function clearCategoryDrop() {
  document.querySelectorAll('.km-col-dragging, .km-drop-before, .km-drop-after').forEach((c) =>
    c.classList.remove('km-col-dragging', 'km-drop-before', 'km-drop-after'));
}

function categoryDropTarget(e) {
  const col = e.target.closest?.('.category-column');
  if (!col || !columnsContainer.contains(col)) return null;
  const r = col.getBoundingClientRect();
  const after = verticalLayout ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
  return { col, after };
}

// Capture phase, so mod cards don't react while a category is dragged.
columnsContainer.addEventListener('dragover', (e) => {
  if (!draggingCategory) return;
  e.stopPropagation();
  e.preventDefault();
  clearCategoryDrop();
  columnsContainer.querySelector(`.category-column[data-category="${CSS.escape(draggingCategory)}"]`)?.classList.add('km-col-dragging');
  const target = categoryDropTarget(e);
  if (target && target.col.dataset.category !== draggingCategory) target.col.classList.add(target.after ? 'km-drop-after' : 'km-drop-before');
  const cr = columnsContainer.getBoundingClientRect();
  if (e.clientX < cr.left + 60) columnsContainer.scrollLeft -= 18;
  else if (e.clientX > cr.right - 60) columnsContainer.scrollLeft += 18;
}, true);

columnsContainer.addEventListener('drop', (e) => {
  if (!draggingCategory) return;
  e.stopPropagation();
  e.preventDefault();
  const catId = draggingCategory;
  const target = categoryDropTarget(e);
  draggingCategory = null;
  clearCategoryDrop();
  if (!target) return;
  const ids = orderedCatIds();
  let to = ids.indexOf(target.col.dataset.category) + (target.after ? 1 : 0);
  if (ids.indexOf(catId) < to) to--;
  moveCategoryTo(catId, to);
}, true);

// ===== Category layouts (Workshop tags / classic) and auto classify =====
// Default and tag-based categories remember where their name came from (`def`), so the
// name follows the UI language until the user renames them.

const DEFAULT_CAT_KEYS = ['ui', 'animations', 'races', 'animals', 'starts', 'factions', 'buildings', 'armor', 'overhauls', 'patches', 'economy'];
const WS_TAGS = ['GUI', 'Graphical', 'Translation', 'RE_Kenshi', 'Races', 'Characters', 'Factions', 'Buildings',
  'Clothing/Armour', 'Items/Weapons', 'Research', 'Gameplay', 'Cheats', 'Total Overhaul'];
const WS_TAG_KEYS = {
  GUI: 'gui', Graphical: 'graphical', Translation: 'translation', RE_Kenshi: 'rekenshi', Races: 'races', Characters: 'characters',
  Factions: 'factions', Buildings: 'buildings', 'Clothing/Armour': 'armour', 'Items/Weapons': 'weapons', Research: 'research',
  Gameplay: 'gameplay', Cheats: 'cheats', 'Total Overhaul': 'overhaul',
};
const SCHEMES = ['tags', 'classic', 'empty'];

// Classic categories: Workshop tags that belong there, and name keywords (weaker).
const CLASSIC_RULES = {
  ui: { tags: ['GUI', 'Graphical'], re: /\bui\b|interface|hud|graphic|texture|shader|lighting|performance|fps|reshade/i },
  animations: { tags: [], re: /anim/i },
  races: { tags: ['Races'], re: /\brace|shek|hive|skeleton|greenlander|scorchlander/i },
  animals: { tags: [], re: /animal|garru|goat|beak|bonedog|leviathan|beast|pet\b|crab/i },
  starts: { tags: [], re: /\bstart/i },
  factions: { tags: ['Factions', 'Characters'], re: /faction|recruit|squad|npc/i },
  buildings: { tags: ['Buildings'], re: /building|house|outpost|wall|furniture|storage|bed\b|tent/i },
  armor: { tags: ['Clothing/Armour', 'Items/Weapons'], re: /armou?r|weapon|sword|blade|bow\b|backpack|cloth|helmet|katana/i },
  overhauls: { tags: ['Total Overhaul'], re: /overhaul|world|reactive/i },
  patches: { tags: ['Translation'], re: /patch|fix|compat|korean|_ko\b|translation/i },
  economy: { tags: [], re: /econom|trade|trader|price|shop|vendor|money|cats?\b/i },
};

function schemeItems(scheme) {
  if (scheme === 'tags') return WS_TAGS.map((tag) => ({ def: 'tag:' + tag }));
  if (scheme === 'classic') return DEFAULT_CAT_KEYS.map((key) => ({ def: key }));
  return [];
}

function otherScheme(scheme) {
  return scheme === 'tags' ? 'classic' : scheme === 'classic' ? 'tags' : null;
}

function defName(def) {
  return def.startsWith('tag:') ? t('wsTag.' + WS_TAG_KEYS[def.slice(4)]) : t('defcat.' + def);
}

// Give default / tag categories their name in the current language (call after a language
// change). Old configs: a category still called by an English default name gets its key.
function localizeCategoryNames() {
  for (const cat of categories) {
    if (!cat.def) {
      const i = DEFAULT_CATEGORIES.findIndex((d) => d.name === cat.name);
      if (i >= 0 && DEFAULT_CAT_KEYS[i]) cat.def = DEFAULT_CAT_KEYS[i];
    }
    if (cat.def) cat.name = defName(cat.def);
  }
}

// Workshop id of a Steam mod: its folder name.
function workshopIdOf(mod) {
  if (mod.source !== 'steam') return null;
  const parts = mod.filePath.replace(/\\/g, '/').split('/');
  const id = parts[parts.length - 2];
  return /^\d+$/.test(id) ? id : null;
}

async function loadWorkshopTags(modsList) {
  const cache = (config.workshopTags ||= {});
  const want = [...new Set(modsList.map(workshopIdOf).filter((id) => id && !cache[id]))];
  for (let i = 0; i < want.length; i += 100) {
    busyText(t('scheme.fetchingTags', { n: i, total: want.length }));
    const res = await window.api.fetchWorkshopDetails(want.slice(i, i + 100));
    for (const [id, d] of Object.entries(res || {})) cache[id] = d.tags || [];
  }
}

function modTags(mod) {
  const id = workshopIdOf(mod);
  return id ? (config.workshopTags?.[id] || []) : [];
}

function modMatches(mod, cat, weak = false) {
  if (!cat?.def) return false;
  const tags = modTags(mod);
  if (cat.def.startsWith('tag:')) return tags.includes(cat.def.slice(4));
  const rule = CLASSIC_RULES[cat.def];
  if (!rule) return false;
  if (rule.tags.some((tag) => tags.includes(tag))) return true;
  return weak && rule.re.test(mod.displayName);
}

// Columns are tried left to right, so the ones further left fill first.
function classifyTarget(mod) {
  const cats = orderedCatIds().filter((id) => id !== UNCATEGORIZED).map(catById);
  return (cats.find((c) => modMatches(mod, c)) || cats.find((c) => modMatches(mod, c, true)))?.id || null;
}

// Files the Uncategorized mods. Returns how many moved.
async function autoClassify({ quiet = false } = {}) {
  const uncat = getModsForCategory(UNCATEGORIZED);
  if (!uncat.length) {
    if (!quiet) setStatus(t('scheme.noneLeft'));
    return 0;
  }
  await loadWorkshopTags(uncat);
  syncModCategories();
  let moved = 0;
  for (const mod of uncat) {
    const target = classifyTarget(mod);
    if (target) { moveMod(mod, target, null, true); moved++; }
  }
  persistConfig();
  if (!quiet) setStatus(t('scheme.classified', { count: moved, left: uncat.length - moved }), 'success');
  return moved;
}

function runAutoClassify() {
  return withBusy(t('busy.classify'), async () => {
    await autoClassify();
    commitLayout();
  });
}

function newCategory(item, order) {
  const def = item.def;
  const color = def && !def.startsWith('tag:') ? DEFAULT_CATEGORIES[DEFAULT_CAT_KEYS.indexOf(def)]?.color : null;
  return { id: generateId(), name: item.name || defName(def), ...(def ? { def } : {}), color: color || randomColor(), order };
}

// Rebuild all categories from the edited list. With keepOrder the actual load order stays
// as it is (📌 where the new columns disagree), otherwise it follows them.
async function applyScheme(scheme, items, { auto = true, hideEmpty = true, keepOrder = true } = {}) {
  await withBusy(t('busy.building'), async () => {
    const prev = [...actualOrder];
    for (const mod of mods) mod.category = UNCATEGORIZED;
    categories = items.map((it, i) => newCategory(it, i));
    modCategories = {};
    modOrders = { [UNCATEGORIZED]: [...prev, ...mods.map((m) => m.filename).filter((f) => !prev.includes(f))] };
    config.uncatPos = 0;
    config.categoryScheme = scheme;
    delete config.sortDefault;
    delete config.uncatSort;
    syncModCategories();
    if (auto) {
      await autoClassify({ quiet: true });
      if (hideEmpty) {
        const used = new Set(mods.map((m) => m.category));
        categories = categories.filter((c) => used.has(c.id) || !c.def);
        categories.forEach((c, i) => { c.order = i; });
      }
    }
    syncModCategories();
    if (keepOrder) adoptOrder(prev, false);
    else {
      pins.clear();
      rebuildOrder(prev);
    }
    // The order is settled: the classified mods are not "moved" for the next render.
    justMovedMods.clear();
    persistConfig();
    renderColumns();
    setStatus(t('scheme.done', { cats: categories.length }), 'success');
  });
}

// Add the other set after the existing columns and file the Uncategorized mods into it.
async function addSchemeCategories(scheme) {
  const have = new Set(categories.map((c) => c.def).filter(Boolean));
  const items = schemeItems(scheme).filter((it) => !have.has(it.def));
  if (!items.length) return;
  await withBusy(t('busy.building'), async () => {
    let order = categories.length;
    for (const it of items) categories.push(newCategory(it, order++));
    await autoClassify({ quiet: true });
    const used = new Set(mods.map((m) => m.category));
    categories = categories.filter((c) => used.has(c.id) || !items.some((it) => it.def === c.def));
    categories.sort((a, b) => a.order - b.order).forEach((c, i) => { c.order = i; });
    commitLayout();
    setStatus(t('scheme.added', { count: items.length }), 'success');
  });
}

function itemName(it) {
  return it.name || defName(it.def);
}

function itemKind(it) {
  if (!it.def) return t('scheme.kind.own');
  return it.def.startsWith('tag:') ? 'Workshop' : t('scheme.kind.classic');
}

// Choose a starting set, then edit the list of columns to create (order = load order and
// auto classify priority): move, move to top, delete, add from either set or by name.
function schemeModal() {
  let scheme = SCHEMES.includes(config.categoryScheme) ? config.categoryScheme : 'classic';
  let items = schemeItems(scheme);
  let auto = scheme !== 'empty';
  let hideEmpty = true;
  let keepOrder = true;
  let newName = '';
  const { box, close } = openWideModal('km-scheme');

  const draw = () => {
    const listScroll = box.querySelector('.se-list')?.scrollTop ?? 0;
    const inList = new Set(items.map((it) => it.def).filter(Boolean));
    const group = (label, list) => {
      const free = list.filter((it) => !inList.has(it.def));
      return free.length ? `<optgroup label="${escapeText(label)}">${free.map((it) => `<option value="${escapeText(it.def)}">${escapeText(itemName(it))}</option>`).join('')}</optgroup>` : '';
    };
    const options = group(t('scheme.tags'), schemeItems('tags')) + group(t('scheme.classic'), schemeItems('classic'));
    const other = otherScheme(scheme);
    box.innerHTML = `<div class="modal-title">${escapeText(t('scheme.resetTitle'))}</div>
      <p class="km-desc">${escapeText(t('scheme.resetDesc'))}</p>
      <div class="km-scheme-options">${SCHEMES.map((s) => `
        <label class="km-scheme-option${s === scheme ? ' on' : ''}">
          <input type="radio" name="km-scheme" value="${s}" ${s === scheme ? 'checked' : ''}>
          <span><b>${escapeText(t('scheme.' + s))}</b><br><span class="km-muted">${escapeText(t('scheme.' + s + 'Desc'))}</span></span>
        </label>`).join('')}
      </div>
      <div class="km-editor">
        <div class="se-head">
          <b>${escapeText(t('scheme.listTitle', { n: items.length }))}</b>
          <span class="km-muted">${escapeText(t('scheme.listNote'))}</span>
          <span class="se-head-btns">
            ${other ? `<button type="button" class="btn btn-subbar" data-se="add-other">${escapeText(t('scheme.addAll.' + other))}</button>` : ''}
            <button type="button" class="btn btn-subbar" data-se="restore">${escapeText(t('scheme.restore'))}</button>
            <button type="button" class="btn btn-subbar" data-se="clear">${escapeText(t('scheme.clearList'))}</button>
          </span>
        </div>
        <div class="se-list">
          <div class="se-row se-fixed"><span class="se-num"></span><span class="se-name">${escapeText(uncatName())}</span><span class="km-muted se-kind">${escapeText(t('scheme.fixed'))}</span></div>
          ${items.map((it, i) => `<div class="se-row" data-i="${i}">
            <span class="se-num">${i + 1}</span>
            <span class="se-name">${escapeText(itemName(it))}</span>
            <span class="km-muted se-kind">${escapeText(itemKind(it))}</span>
            <button type="button" class="column-move-btn" data-mv="top" title="${escapeText(t('scheme.toTop'))}" ${i ? '' : 'disabled'}>⤒</button>
            <button type="button" class="column-move-btn" data-mv="-1" ${i ? '' : 'disabled'}>▲</button>
            <button type="button" class="column-move-btn" data-mv="1" ${i < items.length - 1 ? '' : 'disabled'}>▼</button>
            <button type="button" class="column-move-btn" data-mv="bottom" title="${escapeText(t('scheme.toBottom'))}" ${i < items.length - 1 ? '' : 'disabled'}>⤓</button>
            <button type="button" class="column-move-btn column-delete-btn" data-mv="del" title="${escapeText(t('scheme.remove'))}">✕</button>
          </div>`).join('')}
          ${items.length ? '' : `<div class="se-empty km-muted">${escapeText(t('scheme.listEmpty'))}</div>`}
        </div>
        <div class="se-add">
          <select id="se-pick" ${options ? '' : 'disabled'}>${options || `<option>${escapeText(t('scheme.nothingLeft'))}</option>`}</select>
          <button type="button" class="btn btn-subbar" data-se="add-pick" ${options ? '' : 'disabled'}>${escapeText(t('scheme.addPick'))}</button>
          <input type="text" id="se-new" class="modal-input" placeholder="${escapeText(t('scheme.newPlaceholder'))}" value="${escapeText(newName)}">
          <button type="button" class="btn btn-subbar" data-se="add-new">${escapeText(t('scheme.addNew'))}</button>
        </div>
      </div>
      <div class="km-checks">
        <label title="${escapeText(t('scheme.autoTip'))}"><input type="checkbox" id="km-auto" ${auto ? 'checked' : ''}> ${escapeText(t('scheme.auto'))}</label>
        <label><input type="checkbox" id="km-hide" ${hideEmpty ? 'checked' : ''} ${auto ? '' : 'disabled'}> ${escapeText(t('scheme.hideEmpty'))}</label>
        <label title="${escapeText(t('scheme.keepOrderTip'))}"><input type="checkbox" id="km-keep" ${keepOrder ? 'checked' : ''}> ${escapeText(t('scheme.keepOrder'))}</label>
      </div>
      <div class="modal-buttons"><button class="btn" data-r="cancel">${escapeText(t('modal.cancel'))}</button><button class="btn btn-primary" data-r="ok">${escapeText(t('scheme.create'))}</button></div>`;
    box.querySelector('.se-list').scrollTop = listScroll;
    box.querySelector('#se-new').oninput = (e) => { newName = e.target.value; };
    box.querySelector('#se-new').onkeydown = (e) => { if (e.key === 'Enter') addNew(); };
  };

  const addNew = () => {
    const name = newName.trim();
    if (!name) return;
    items.push({ name });
    newName = '';
    draw();
    box.querySelector('.se-list').scrollTop = 1e9;
    box.querySelector('#se-new').focus();
  };

  box.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const row = el.closest('.se-row');
    if (el.dataset.r === 'cancel') return close();
    if (el.dataset.r === 'ok') {
      close();
      applyScheme(scheme, items, { auto, hideEmpty, keepOrder });
      return;
    }
    if (row && el.dataset.mv) {
      const i = +row.dataset.i;
      const [it] = items.splice(i, 1);
      const mv = el.dataset.mv;
      if (mv === 'top') items.unshift(it);
      else if (mv === 'bottom') items.push(it);
      else if (mv !== 'del') items.splice(Math.max(0, Math.min(items.length, i + +mv)), 0, it);
    } else if (el.dataset.se === 'add-pick') items.push({ def: box.querySelector('#se-pick').value });
    else if (el.dataset.se === 'add-new') return addNew();
    else if (el.dataset.se === 'add-other') {
      const have = new Set(items.map((it) => it.def));
      items.push(...schemeItems(otherScheme(scheme)).filter((it) => !have.has(it.def)));
    } else if (el.dataset.se === 'restore') items = schemeItems(scheme);
    else if (el.dataset.se === 'clear') items = [];
    else return;
    draw();
  });
  box.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'km-scheme') {
      scheme = el.value;
      items = schemeItems(scheme);
      auto = scheme !== 'empty';
    } else if (el.id === 'km-auto') auto = el.checked;
    else if (el.id === 'km-hide') hideEmpty = el.checked;
    else if (el.id === 'km-keep') keepOrder = el.checked;
    else return;
    draw();
  });
  draw();
}

// The old "Reset Categories" button now opens the layout dialog.
(() => {
  const old = document.getElementById('reset-categories-btn');
  const btn = old.cloneNode(true);
  old.replaceWith(btn);
  btn.addEventListener('click', () => { if (!dialogOpen()) schemeModal(); });
})();
document.getElementById('auto-classify-btn').addEventListener('click', () => { if (!dialogOpen()) runAutoClassify(); });

// ===== Settings (⚙): folders, view, category layout =====

const DEFAULT_COLUMN_WIDTH = 300;

function columnWidth() {
  return Number(config?.columnWidth) || DEFAULT_COLUMN_WIDTH;
}

function applyColumnWidth() {
  document.documentElement.style.setProperty('--km-col-width', columnWidth() + 'px');
}

// Wheel speed for scrolling inside a category list (up/down); the left/right speed is
// app.js's columnScrollSpeed.
const DEFAULT_COLUMN_SCROLL_SPEED_V = 1;
let columnScrollSpeedV = DEFAULT_COLUMN_SCROLL_SPEED_V;

// Settings work on a draft: the view sliders show their effect at once, but nothing is
// kept until Save. Closing with unsaved changes asks first.
function settingsModal() {
  const current = () => ({
    lang: currentLocale,
    gamePath: config.gamePath || '',
    steamModsPath: config.steamModsPath || '',
    mapZoom: mapZoomSpeed,
    scrollV: columnScrollSpeedV,
    scrollH: columnScrollSpeed,
    width: columnWidth(),
    autoShrink: !!config.autoShrink,
    subAuto: !!config.subAuto,
    subGap: config.subGap ?? SQ_DEFAULT_GAP,
    subGapByCount: config.subGapByCount !== false,
    autoPreset: !!config.autoPreset,
    clearExpand: false,
  });
  let saved = current();
  const draft = { ...saved };
  let detectStatus = { text: '', kind: '' };
  const { box, close } = openWideModal('km-settings', () => requestClose());
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(saved);

  // Preview the view settings while the dialog is open.
  const preview = (v) => {
    mapZoomSpeed = v.mapZoom;
    columnScrollSpeed = v.scrollH;
    columnScrollSpeedV = v.scrollV;
    document.documentElement.style.setProperty('--km-col-width', v.width + 'px');
    fitPreview = { autoShrink: v.autoShrink, clearExpand: v.clearExpand };
    applyFitWidths();
  };

  const slider = (key, label, min, max, step, fmt) => `<div class="setting-row"><label>${escapeText(label)}</label>
    <input type="range" data-s="${key}" min="${min}" max="${max}" step="${step}" value="${draft[key]}"><span class="setting-value" data-v="${key}">${fmt(draft[key])}</span></div>`;
  const fmt = { mapZoom: (v) => Number(v).toFixed(2), scrollV: (v) => Number(v).toFixed(2) + '×', scrollH: (v) => Number(v).toFixed(2) + '×', width: (v) => v + 'px' };

  const draw = () => {
    const scheme = config.categoryScheme || 'classic';
    const langOptions = Object.entries(SUPPORTED_LOCALES).map(([code, name]) => `<option value="${code}" ${code === draft.lang ? 'selected' : ''}>${escapeText(name)}</option>`).join('');
    box.innerHTML = `<div class="modal-title km-settings-title"><span class="km-gear">⚙</span> ${escapeText(t('settings.title'))}</div>
      <div class="km-settings-body">
      <div class="km-settings-section">
        <div class="km-subtitle">${escapeText(t('settings.language'))}</div>
        <select id="km-lang" class="modal-input km-narrow">${langOptions}</select>
      </div>
      <div class="km-settings-section">
        <div class="km-subtitle">${escapeText(t('settings.folders'))}</div>
        <p class="km-desc">${escapeText(t('setup.description'))}</p>
        <div class="km-detect">
          <button class="btn btn-primary" data-r="detect">${escapeText(t('setup.autoDetect'))}</button>
          <span class="auto-detect-status ${detectStatus.kind}">${escapeText(detectStatus.text)}</span>
        </div>
        <div class="km-field">
          <label>${escapeText(t('setup.gamePath'))} <span class="required">*</span></label>
          <div class="path-picker">
            <input type="text" readonly class="km-path-input" value="${escapeText(draft.gamePath)}" placeholder="${escapeText(t('setup.gamePathPlaceholder'))}">
            <button class="btn" data-r="pick-game">${escapeText(t('setup.browse'))}</button>
          </div>
          <small>${escapeText(t('setup.gamePathHelp'))}</small>
        </div>
        <div class="km-field">
          <label>${escapeText(t('setup.steamPath'))} <span class="optional">${escapeText(t('setup.steamPathOptional'))}</span></label>
          <div class="path-picker">
            <input type="text" readonly class="km-path-input" value="${escapeText(draft.steamModsPath)}" placeholder="${escapeText(t('setup.steamPathPlaceholder'))}">
            <button class="btn" data-r="pick-steam">${escapeText(t('setup.browse'))}</button>
            <button class="btn" data-r="clear-steam">${escapeText(t('setup.clear'))}</button>
          </div>
          <small>${escapeText(t('setup.steamPathHelp'))}</small>
        </div>
      </div>
      <div class="km-settings-section">
        <div class="km-subtitle">${escapeText(t('settings.view'))}</div>
        ${slider('mapZoom', t('settings.mapZoomSpeed'), 0.05, 0.4, 0.05, fmt.mapZoom)}
        ${slider('scrollV', t('settings.scrollSpeedV'), 0.25, 4, 0.25, fmt.scrollV)}
        ${slider('scrollH', t('settings.scrollSpeedH'), 0.25, 4, 0.25, fmt.scrollH)}
        ${slider('width', t('settings.columnWidth'), 200, 520, 10, fmt.width)}
        <label class="km-setting-check"><input type="checkbox" id="km-auto-shrink" ${draft.autoShrink ? 'checked' : ''}> ${escapeText(t('settings.autoShrink'))}</label>
        <div class="km-muted km-setting-note">${escapeText(t('settings.autoShrinkNote'))}</div>
        <button class="btn btn-subbar" data-r="view-reset">${escapeText(t('settings.reset'))}</button>
      </div>
      <div class="km-settings-section">
        <div class="km-subtitle">${escapeText(t('packs.title'))}</div>
        <label class="km-setting-check"><input type="checkbox" id="km-auto-preset" ${draft.autoPreset ? 'checked' : ''}> ${escapeText(t('autoPack.setting', { n: AUTO_PACK_KEEP }))}</label>
        <div class="km-muted km-setting-note">${escapeText(t('autoPack.settingNote'))}</div>
      </div>
      <div class="km-settings-section">
        <div class="km-subtitle">${escapeText(t('keys.title'))}</div>
        <p class="km-desc">${escapeText(t('keys.settingsDesc'))}</p>
        <button class="btn btn-subbar" data-r="shortcuts">⌨ ${escapeText(t('menu.shortcuts'))}</button>
      </div>
      <div class="km-settings-section">
        <div class="km-subtitle">${escapeText(t('sq.settings'))}</div>
        <label class="km-setting-check"><input type="checkbox" id="km-sub-auto" ${draft.subAuto ? 'checked' : ''}> ${escapeText(t('sq.autoSetting'))}</label>
        <div class="km-muted km-setting-note">${escapeText(t('sq.autoSettingNoteKenshi'))}</div>
        <div class="setting-row"><label>${escapeText(t('sq.gapSetting'))}</label><input type="number" class="modal-input sq-gap-input" id="km-sub-gap" min="0" max="120" step="0.5" value="${draft.subGap}"></div>
        <label class="km-setting-check"><input type="checkbox" id="km-sub-gap-count" ${draft.subGapByCount ? 'checked' : ''}> ${escapeText(t('sq.gapByCount'))}</label>
        <div class="km-muted km-setting-note">${escapeText(t('sq.gapNote'))}</div>
      </div>
      <div class="km-settings-section">
        <div class="km-subtitle">${escapeText(t('settings.layout'))}</div>
        <div class="km-muted">${escapeText(t('settings.layoutCurrent', { name: t('scheme.' + scheme) }))}</div>
        <div class="km-spec-actions" style="padding-left:0">
          ${otherScheme(scheme) ? `<button class="btn btn-subbar" data-r="add-other">${escapeText(t('settings.addOther.' + otherScheme(scheme)))}</button>` : ''}
          <button class="btn btn-subbar" data-r="classify">${escapeText(t('toolbar.autoClassify'))}</button>
          <button class="btn btn-subbar btn-danger-subtle" data-r="reset-cats">${escapeText(t('settings.resetLayout'))}</button>
        </div>
      </div>
      </div>
      <div class="modal-buttons">
        <button class="btn btn-danger-subtle" data-r="reset-settings" title="${escapeText(t('reset.tip'))}">${escapeText(t('reset.button'))}</button>
        <span class="km-settings-state">${dirty() ? escapeText(t('settings.unsaved')) : ''}</span>
        <button class="btn" data-r="close">${escapeText(t('settings.close'))}</button>
        <button class="btn btn-primary" data-r="save" ${dirty() && draft.gamePath ? '' : 'disabled'}>${escapeText(t('settings.save'))}</button>
      </div>`;
  };

  const refreshFooter = () => {
    box.querySelector('.km-settings-state').textContent = dirty() ? t('settings.unsaved') : '';
    box.querySelector('[data-r="save"]').disabled = !(dirty() && draft.gamePath);
  };

  const save = async () => {
    if (!draft.gamePath) return false;
    // A shorter wait between Workshop pages than before (and than the default) asks first.
    if (draft.subGap < saved.subGap && draft.subGap < SQ_DEFAULT_GAP) {
      const choice = await choiceModal(t('sq.gapLowTitle'), t('sq.gapLowText', { s: draft.subGap, d: SQ_DEFAULT_GAP }), [
        { key: 'cancel', text: t('modal.cancel') },
        { key: 'ok', text: t('sq.gapLowOk'), primary: true },
      ]);
      if (choice !== 'ok') return false;
    }
    const foldersChanged = draft.gamePath !== saved.gamePath || draft.steamModsPath !== saved.steamModsPath;
    const langChanged = draft.lang !== saved.lang;
    mapZoomSpeed = draft.mapZoom;
    columnScrollSpeed = draft.scrollH;
    columnScrollSpeedV = draft.scrollV;
    Object.assign(config, {
      mapZoomSpeed: draft.mapZoom, columnScrollSpeed: draft.scrollH, columnScrollSpeedV: draft.scrollV,
      columnWidth: draft.width, gamePath: draft.gamePath, steamModsPath: draft.steamModsPath,
      autoShrink: draft.autoShrink,
      subAuto: draft.subAuto,
      subGap: draft.subGap,
      subGapByCount: draft.subGapByCount,
      autoPreset: draft.autoPreset,
    });
    if (draft.clearExpand) {
      for (const cat of categories) if (cat.fit === 'expand') delete cat.fit;
      if (config.uncatFit === 'expand') delete config.uncatFit;
    }
    fitPreview = null;
    renderColumns();
    applyColumnWidth();
    await persistConfig();
    if (langChanged) await changeLanguage(draft.lang);
    if (foldersChanged) loadMods();
    saved = current();
    Object.assign(draft, saved);
    setStatus(t('settings.saved'), 'success');
    return true;
  };

  // Close (button, Esc): unsaved changes are saved, thrown away or kept open.
  const requestClose = async (then) => {
    if (dirty()) {
      const choice = await choiceModal(t('settings.unsavedTitle'), t('settings.unsavedText'), [
        { key: 'cancel', text: t('modal.cancel') },
        { key: 'discard', text: t('unsaved.discard') },
        { key: 'save', text: t('settings.saveClose'), primary: true },
      ]);
      if (!choice || choice === 'cancel') return;
      if (choice === 'save' && !(await save())) return;
      if (choice === 'discard') { preview(saved); fitPreview = null; applyFitWidths(); }
    }
    close();
    if (then) then();
  };

  box.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.s) return;
    draft[el.dataset.s] = parseFloat(el.value);
    box.querySelector(`[data-v="${el.dataset.s}"]`).textContent = fmt[el.dataset.s](draft[el.dataset.s]);
    preview(draft);
    refreshFooter();
  });
  box.addEventListener('change', (e) => {
    if (e.target.id === 'km-lang') { draft.lang = e.target.value; refreshFooter(); }
    if (e.target.id === 'km-sub-auto') { draft.subAuto = e.target.checked; refreshFooter(); }
    if (e.target.id === 'km-auto-preset') { draft.autoPreset = e.target.checked; refreshFooter(); }
    if (e.target.id === 'km-sub-gap-count') { draft.subGapByCount = e.target.checked; refreshFooter(); }
    if (e.target.id === 'km-sub-gap') {
      const v = Math.min(120, Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 2) / 2));
      e.target.value = v;
      draft.subGap = v;
      refreshFooter();
    }
    if (e.target.id === 'km-auto-shrink') { draft.autoShrink = e.target.checked; preview(draft); refreshFooter(); }
  });
  box.addEventListener('click', async (e) => {
    const r = e.target.closest('button')?.dataset.r;
    if (!r) return;
    if (r === 'close') requestClose();
    else if (r === 'save') { await save(); draw(); }
    else if (r === 'detect') {
      detectStatus = { text: t('detect.searching'), kind: '' };
      draw();
      try {
        const result = await window.api.detectSteam();
        if (result && result.gamePath) {
          draft.gamePath = result.gamePath;
          if (result.steamModsPath) draft.steamModsPath = result.steamModsPath;
          detectStatus = { text: t('detect.found', { source: result.steamModsPath ? t('detect.sourceSteam') : t('detect.sourceGog') }), kind: 'success' };
        } else detectStatus = { text: t('detect.notFound'), kind: 'error' };
      } catch {
        detectStatus = { text: t('detect.failed'), kind: 'error' };
      }
      draw();
    } else if (r === 'pick-game' || r === 'pick-steam') {
      const folder = await window.api.pickFolder();
      if (folder) draft[r === 'pick-game' ? 'gamePath' : 'steamModsPath'] = folder;
      draw();
    } else if (r === 'clear-steam') { draft.steamModsPath = ''; draw(); }
    else if (r === 'view-reset') {
      Object.assign(draft, { mapZoom: DEFAULT_MAP_ZOOM_SPEED, scrollH: DEFAULT_COLUMN_SCROLL_SPEED, scrollV: DEFAULT_COLUMN_SCROLL_SPEED_V, width: DEFAULT_COLUMN_WIDTH, autoShrink: false, clearExpand: true });
      preview(draft);
      draw();
    } else if (r === 'add-other') requestClose(() => addSchemeCategories(otherScheme(config.categoryScheme || 'classic')));
    else if (r === 'classify') requestClose(runAutoClassify);
    else if (r === 'reset-cats') requestClose(schemeModal);
    else if (r === 'reset-settings') { fitPreview = null; close(); resetAllSettings(); }
    else if (r === 'shortcuts') requestClose(shortcutsModal);
  });
  draw();
}

document.getElementById('km-settings-btn').addEventListener('click', () => { if (!dialogOpen()) settingsModal(); });

// ===== Double-click: go to the same mod in the other list =====
// In the load order panel it goes to the mod's card in its category; in a category it
// goes to the mod in the load order panel.

function flashCard(el) {
  if (!el) return;
  el.classList.remove('km-flash');
  void el.offsetWidth;
  el.classList.add('km-flash');
  setTimeout(() => el.classList.remove('km-flash'), 1300);
}

function jumpFromOrder(mod) {
  jumpToMod(mod);
  requestAnimationFrame(() => requestAnimationFrame(() => flashCard(columnsContainer.querySelector(
    `.category-column[data-category="${CSS.escape(mod.category)}"] .mod-card[data-filename="${CSS.escape(mod.filename)}"]`))));
}

// A click can re-draw the lists, so the browser's own dblclick never fires (its two
// clicks land on different elements). Two plain clicks on the same mod in the same list
// within DOUBLE_CLICK_MS count as a double-click.
const DOUBLE_CLICK_MS = 450;
let lastModClick = null;

document.addEventListener('click', (e) => {
  const card = e.target.closest?.('.mod-card');
  const area = card && (orderList.contains(card) ? 'order' : columnsContainer.contains(card) ? 'cat' : null);
  if (!area || e.target.matches('input') || e.target.closest('.column-header') || e.ctrlKey || e.shiftKey || e.metaKey) {
    lastModClick = null;
    return;
  }
  const key = area + '|' + card.dataset.filename;
  const now = Date.now();
  if (lastModClick && lastModClick.key === key && now - lastModClick.time < DOUBLE_CLICK_MS) {
    lastModClick = null;
    const mod = modByFile(card.dataset.filename);
    // After the click's own selection and re-render.
    if (mod) setTimeout(() => (area === 'order' ? jumpFromOrder(mod) : jumpFromCategory(mod)));
    return;
  }
  lastModClick = { key, time: now };
}, true);

function jumpFromCategory(mod) {
  const orderCard = orderList.querySelector(`.mod-card[data-filename="${CSS.escape(mod.filename)}"]`);
  if (!orderCard) {
    setStatus(t('order.notInOrder', { name: mod.displayName }), 'warning');
    return;
  }
  editFocus = { area: 'order' };
  showEditFocus();
  orderCard.scrollIntoView({ block: 'center' });
  flashCard(orderCard);
}

// ===== Detail panel width follows the window =====
// The panel's width is for a 1280px-wide window (the start size); a wider window widens
// it, up to twice that at 1920px. Dragging the divider sets a new width at this size.

let detailBaseWidth = 280;

function detailScale() {
  return 1 + Math.max(0, Math.min(1, (window.innerWidth - 1280) / 640));
}

function fitDetailWidth() {
  const room = window.innerWidth - orderPanel.offsetWidth - document.getElementById('km-cat-nav').offsetWidth - 360; // keep space for the columns
  detailPanel.style.width = Math.max(100, Math.min(Math.round(detailBaseWidth * detailScale()), room)) + 'px';
}

window.addEventListener('resize', fitDetailWidth);
(() => {
  const handle = document.getElementById('panel-resize-handle');
  let dragging = false;
  handle.addEventListener('mousedown', () => { dragging = true; });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    detailBaseWidth = detailPanel.offsetWidth / detailScale();
  });
})();

// ===== Detail panel: name → Steam page, file → FCS, copy icons =====

// A click that ends a text selection (for Ctrl+C) isn't a link click.
function plainClick() {
  return !window.getSelection()?.toString();
}

function copyToClipboard(text) {
  window.api.copyText(text).then(() => setStatus(t('detail.copied', { text }), 'success'));
}

function updateDetailLinks(mod, f) {
  const nameEl = document.getElementById('detail-name');
  nameEl.classList.toggle('km-link', !!f.steamUrl);
  nameEl.title = f.steamUrl ? t('detail.nameLinkTip') : '';
  nameEl.onclick = f.steamUrl ? () => { if (plainClick()) window.api.openExternal(f.steamUrl); } : null;

  const pathEl = document.getElementById('detail-path');
  pathEl.classList.add('km-link');
  pathEl.title = t('detail.fcsTip');
  pathEl.onclick = async () => {
    if (!plainClick()) return;
    const r = await window.api.openInFcs(config.gamePath, mod.filePath);
    if (r === 'ok') setStatus(t('detail.fcsOpened', { name: mod.displayName }), 'success');
    else setStatus(t(r === 'no-file' ? 'detail.fileNotFound' : 'detail.fcsNotFound'), 'error');
  };
}

function copyIcon(tip) {
  return `<span class="km-copy-icon" title="${escapeText(tip)}">📋</span>`;
}

// ===== Category list (opens and closes, right of the load order) =====
// Click a category to scroll to its column.

const catNav = document.getElementById('km-cat-nav');
const catNavList = document.getElementById('km-cat-nav-list');
const catNavToggle = document.getElementById('km-cat-nav-toggle');

function renderCatNav() {
  const open = !!config?.catNavOpen;
  catNav.classList.toggle('collapsed', !open);
  catNavToggle.innerHTML = `<span class="km-cat-nav-arrow">${open ? '◂' : '▸'}</span> <span>${escapeText(t('catNav.title'))}</span>`;
  catNavToggle.title = t(open ? 'catNav.close' : 'catNav.open');
  if (!open) { catNavList.replaceChildren(); return; }
  const scroll = catNavList.scrollTop;
  catNavList.replaceChildren(...orderedCatIds().map((id) => {
    const cat = catById(id);
    const files = catFiles(id);
    const on = files.filter((f) => modByFile(f)?.active).length;
    const item = document.createElement('div');
    item.className = 'km-cat-nav-item' + (editFocus?.area === 'cat' && editFocus.cat === id ? ' current' : '');
    item.dataset.cat = id;
    item.style.setProperty('--cat-color', cat.color);
    item.title = t('catNav.jumpTip');
    item.innerHTML = `<span class="km-cat-nav-dot"></span><span class="km-cat-nav-name">${escapeText(cat.name)}</span><span class="km-cat-nav-count">${on}/${files.length}</span>`;
    return item;
  }));
  catNavList.scrollTop = scroll;
}

function jumpToCategory(catId) {
  const col = columnsContainer.querySelector(`.category-column[data-category="${CSS.escape(catId)}"]`);
  if (!col) return;
  editFocus = { area: 'cat', cat: catId };
  showEditFocus();
  col.scrollIntoView({ block: 'nearest', inline: 'start' });
  flashCard(col.querySelector('.column-header') || col);
  catNavList.querySelectorAll('.km-cat-nav-item').forEach((el) => el.classList.toggle('current', el.dataset.cat === catId));
}

catNavToggle.addEventListener('click', () => {
  config.catNavOpen = !config.catNavOpen;
  persistConfig();
  renderCatNav();
  fitDetailWidth();
});
catNavList.addEventListener('click', (e) => {
  const item = e.target.closest('.km-cat-nav-item');
  if (item) jumpToCategory(item.dataset.cat);
});

// ===== Marks: 🆕 new mods, ⟳ updated mods, 🌐 translations to check =====
// config.seenMods: the mod keys seen before (one not there is new until clicked). config.modStamps:
// key -> [mtime, size] of its .mod file when last looked at (another one = updated: a Workshop
// update, an edit). config.trSeen: translation patch key -> its original's mtime when last looked at.
// A translation patch is <mod>_<CODE>.mod (the translator, lib/kmt): its original changed after it
// was made = the translation may be out of date. The first run takes what is there as seen.
// Shown on the cards and as chips next to the total (status-info.js); a click clears them.
const MARKS = (() => {
  const isNew = new Set(), isUpdated = new Set(), toCheck = new Map(); // key (-> original's mtime)
  const TR_PATCH = /^(.+)_(ko|en|ja|zh|ru|de|fr|es|pt|pl|tr)\.mod$/i;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];

  // loadMods() calls this after reading the mod folders.
  function scan() {
    isNew.clear(); isUpdated.clear(); toCheck.clear();
    const real = mods.filter((m) => !m.missing);
    const stamps = (config.modStamps ||= {});
    if (!Array.isArray(config.seenMods)) {
      config.seenMods = real.map((m) => m.filename);
      for (const m of real) if (m.stamp) stamps[m.filename] = m.stamp;
      window.api.saveConfig(config); // (not persistConfig: no layout change)
    }
    const seen = new Set(config.seenMods);
    let learned = false;
    for (const m of real) {
      if (!seen.has(m.filename)) { isNew.add(m.filename); continue; }
      if (!m.stamp) continue;
      if (!stamps[m.filename]) { stamps[m.filename] = m.stamp; learned = true; } // (edited by the translator)
      else if (!same(stamps[m.filename], m.stamp)) isUpdated.add(m.filename);
    }
    const byReal = new Map(real.map((m) => [m.realFile.toLowerCase(), m]));
    const trSeen = config.trSeen || {};
    for (const m of real) {
      const x = TR_PATCH.exec(m.realFile);
      const orig = x && byReal.get((x[1] + '.mod').toLowerCase());
      // (2 s: the patch is written right after the original was read)
      if (orig?.stamp && m.stamp && orig.stamp[0] > m.stamp[0] + 2000 && trSeen[m.filename] !== orig.stamp[0]) toCheck.set(m.filename, orig.stamp[0]);
    }
    if (learned) window.api.saveConfig(config);
  }

  // Clicked (a card, or a chip for all of them): their marks go.
  function ack(keys) {
    const stamps = (config.modStamps ||= {});
    const seen = new Set(config.seenMods || []);
    let changed = false;
    for (const k of keys) {
      const m = modByFile(k);
      if (isNew.delete(k)) { seen.add(k); changed = true; }
      if (isUpdated.delete(k)) changed = true;
      if (m?.stamp && !same(stamps[k], m.stamp)) { stamps[k] = m.stamp; changed = true; }
      if (toCheck.has(k)) { (config.trSeen ||= {})[k] = toCheck.get(k); toCheck.delete(k); changed = true; }
    }
    if (!changed) return;
    config.seenMods = [...seen];
    window.api.saveConfig(config);
    applyCards();
    if (typeof STATUS_INFO !== 'undefined') STATUS_INFO.schedule();
  }

  // The translator changed this mod file itself: not an update.
  function editedHere(filePath) {
    const m = mods.find((x) => !x.missing && String(x.filePath).toLowerCase() === String(filePath).toLowerCase());
    if (m && config.modStamps) { delete config.modStamps[m.filename]; window.api.saveConfig(config); }
  }

  function applyCards() {
    document.querySelectorAll('.mod-card[data-filename]').forEach((card) => {
      const k = card.dataset.filename;
      card.querySelectorAll('.km-mark').forEach((b) => b.remove());
      const add = (kind, tip) => {
        const b = document.createElement('span');
        b.className = 'km-mark km-mark-' + kind;
        b.innerHTML = KM_ICONS[kind];
        b.title = tip;
        const src = card.querySelector('.card-source');
        if (src) src.before(b); else card.append(b);
      };
      if (isNew.has(k)) add('new', t('mark.newTip'));
      if (isUpdated.has(k)) add('updated', t('mark.updatedTip'));
      if (toCheck.has(k)) add('tr', t('mark.trTip'));
    });
  }

  // The chips next to the total (only when there are some).
  function chips() {
    const chip = (set, key, kind) => {
      const keys = [...(set.keys ? set.keys() : set)].filter((k) => modByFile(k));
      return keys.length && {
        icon: KM_ICONS[kind], text: t(key, { n: keys.length }), tip: t(key + 'Tip', { n: keys.length }), cls: 'mark-' + kind,
        act: () => { ack(keys); jumpToMod(modByFile(keys[0])); SEL.replace(keys); SEL.anchor(keys[0]); SEL.draw(); },
      };
    };
    return [chip(isNew, 'sb.new', 'new'), chip(isUpdated, 'sb.updated', 'updated'), chip(toCheck, 'sb.trCheck', 'tr')].filter(Boolean);
  }

  return { scan, ack, editedHere, applyCards, chips };
})();

// ===== 📝 Mod memos =====
// config.modNotes: mod key -> the user's own note. Written in the detail panel, shown as 📝 on the
// card (the note is its tooltip). Not in presets or undo (a note isn't the layout); an Advanced
// export can carry them ("📝 메모 포함").
const MEMO = (() => {
  const box = document.getElementById('detail-memo');
  let key = null;
  let timer = null;
  const get = (k) => (config?.modNotes || {})[k] || '';

  function save() {
    clearTimeout(timer);
    timer = null;
    if (!key) return;
    const text = box.value.replace(/\s+$/, '');
    const notes = (config.modNotes ||= {});
    if ((notes[key] || '') === text) return;
    if (text) notes[key] = text; else delete notes[key];
    window.api.saveConfig(config);
    applyCards();
  }
  document.getElementById('detail-memo-icon').innerHTML = KM_ICONS.memo;
  box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 500); });
  box.addEventListener('blur', save);

  // The detail panel shows this mod (app.js updateDetailPanel).
  function show(mod) {
    if (key !== mod?.filename) save();
    key = mod && !mod.missing ? mod.filename : null;
    box.closest('.km-memo-section').classList.toggle('hidden', !key);
    if (key && document.activeElement !== box && !timer) box.value = get(key); // (not while a note waits to be saved)
  }

  function applyCards() {
    document.querySelectorAll('.mod-card[data-filename]').forEach((card) => {
      const text = get(card.dataset.filename);
      let icon = card.querySelector('.km-memo-icon');
      if (!text) { icon?.remove(); return; }
      if (!icon) {
        icon = document.createElement('span');
        icon.className = 'km-memo-icon';
        icon.innerHTML = KM_ICONS.memo;
        const src = card.querySelector('.card-source');
        if (src) src.before(icon); else card.append(icon);
      }
      icon.title = text;
    });
  }

  // From an import (editing.js applyImport): fill the mods without a note, or replace them all.
  function merge(notes, overwrite) {
    save(); // (a note being typed is kept first)
    const mine = (config.modNotes ||= {});
    let n = 0;
    for (const [k, text] of Object.entries(notes || {})) {
      if (typeof text !== 'string' || !text.trim() || !modByFile(k)) continue;
      if (mine[k] && !overwrite) continue;
      if (mine[k] !== text) { mine[k] = text; n++; }
    }
    if (n) { window.api.saveConfig(config); applyCards(); if (selectedMod) show(selectedMod); }
    return n;
  }

  return { show, applyCards, merge, get };
})();

// ===== After every render =====

function afterRender() {
  renderOrderPanel();
  renderCatNav();
  applyImportMarks();
  applyGhostCards();
  MARKS.applyCards();
  MEMO.applyCards();
  updateMissingButton();
  fitDetailWidth();
  if (copyNotice) {
    setStatus(t('copies.oneOn', { name: copyNotice }), 'success');
    copyNotice = null;
  }
  const clip = new Set(clipboardFiles);
  document.querySelectorAll('.mod-card').forEach((c) => c.classList.toggle('clipped', clip.has(c.dataset.filename)));
  showEditFocus();
  updateDirtyUI();
  applyColumnWidth();
  applyFitWidths();
  const q = document.getElementById('global-search-input').value;
  if (q) document.getElementById('global-search-input').dispatchEvent(new Event('input'));
  if (typeof STATUS_INFO !== 'undefined') STATUS_INFO.schedule();
}

// ===== Arrow keys: move the selection =====
// ↑/↓ select the mod above / below in the same list (load order panel or a category);
// ←/→ go to the list on the left / right (the load order panel is the leftmost),
// staying on about the same row. Lists with nothing shown are skipped.

function navLists() {
  const lists = [{ area: 'order', el: orderList }];
  for (const col of columnsContainer.querySelectorAll('.category-column')) {
    lists.push({ area: 'cat', cat: col.dataset.category, el: col.querySelector('.column-mods') });
  }
  return lists;
}

function shownCards(el) {
  return el ? [...el.querySelectorAll('.mod-card')].filter((c) => c.offsetParent !== null) : [];
}

function moveSelectionFocus(dir) {
  const lists = navLists();
  let li = lists.findIndex((l) => (editFocus?.area === 'order' ? l.area === 'order' : l.cat === editFocus?.cat));
  if (li === -1) li = lastClickedMod ? lists.findIndex((l) => l.cat === lastClickedMod.category) : 0;
  if (li === -1) li = 0;
  let cards = shownCards(lists[li].el);
  let row = lastClickedMod ? cards.findIndex((c) => c.dataset.filename === lastClickedMod.filename) : -1;
  if (dir === 'Up' || dir === 'Down') {
    if (!cards.length) return;
    row = row === -1 ? 0 : Math.max(0, Math.min(cards.length - 1, row + (dir === 'Up' ? -1 : 1)));
  } else {
    const step = dir === 'Left' ? -1 : 1;
    let next = li + step;
    while (next >= 0 && next < lists.length && !shownCards(lists[next].el).length) next += step;
    if (next < 0 || next >= lists.length) return;
    li = next;
    cards = shownCards(lists[li].el);
    row = Math.max(0, Math.min(cards.length - 1, row));
  }
  const target = lists[li];
  const file = cards[row].dataset.filename;
  editFocus = target.area === 'order' ? { area: 'order' } : { area: 'cat', cat: target.cat };
  setSelection([file]);
  renderColumns();
  requestAnimationFrame(() => {
    const el = target.area === 'order' ? orderList : columnsContainer.querySelector(`.category-column[data-category="${CSS.escape(target.cat)}"] .column-mods`);
    el?.querySelector(`.mod-card[data-filename="${CSS.escape(file)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

// ===== Keyboard =====

// While a long job runs, keys do nothing.
document.addEventListener('keydown', (e) => {
  if (isBusy()) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

// ===== Shortcut keys (changeable) =====
// Every action has one key combination, written like "Ctrl+Shift+ArrowUp" (keys by
// e.code name without "Key"/"Digit", so a Korean IME doesn't matter). config.keymap
// holds only the ones changed from the defaults ('' = no key).

const SHORTCUTS = [
  // [action, default key, menu group]: 0 File; 1-4 and 8 Edit (4 is its Select sub-menu);
  // 5-7 Move; 9 Help. The order is the order in the menus and in the Shortcut keys dialog.
  ['save', 'Ctrl+S', 0], ['exportList', 'Ctrl+E', 0], ['exportAdvanced', 'Ctrl+Shift+E', 0], ['importList', 'Ctrl+O', 0], ['importString', 'Ctrl+I', 0], ['viewList', 'Ctrl+Shift+O', 0], ['translator', 'Ctrl+T', 0], ['settings', 'Ctrl+Comma', 0],
  ['undo', 'Ctrl+Z', 1], ['redo', 'Ctrl+Y', 1],
  ['move', 'Ctrl+X', 2], ['moveAlt', 'Ctrl+C', 2], ['paste', 'Ctrl+V', 2], ['selectAll', 'Ctrl+A', 2],
  ['deselect', 'Escape', 3], ['toggle', 'Enter', 3], ['deleteFiles', 'Delete', 3],
  ['selUp', 'ArrowUp', 4], ['selDown', 'ArrowDown', 4], ['selLeft', 'ArrowLeft', 4], ['selRight', 'ArrowRight', 4],
  ['problemNext', 'F8', 4], ['problemPrev', 'Shift+F8', 4],
  ['search', 'Ctrl+F', 8],
  ['stepUp', 'Shift+ArrowUp', 5], ['stepDown', 'Shift+ArrowDown', 5], ['catPrev', 'Shift+ArrowLeft', 5], ['catNext', 'Shift+ArrowRight', 5],
  ['top', 'Ctrl+Shift+ArrowUp', 6], ['bottom', 'Ctrl+Shift+ArrowDown', 6], ['catFirst', 'Ctrl+Shift+ArrowLeft', 6], ['catLast', 'Ctrl+Shift+ArrowRight', 6],
  ['colLeft', 'Ctrl+Shift+Alt+ArrowLeft', 7], ['colRight', 'Ctrl+Shift+Alt+ArrowRight', 7], ['colFirst', 'Ctrl+Shift+Alt+Home', 7], ['colLast', 'Ctrl+Shift+Alt+End', 7],
  ['tutorial', 'Alt+H', 9], ['workshop', 'Alt+M', 9],
];
// The window menu a shortcut group is in.
function shortcutMenu(g) {
  return g === 0 ? 'file' : g === 9 ? 'help' : g >= 5 && g <= 7 ? 'move' : 'edit';
}
const SHORTCUT_DEFAULTS = Object.fromEntries(SHORTCUTS.map(([a, k]) => [a, k]));

// Keys taken by the View / Window menus (and Windows itself): [key, menu, item].
const RESERVED_KEYS = [
  ['Ctrl+R', 'view', 'reload'], ['Ctrl+Shift+R', 'view', 'forceReload'], ['Ctrl+Shift+I', 'view', 'devTools'],
  ['Ctrl+0', 'view', 'resetZoom'], ['Ctrl+Numpad0', 'view', 'resetZoom'],
  ['Ctrl+Equal', 'view', 'zoomIn'], ['Ctrl+Shift+Equal', 'view', 'zoomIn'], ['Ctrl+NumpadAdd', 'view', 'zoomIn'],
  ['Ctrl+Minus', 'view', 'zoomOut'], ['Ctrl+NumpadSubtract', 'view', 'zoomOut'],
  ['F11', 'view', 'fullscreen'],
  ['Ctrl+M', 'window', 'minimize'], ['Ctrl+Shift+M', 'window', 'zoom'], ['Ctrl+W', 'window', 'close'], ['Alt+F4', 'window', 'close'],
];

// "Menu > item" for an action of the shortcut list or a reserved key.
function shortcutPlace(action) {
  const g = SHORTCUTS.find(([a]) => a === action)?.[2];
  const menu = { file: 'menu.file', edit: 'menu.edit', move: 'menu.moveMenu', help: 'menu.help' }[shortcutMenu(g)];
  return t(menu) + ' > ' + (g === 4 ? t('menu.selectSub') + ' > ' : '') + t('menu.' + action);
}
// The reserved keys as one row per menu item.
function fixedRows() {
  const rows = [];
  for (const [k, m, item] of RESERVED_KEYS) {
    const row = rows.find((r) => r.m === m && r.item === item);
    if (row) row.keys.push(comboLabel(k));
    else rows.push({ m, item, keys: [comboLabel(k)] });
  }
  return rows;
}
function reservedPlace(combo) {
  const r = RESERVED_KEYS.find(([k]) => k === combo);
  return r ? t('menu.' + r[1]) + ' > ' + t('menu.' + r[2]) : null;
}

function shortcutKey(action) {
  const custom = config?.keymap?.[action];
  return typeof custom === 'string' ? custom : SHORTCUT_DEFAULTS[action];
}

// The key part of a combination, or null for keys that can't be used alone (modifiers,
// Windows key, IME keys).
function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^(F([1-9]|1[0-2])|Numpad.+|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Delete|Backspace|Insert|Home|End|PageUp|PageDown|Tab|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Pause|ScrollLock|PrintScreen|ContextMenu)$/.test(code)) return code;
  return null;
}

function comboOf(e) {
  const key = keyName(e.code);
  if (!key) return null;
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', key].filter(Boolean).join('+');
}

const KEY_LABELS = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Delete: 'Del', Space: 'Space',
  Backspace: 'Backspace', Insert: 'Ins', PageUp: 'PgUp', PageDown: 'PgDn', Minus: '-', Equal: '=', BracketLeft: '[',
  BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  ContextMenu: 'Menu', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', NumpadAdd: 'Num +', NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter',
};

function comboLabel(combo) {
  if (!combo) return '';
  return combo.split('+').map((p) => KEY_LABELS[p] || p.replace(/^Numpad/, 'Num ')).join('+');
}

function shortcutLabel(action) {
  return comboLabel(shortcutKey(action));
}

// ===== Esc / Enter / Del =====

function clearSelection() {
  if (clipboardFiles.length) { clearClipboard(); return; }
  if (!selectedMods.size && !selectedMod) return;
  selectedMods.clear();
  selectedMod = null;
  renderColumns();
  updateDetailPanel();
}

function selectedModList() {
  const files = selectedMods.size ? [...selectedMods] : selectedMod ? [selectedMod.filename] : [];
  return files.map(modByFile).filter(Boolean);
}

// Enter: all selected on -> off; otherwise all on.
function toggleSelected() {
  const list = selectedModList();
  if (!list.length) return;
  // (in a 🚫 category it's the on kept for when the mod leaves)
  const parkedHere = (m) => !m.missing && catNoLoad(m.category);
  const turnOn = list.some((m) => !(parkedHere(m) ? m.parked : m.active));
  for (const m of list) { if (parkedHere(m)) m.parked = turnOn; else m.active = turnOn; }
  commitLayout();
  setStatus(t(turnOn ? 'keys.turnedOn' : 'keys.turnedOff', { count: list.length }), 'success');
}

// Del: the selected mods' files are set aside (lib/soft-delete.js) and go to the Recycle Bin
// when the app closes, so Undo brings them back. Placeholders (mods that aren't installed)
// are just taken off the list, also undoably (a required mod comes back while it's needed).

let deletedStash = []; // [{ sid, mods: [mod objects], moved: [{ from, to }], removed }]

// For captureLayout(): which deletions are in effect.
function removedSids() {
  return deletedStash.filter((s) => s.removed).map((s) => s.sid);
}

// Undo / redo of a deletion (restoreLayout calls this with the layout it restores).
function syncDeleted(state) {
  const want = new Set(state.removed || []);
  for (const s of deletedStash) {
    if (s.removed && !want.has(s.sid)) {
      s.removed = false;
      window.api.softRestore(s.moved).then((r) => { if (!r.restored.length && r.missing.length) filesGone(s); });
      for (const m of s.mods) if (!mods.includes(m)) mods.push(m);
    } else if (!s.removed && want.has(s.sid)) {
      s.removed = true;
      mods = mods.filter((m) => !s.mods.includes(m));
      window.api.softDelete(s.moved.map((m) => ({ path: m.from, mode: m.to.endsWith('.mm-deleted') ? 'suffix' : 'hold' }))).then((r) => { s.moved = r.moved; });
    }
  }
  if (state.ghosts) config.ghosts = structuredClone(state.ghosts);
}

// Undo found the set-aside files gone (deleted by hand meanwhile): the mod stays where it
// was as a placeholder (not installed), so it can be subscribed to again.
function filesGone(s) {
  deletedStash = deletedStash.filter((x) => x !== s);
  for (const m of s.mods) {
    if (!mods.includes(m)) continue;
    const cat = m.category || UNCATEGORIZED;
    ghostStore()[m.realFile] = { cat };
    if (cat === UNCATEGORIZED) delete modCategories[m.realFile]; else modCategories[m.realFile] = cat;
    const order = modOrders[cat] || [];
    const i = order.indexOf(m.filename);
    if (i >= 0) order[i] = m.realFile; else order.push(m.realFile);
    modOrders[cat] = order;
    mods = mods.filter((x) => x !== m);
  }
  persistConfig();
  renderColumns();
  setStatus(t('keys.restoreGone', { name: s.mods.map((m) => m.displayName).join(', ') }), 'warning');
}

// ===== Steam's Workshop record =====
// A Workshop mod deleted here stays listed as installed in Steam's appworkshop_233860.acf,
// and Steam then won't download it again (not even after unsubscribing and subscribing).
// Its id waits in config.steamForget and is taken out of that file when the app closes (Undo
// can bring the files back until then) and at Refresh; so are placeholders (subscribed / to
// subscribe) whose folder is gone. The main process keeps a backup of the file first.
async function forgetSteamRecords({ quiet = false, closing = false } = {}) {
  if (!config.steamModsPath) return;
  // Closing ends Undo: the set-aside files go to the Recycle Bin.
  const held = closing ? new Set() : new Set(deletedStash.filter((s) => s.removed).flatMap((s) => s.mods.map(workshopIdOf)).filter(Boolean));
  const ids = new Set(config.steamForget || []);
  for (const m of mods) {
    if (!m.missing) continue;
    const id = ghostWorkshopId(m.realFile);
    if (id) ids.add(id);
  }
  const want = [...ids].filter((id) => !held.has(id));
  if (!want.length) return;
  const r = await window.api.steamForget({ steamModsPath: config.steamModsPath, ids: want });
  if (r.error) {
    if (!quiet) setStatus(t('steam.forgetFailed', { error: r.error }), 'error');
    return;
  }
  // Kept while Steam runs (it may write its old record back) and while Undo can still restore.
  const pending = (config.steamForget || []).filter((id) => !r.present.includes(id) && (held.has(id) || r.steamRunning));
  if (JSON.stringify(pending) !== JSON.stringify(config.steamForget || [])) {
    config.steamForget = pending;
    await window.api.saveConfig(config);
  }
  if (r.removed.length && !quiet) setStatus(t('steam.forgot', { count: r.removed.length }) + (r.steamRunning ? ' ' + t('steam.forgotRunning') : ''), 'success');
}

async function deleteSelectedFiles() {
  const all = selectedModList();
  if (!all.length) return;
  const ghosts = all.filter((m) => m.missing);
  const list = all.filter((m) => !m.missing);
  const steam = list.filter((m) => m.source === 'steam');
  if (list.length) {
    const names = list.slice(0, 10).map((m) => '• ' + m.displayName).join('\n') + (list.length > 10 ? '\n' + t('keys.andMore', { count: list.length - 10 }) : '');
    const text = t('keys.deleteTextUndo', { count: list.length }) + '\n\n' + names
      + (ghosts.length ? '\n\n' + t('keys.deleteGhostsToo', { count: ghosts.length }) : '')
      + (steam.length ? '\n\n' + t('keys.deleteSteamNote') : '');
    const choice = await choiceModal(t('keys.deleteTitle'), text, [
      { key: 'cancel', text: t('modal.cancel'), primary: true },
      { key: 'delete', text: t('keys.deleteBtnUndo') },
    ]);
    if (choice !== 'delete') return;
  }
  for (const m of ghosts) { delete ghostStore()[m.realFile]; delete modCategories[m.filename]; selectedMods.delete(m.filename); }
  let deleted = [];
  let errors = [];
  if (list.length) {
    const result = await window.api.deleteModFiles({
      gamePath: config.gamePath,
      steamModsPath: config.steamModsPath,
      mods: list.map((m) => ({ filePath: m.filePath, realFile: m.realFile, source: m.source })),
    });
    errors = result.errors;
    const byPath = new Map(result.deleted.map((d) => [d.filePath, d.moved]));
    deleted = list.filter((m) => byPath.has(m.filePath));
    for (const m of deleted) deletedStash.push({ sid: 'd' + Date.now().toString(36) + '-' + m.filename, mods: [m], moved: byPath.get(m.filePath), removed: true });
    mods = mods.filter((m) => !deleted.includes(m));
    const wsIds = deleted.map(workshopIdOf).filter(Boolean);
    if (wsIds.length) config.steamForget = [...new Set([...(config.steamForget || []), ...wsIds])];
  }
  for (const m of deleted) { selectedMods.delete(m.filename); clipboardFiles = clipboardFiles.filter((f) => f !== m.filename); }
  if (selectedMod && (deleted.includes(selectedMod) || ghosts.includes(selectedMod))) selectedMod = null;
  commitLayout();
  updateDetailPanel();
  if (errors.length) setStatus(t('keys.deleteFailed', { count: errors.length, error: errors[0].error }), 'error');
  else setStatus(t(deleted.length ? 'keys.deletedUndo' : 'keys.ghostsRemoved', { count: deleted.length || ghosts.length }), 'success');
  const pages = deleted.filter((m) => m.source === 'steam' && m.url);
  if (pages.length) {
    const open = await choiceModal(t('keys.unsubTitle'), t('keys.unsubText', { count: pages.length }), [
      { key: 'no', text: t('modal.close') },
      { key: 'open', text: t('keys.unsubOpen'), primary: true },
    ]);
    if (open === 'open') for (const m of pages.slice(0, 10)) window.api.openExternal(m.url);
  }
}

// ===== Running an action =====

const SHORTCUT_ACTIONS = {
  exportList: () => exportList(),
  exportAdvanced: () => exportAdvancedModal(),
  importList: () => importList(),
  importString: () => importStringModal(),
  viewList: () => VIEW_HOST.open(),
  translator: () => KMT_BRIDGE.toggle(),
  undo: () => runHistoryCommand('undo'),
  redo: () => runHistoryCommand('redo'),
  move: () => runEditCommand('move'),
  moveAlt: () => runEditCommand('move'),
  paste: () => runEditCommand('paste'),
  selectAll: () => runEditCommand('selectAll'),
  deselect: clearSelection,
  toggle: toggleSelected,
  deleteFiles: deleteSelectedFiles,
  selUp: () => moveSelectionFocus('Up'),
  selDown: () => moveSelectionFocus('Down'),
  selLeft: () => moveSelectionFocus('Left'),
  selRight: () => moveSelectionFocus('Right'),
  save: () => saveBtn.click(),
  search: () => { const el = document.getElementById('global-search-input'); el.focus(); el.select(); },
  problemNext: () => jumpToProblem(1),
  problemPrev: () => jumpToProblem(-1),
  settings: () => settingsModal(),
  tutorial: () => switchTab(tabTutorial.classList.contains('active') ? tabDetails : tabTutorial),
  workshop: openWorkshopSite,
};
for (const cmd of ['stepUp', 'stepDown', 'catPrev', 'catNext', 'top', 'bottom', 'catFirst', 'catLast', 'colLeft', 'colRight', 'colFirst', 'colLast']) {
  SHORTCUT_ACTIONS[cmd] = () => runEditCommand(cmd);
}

// Actions that also work while typing in a text field (when their key has Ctrl/Alt or is an F key).
const SHORTCUTS_IN_TEXT = new Set(['save', 'search', 'settings', 'tutorial', 'workshop', 'exportList', 'exportAdvanced', 'importList']);

document.addEventListener('keydown', (e) => {
  if (mainScreen.classList.contains('hidden') || e.repeat && /Escape|Enter|Delete/.test(e.code)) return;
  const combo = comboOf(e);
  if (!combo) return;
  const action = SHORTCUTS.map(([a]) => a).find((a) => shortcutKey(a) === combo);
  if (!action) return;
  // The export panel is open: only selecting.
  if (exportPicking() && !PICK_ACTIONS.has(action)) { e.preventDefault(); return; }
  const plain = !/Ctrl|Alt/.test(combo) && !/^F\d/.test(combo.split('+').pop());
  if (isEditableTarget(e.target)) {
    // Text fields keep their own keys; undo/redo there edit the text (runHistoryCommand).
    if (action === 'undo' || action === 'redo') { e.preventDefault(); runHistoryCommand(action); return; }
    if (!SHORTCUTS_IN_TEXT.has(action) || plain) return;
  }
  if (dialogOpen()) return;
  // A focused button / link keeps Enter and Space.
  if (plain && e.target.closest?.('button, a, select, summary')) return;
  // With text selected (e.g. in the detail panel), Ctrl+C / Ctrl+X copy it.
  if ((combo === 'Ctrl+C' || combo === 'Ctrl+X') && window.getSelection()?.toString()) return;
  e.preventDefault();
  SHORTCUT_ACTIONS[action]?.();
});

// ===== Window menu (labels with aligned shortcuts) =====

// The window menus, from the shortcut list (in its order). Items: [command, keys] | null (a
// separator) | { heading } (grey, not clickable) | { label, sub: items }.
function shortcutItems(groups) {
  const items = [];
  let group = null;
  for (const [action, , g] of SHORTCUTS) {
    if (!groups.includes(g)) continue;
    if (group !== null && g !== group) items.push(null);
    group = g;
    items.push([action, shortcutLabel(action)]);
  }
  return items;
}

// File: Save / Export / Advanced export… / Import… / Settings / Shortcut keys….
function fileMenuItems() {
  const items = shortcutItems([0]);
  items.splice(1, 0, null);
  items.splice(items.findIndex((it) => it?.[0] === 'translator'), 0, null);
  items.splice(items.length - 1, 0, null);
  return [...items, ['shortcuts', '']];
}

// Edit: undo, move / paste, on / off…, the Select sub-menu, then Search.
function editMenuItems() {
  const select = shortcutItems([4]);
  const at = select.findIndex((it) => it?.[0] === 'problemNext');
  if (at > 0) select.splice(at, 0, null);
  return [...shortcutItems([1, 2, 3]), null, { label: t('menu.selectSub'), sub: select }, null, ...shortcutItems([8])];
}

// Move: the selected mods a step / all the way, and the focused category itself.
function moveMenuItems() {
  const heads = { 5: 'menu.headStep', 6: 'menu.headEdge', 7: 'menu.headCat' };
  return [5, 6, 7].flatMap((g, i) => [...(i ? [null] : []), { heading: t(heads[g]) }, ...shortcutItems([g])]);
}

// Help: tutorial / Workshop, this edition (update check, its GitHub page), the original project's links.
function helpMenuItems() {
  return [
    ['tutorial', shortcutLabel('tutorial')], ['workshop', shortcutLabel('workshop')], null,
    { heading: t('menu.headEdition') },
    ['checkUpdate', ''], ['autoUpdate', '', config?.autoUpdateCheck !== false], ['github', ''], null,
    { heading: t('menu.headOriginal') },
    ['githubOriginal', ''], ['steamGuide', ''], ['discord', ''],
  ];
}
const HELP_LINKS = {
  github: 'https://github.com/skybogli/BEEP-Kenshi-Mod-Manager',
  githubOriginal: 'https://github.com/Derthi/BEEP-Kenshi-Mod-Manager',
  steamGuide: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3704937622',
  discord: 'https://discord.gg/QvFTmRKHSz',
};

// Windows names keys in its own language in menus, so shortcuts are written into the
// labels and padded (measured in the menu font) until they line up in one column.
function menuItemsWithKeys(items) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = 'menu';
  const w = (s) => ctx.measureText(s).width;
  const real = items.filter(Array.isArray).map(([cmd]) => t('menu.' + cmd));
  const target = Math.max(...real.map(w)) + 36;
  const space = w(' ');
  const thin = w(' ');
  return items.map((it) => {
    if (!it) return null;
    if (it.heading) return { heading: it.heading };
    if (it.sub) return { label: it.label, sub: menuItemsWithKeys(it.sub) };
    const label = t('menu.' + it[0]);
    let gap = target - w(label);
    const spaces = Math.max(1, Math.floor(gap / space));
    gap -= spaces * space;
    const item = { command: it[0], label: label + ' '.repeat(spaces) + ' '.repeat(Math.max(0, Math.round(gap / thin))) + it[1] };
    if (typeof it[2] === 'boolean') item.checked = it[2]; // a check box
    return item;
  });
}

function menuCommand(command) {
  if (command === 'undo' || command === 'redo') return;  // handled in app.js
  if (exportPicking() && !PICK_ACTIONS.has(command)) return; // the export panel is open: only selecting
  // View → Reload (Ctrl+R): the import settings' board resets; otherwise a refresh (which asks
  // about unsaved changes) instead of reloading the window.
  if (command === 'reload') {
    if (importBoard && document.querySelector('.km-import')) importBoard.reset();
    else if (!dialogOpen() && !mainScreen.classList.contains('hidden')) refreshWithConfirm();
    return;
  }
  if (command === 'workshop') { openWorkshopSite(); return; }
  if (HELP_LINKS[command]) { window.api.openExternal(HELP_LINKS[command]); return; }
  if (command === 'autoUpdate') {
    if (!config) return;
    config.autoUpdateCheck = config.autoUpdateCheck === false;
    persistConfig();
    updateAppMenu();
    setStatus(t(config.autoUpdateCheck ? 'status.autoUpdateOn' : 'status.autoUpdateOff'), 'success');
    return;
  }
  if (dialogOpen() || mainScreen.classList.contains('hidden')) return;
  if (command === 'checkUpdate') { autoCheckForUpdate(true); return; }
  if (command === 'tutorial') { switchTab(tabTutorial); return; }
  if (command === 'shortcuts') { shortcutsModal(); return; }
  if (EDIT_COMMANDS[command]) runEditCommand(command);
  else SHORTCUT_ACTIONS[command]?.();
}
window.api.onMenuCommand(menuCommand);
window.api.onZoomChanged((factor) => {
  config.zoomFactor = factor;
  persistConfig();
  setStatus(t('zoom.status', { pct: Math.round(factor * 100) }), 'success');
});
// View → Always show menu bar.
window.api.onMenuBarChanged((fixed) => {
  config.menuBarFixed = fixed;
  persistConfig();
  setStatus(t(fixed ? 'menuBar.fixed' : 'menuBar.hidden'), 'success');
});

// ===== Shortcut keys dialog =====
// Click a key box, then press the new key combination (Space, F1–F12, A–Z, digits,
// arrows and other keys, with Ctrl / Shift / Alt). A key used by another action moves
// here (the other one is left without a key). Nothing is kept until Save.

function shortcutsModal() {
  const saved = () => Object.fromEntries(SHORTCUTS.map(([a]) => [a, shortcutKey(a)]));
  let current = saved();
  const draft = { ...current };
  let capturing = null;
  let note = '';
  let noteBad = false;
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(current);

  const onCapture = (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const combo = comboOf(e);
    if (!combo) return; // a modifier alone: wait for the key
    const fixed = reservedPlace(combo);
    if (fixed) {
      note = t('keys.reserved', { key: comboLabel(combo), place: fixed });
      noteBad = true;
      capturing = null;
      draw();
      return;
    }
    noteBad = false;
    const other = Object.keys(draft).find((a) => a !== capturing && draft[a] === combo);
    note = other ? t('keys.movedFrom', { key: comboLabel(combo), action: shortcutPlace(other) }) : '';
    if (other) draft[other] = '';
    draft[capturing] = combo;
    capturing = null;
    draw();
  };
  window.addEventListener('keydown', onCapture, true);

  const { box, close: closeBox } = openWideModal('km-shortcuts', () => requestClose());
  const close = () => { window.removeEventListener('keydown', onCapture, true); closeBox(); };

  const draw = () => {
    let group = null;
    const head = (text) => `<tr class="km-key-head"><td colspan="3">${escapeText(text)}</td></tr>`;
    const rows = SHORTCUTS.map(([a, def, g]) => {
      const menu = shortcutMenu(g);
      const heads = { file: 'keys.menuFile', edit: 'keys.menuEdit', move: 'keys.menuMove', help: 'keys.menuHelp' };
      const sep = group === null || menu !== shortcutMenu(group) ? head(t(heads[menu]))
        : g !== group ? '<tr class="km-key-sep"><td colspan="3"></td></tr>' : '';
      group = g;
      const changed = draft[a] !== def;
      return `${sep}<tr data-a="${a}">
        <td class="km-key-action">${escapeText(t('menu.' + a))}</td>
        <td><button class="km-key-box${capturing === a ? ' capturing' : ''}${changed ? ' changed' : ''}" data-r="capture">${escapeText(capturing === a ? t('keys.pressKey') : comboLabel(draft[a]) || t('keys.none'))}</button></td>
        <td class="km-key-tools">
          <button class="btn btn-subbar" data-r="clear" ${draft[a] ? '' : 'disabled'} title="${escapeText(t('keys.clearTip'))}">✕</button>
          <button class="btn btn-subbar" data-r="default" ${changed ? '' : 'disabled'} title="${escapeText(t('keys.defaultTip', { key: comboLabel(def) }))}">↺</button>
        </td></tr>`;
    }).join('') + head(t('keys.menuFixed')) + fixedRows().map(({ m, item, keys }) =>
      `<tr class="km-key-fixed"><td class="km-key-action">${escapeText(t('menu.' + m) + ' > ' + t('menu.' + item))}</td><td colspan="2"><span class="km-key-box fixed">${escapeText(keys.join(' / '))}</span></td></tr>`).join('');
    box.innerHTML = `<div class="modal-title">⌨ ${escapeText(t('keys.title'))}</div>
      <p class="km-desc">${escapeText(t('keys.desc'))}</p>
      <div class="km-key-note${noteBad ? ' bad' : ''}">${escapeText(note)}</div>
      <div class="km-key-table-wrap"><table class="km-key-table">${rows}</table></div>
      <div class="modal-buttons">
        <button class="btn btn-danger-subtle" data-r="reset-all">${escapeText(t('keys.resetAll'))}</button>
        <span class="km-settings-state">${dirty() ? escapeText(t('settings.unsaved')) : ''}</span>
        <button class="btn" data-r="close">${escapeText(t('settings.close'))}</button>
        <button class="btn btn-primary" data-r="save" ${dirty() ? '' : 'disabled'}>${escapeText(t('settings.save'))}</button>
      </div>`;
    if (capturing) box.querySelector(`tr[data-a="${capturing}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const save = () => {
    const keymap = {};
    for (const [a, def] of SHORTCUTS) if (draft[a] !== def) keymap[a] = draft[a];
    config.keymap = keymap;
    persistConfig();
    updateAppMenu();
    current = saved();
    setStatus(t('keys.saved'), 'success');
  };

  const requestClose = async () => {
    if (capturing) { capturing = null; draw(); return; }
    if (dirty()) {
      const choice = await choiceModal(t('keys.unsavedTitle'), t('settings.unsavedText'), [
        { key: 'cancel', text: t('modal.cancel') },
        { key: 'discard', text: t('unsaved.discard') },
        { key: 'save', text: t('settings.saveClose'), primary: true },
      ]);
      if (!choice || choice === 'cancel') return;
      if (choice === 'save') save();
    }
    close();
  };

  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    const r = btn?.dataset.r;
    if (!r) return;
    const a = btn.closest('tr')?.dataset.a;
    if (r === 'capture') { capturing = capturing === a ? null : a; note = ''; noteBad = false; }
    else if (r === 'clear') { draft[a] = ''; capturing = null; }
    else if (r === 'default') {
      const def = SHORTCUT_DEFAULTS[a];
      const other = Object.keys(draft).find((x) => x !== a && draft[x] === def);
      note = other ? t('keys.movedFrom', { key: comboLabel(def), action: shortcutPlace(other) }) : '';
      noteBad = false;
      if (other) draft[other] = '';
      draft[a] = def;
      capturing = null;
    } else if (r === 'reset-all') {
      if (!(await choiceModal(t('keys.resetAllTitle'), t('keys.resetAllText'), [
        { key: 'cancel', text: t('modal.cancel') }, { key: 'ok', text: t('keys.resetAll'), primary: true }]) === 'ok')) return;
      Object.assign(draft, SHORTCUT_DEFAULTS);
      capturing = null;
      note = '';
    } else if (r === 'save') { save(); }
    else if (r === 'close') return requestClose();
    else return;
    draw();
  });
  draw();
}

