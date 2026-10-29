// ===== This app's side of cat-menus.js (category menu, selection menu, category list) =====

const POP_CLS = { menu: 'context-menu', item: 'context-item', sep: 'context-separator', label: 'context-label', danger: 'context-danger' };

// Worked out once for a menu (it asks for each mod).
let cmCache = null;
function cmOnce(key, make) {
  if (!cmCache) {
    cmCache = {};
    setTimeout(() => { cmCache = null; });
  }
  if (!(key in cmCache)) cmCache[key] = make();
  return cmCache[key];
}

const CM = {
  t: (key, vars) => t(key, vars),
  status: (text) => setStatus(text, 'success'),
  keys: (action) => shortcutLabel(action),
  blocked: () => dialogOpen() || mainScreen.classList.contains('hidden') || exportPicking(),
  // Categories (Uncategorized: only moved)
  cats: () => orderedCatIds(),
  name: (id) => catById(id)?.name || '',
  isUncat: (id) => id === UNCATEGORIZED,
  vertical: () => verticalLayout,
  fitMode: (id) => fitMode(id),
  toggleFit: (id, kind) => toggleFit(id, kind),
  rename: (id) => renameCategory(id),
  pickColor: (id) => pickCategoryColor(id),
  sortState: (id) => t('sortRule.state.' + sortState(id)),
  sortSettings: (id) => sortModal(id),
  sortItems: (id) => {
    const rule = sortRule(id);
    return [
      { text: t(rule ? 'sortRule.now' : 'sortRule.nowDefault'), fn: () => sortNow(id) },
      { text: t(rule?.auto ? 'sortRule.autoTurnOff' : 'sortRule.autoTurnOn'), fn: () => setAutoSort(id, !rule?.auto) },
    ];
  },
  moveTo: (id, to) => moveCategoryTo(id, to),
  remove: (id) => deleteCategory(id),
  // 🚫 a category that doesn't load (editing.js)
  noLoad: (id) => catNoLoad(id),
  setNoLoad: (id, on) => setCatNoLoad(id, on),
  focusedCat: () => {
    const id = editFocus?.area === 'cat' ? editFocus.cat : lastClickedMod?.category;
    if (!id || !catById(id)) return null;
    editFocus = { area: 'cat', cat: id };
    return id;
  },
  // Mods
  modsIn: (id) => [...catFiles(id)],
  allMods: () => orderedCatIds().flatMap(catFiles),
  modName: (f) => modByFile(f)?.displayName || f,
  on: (f) => !!modByFile(f)?.active,
  hasPins: true,
  pinned: (f) => pins.has(f),
  missing: (f) => cmOnce('subscribe', () => new Set(toSubscribeFiles())).has(f),
  unpin: (files) => unpinFiles(files),
  getMissing: (files) => openSubscribeQueue(files),
  // Steam mods of a category: to link into the game folder / already linked.
  links: (id) => {
    const steam = catFiles(id).map(modByFile).filter((m) => m && m.source === 'steam' && !m.missing);
    return { link: steam.filter((m) => !linkedMods.has(m.realFile)), unlink: steam.filter((m) => linkedMods.has(m.realFile)) };
  },
  link: (list) => linkModsToGame(list),
  unlink: (list) => unlinkModsFromGame(list),
  // Dependency problems of the mods that are on, in load order.
  problems: () => {
    const position = Object.fromEntries(actualOrder.map((f, i) => [f, i + 1]));
    return actualOrder.map((f) => ({ f, mod: modByFile(f) })).filter((x) => x.mod?.active)
      .map((x) => ({ key: x.f, p: depProblems(x.mod, position) })).filter((x) => x.p.length)
      .map((x) => ({ key: x.key, text: x.p.join(' · ') }));
  },
  extraConditions: (all) => {
    const mod = (f) => modByFile(f);
    return [
      { text: t('cm.conflicts'), keys: all.filter((f) => conflictData?.modConflicts?.[mod(f)?.realFile]?.length) },
      { text: t('cm.copies'), keys: all.filter((f) => mod(f) && !mod(f).missing && sameNameCopies(mod(f)).length) },
      { text: t('cm.steamMods'), keys: all.filter((f) => mod(f)?.source === 'steam' && !mod(f).missing) },
      { text: t('cm.localMods'), keys: all.filter((f) => mod(f) && mod(f).source !== 'steam' && !mod(f).missing) },
    ];
  },
  // Select one mod and show it.
  reveal: (f) => {
    const mod = modByFile(f);
    setSelection([f]);
    if (mod?.category) editFocus = { area: 'cat', cat: mod.category };
    renderColumns();
    const card = columnsContainer.querySelector(`.mod-card[data-filename="${CSS.escape(f)}"]`) || orderList.querySelector(`.mod-card[data-filename="${CSS.escape(f)}"]`);
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (card) flashCard(card);
  },
  // Mods dropped on the category list: into the category, at the top / after the mods that are on
  // / at the bottom.
  draggedMods: (e) => e.dataTransfer.getData('text/plain').split('\n').filter((f) => modByFile(f)),
  dropMods: (files, catId, pos) => {
    const shown = getModsForCategory(catId).map((m) => m.filename);
    const list = shown.filter((f) => !files.includes(f));
    const at = pos === 'top' ? 0 : pos === 'afterActive' ? list.map((f) => modByFile(f)?.active).lastIndexOf(true) + 1 : list.length;
    modOrders[catId] = shown; // the order as shown, so the place is found in it
    for (const f of files) moveMod(modByFile(f), catId, list[at] || null, true);
    syncModCategories();
    persistConfig();
    renderColumns();
  },
  // Where things are on screen
  headerSel: '.column-header',
  catOfHeader: (h) => h.closest('.category-column')?.dataset.category,
  colBodySel: '.column-mods',
  catOfColumn: (col) => col.dataset.category,
  orderListSel: '#order-mods',
  navList: catNavList,
  navItemSel: '.km-cat-nav-item',
  // The Sort dialog's category rows (reordered after a long press; the dialog is made anew).
  sortRows: {
    container: document.body,
    item: '.km-sort-row:not(.deleted)',
    skip: 'select, input, button, label, .km-spec, .km-custom',
    area: () => document.querySelector('.km-sort-rows'),
  },
};

// ===== This app's side of status-info.js (the bottom bar's right side) =====

const SB = {
  el: document.getElementById('status-right'),
  esc: escapeText,
  hidden: () => mainScreen.classList.contains('hidden'),
  counts: () => ({
    total: mods.filter((m) => !m.missing).length,
    on: mods.filter((m) => m.active && !m.missing).length,
    selected: selectedMods.size,
  }),
  getKey: 'sb.subscribe',
  toGet: () => toSubscribeFiles(),
  pins: () => [...pins],
  marks: () => MARKS.chips(), // 🆕 ⟳ 🌐 next to the total (editing.js)
  clip: () => [...clipboardFiles],
  search: () => {
    const q = globalSearchInput.value.trim().toLowerCase();
    return q ? { count: mods.filter((m) => (m.displayName || '').toLowerCase().includes(q)).length } : null;
  },
  clearSearch: () => { globalSearchInput.value = ''; globalSearchInput.dispatchEvent(new Event('input')); },
  zoom: () => config?.zoomFactor || 1,
  resetZoom: () => { window.api.setZoom(1); config.zoomFactor = 1; persistConfig(); },
  // Conflicts (after a conflict check) and Steam mods linked into the game folder.
  info: () => {
    const conflicts = conflictData ? mods.filter((m) => m.active && conflictData.modConflicts?.[m.realFile]?.length).map((m) => m.filename) : [];
    const linked = mods.filter((m) => m.source === 'steam' && !m.missing && linkedMods.has(m.realFile)).map((m) => m.filename);
    return [
      conflicts.length && { text: t('sb.conflicts', { n: conflicts.length }), tip: t('sb.conflictsTip'), cls: 'warn', act: () => { SEL.replace(conflicts); SEL.draw(); } },
      linked.length && { text: t('sb.links', { n: linked.length }), tip: t('sb.linksTip'), act: () => { SEL.replace(linked); SEL.draw(); } },
    ];
  },
};
