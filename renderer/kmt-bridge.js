// The translator (번역 · 패치 도구, its own window: lib/kmt) seen from the manager:
// the mod menu's 한글화 작업 / 패치 작업, File > 번역 · 패치 도구, and a mod the translator made
// put into a category (its category if named so → the one picked in the translator → Uncategorized).
const KMT_BRIDGE = (() => {
  let menuMods = [];
  let target = 'ko'; // the language the translator translates into (from its bar's news)

  // The mod menu was opened on these mods (app.js showModContextMenu).
  function contextShown(bulkMods) {
    menuMods = bulkMods.filter((m) => !m.missing && m.filePath);
    const any = menuMods.length > 0;
    for (const id of ['mod-context-kmt-sep', 'mod-context-kmt-ko', 'mod-context-kmt-patch', 'mod-context-kmt-open']) {
      document.getElementById(id).classList.toggle('hidden', !any);
    }
    if (!any) return;
    const n = menuMods.length;
    // Korean: the name it has always had; another language: named with it (_JA …)
    const tl = { lang: t('kmt.lang.' + target), sfx: '_' + target.toUpperCase(), count: n };
    document.getElementById('mod-context-kmt-ko').textContent = target === 'ko' ? (n > 1 ? t('kmt.koCount', tl) : t('kmt.ko')) : t(n > 1 ? 'kmt.trCount' : 'kmt.tr', tl);
    document.getElementById('mod-context-kmt-patch').textContent = n > 1 ? t('kmt.patchCount', { count: n }) : t('kmt.patch');
  }

  function open(paths = [], mode = null, start = false) {
    return window.api.kmtOpen({ mods: paths, mode, start });
  }

  const run = (mode, start) => () => {
    const paths = menuMods.map((m) => m.filePath);
    hideContextMenu();
    if (!paths.length) return;
    open(paths, mode, start);
    setStatus(t(start ? 'kmt.started' : 'kmt.opened', { count: paths.length }), 'success');
  };
  document.getElementById('mod-context-kmt-ko').addEventListener('click', run('patchmod', true));
  document.getElementById('mod-context-kmt-patch').addEventListener('click', run('copypatch', true));
  document.getElementById('mod-context-kmt-open').addEventListener('click', run(null, false));

  // For the translator's "where made mods go" lists.
  function categoryList() {
    // (Uncategorized is listed by the translator itself)
    return orderedCatIds().filter((id) => id !== UNCATEGORIZED).map(catById).filter(Boolean).map((c) => ({ id: c.id, name: c.name, color: c.color }));
  }

  // Where a made mod goes: the category picked in the translator, else one named for it, else Uncategorized.
  const KO_NAMES = /한글|한국어|번역|korean|translat|locali[sz]|übersetz|tradu[cz]|перев|руси|翻訳|日本語化|翻译|汉化|漢化|çeviri|tłumacz|polonizac/i;
  const PATCH_NAMES = /패치|patch/i;
  function targetCategory(mode, route) {
    const pick = mode === 'patchmod' ? route?.ko : route?.patch;
    if (pick === '__uncategorized__') return UNCATEGORIZED;
    if (pick === '__after_original__') return UNCATEGORIZED; // (no original in the list: Uncategorized)
    if (pick && catById(pick)) return pick;
    const cats = orderedCatIds().map(catById).filter(Boolean);
    const byName = (re) => cats.find((c) => re.test(c.name));
    const found = (mode === 'patchmod' && byName(KO_NAMES)) || byName(PATCH_NAMES);
    return found ? found.id : UNCATEGORIZED;
  }

  const samePath = (a, b) => String(a || '').toLowerCase().replace(/\//g, '\\') === String(b || '').toLowerCase().replace(/\//g, '\\');

  // The translator made (or changed) a mod.
  async function madeMod(info) {
    const name = info.path.split(/[\\/]/).pop();
    if (info.mode === 'inplace') { MARKS.editedHere(info.path); setStatus(t('kmt.editedOriginal', { name }), 'success'); return; }
    if (!info.inMods) { setStatus(t('kmt.madeElsewhere', { name, path: info.path }), 'success'); return; }
    let mod = mods.find((m) => samePath(m.filePath, info.path));
    if (mod && !info.isNew) { setStatus(t('kmt.remade', { name: mod.displayName || name }), 'success'); return; }
    if (!mod) {
      // Just this mod is added (a full reload would drop unsaved changes).
      const found = assignModKeys(await window.api.discoverMods(config)).find((m) => samePath(m.filePath, info.path));
      if (!found) { setStatus(t('kmt.madeElsewhere', { name, path: info.path }), 'success'); return; }
      if (mods.some((m) => m.filename === found.filename)) { await loadMods(); mod = mods.find((m) => samePath(m.filePath, info.path)); }
      else {
        found.active = false;
        found.category = UNCATEGORIZED;
        mods.push(found);
        mod = found;
      }
      if (!mod) return;
    }
    const source = mods.find((m) => samePath(m.filePath, info.source));
    const pick = info.mode === 'patchmod' ? info.route?.ko : info.route?.patch;
    const afterOriginal = pick === '__after_original__' && source;
    const catId = afterOriginal ? source.category : targetCategory(info.mode, info.route);
    const turnOn = info.activate !== false && !!source?.active;
    if (turnOn) mod.active = true;
    if (afterOriginal) {
      // right after the original, in its category: original → patch → the mods that build on it
      const list = getModsForCategory(catId).map((m) => m.filename).filter((f) => f !== mod.filename);
      modOrders[catId] = list;
      moveMod(mod, catId, list[list.indexOf(source.filename) + 1] || null, true);
      syncModCategories();
      persistConfig();
      renderColumns();
    } else {
      // where in the category: the top / right after its last turned-on mod / the bottom
      const pos = ['top', 'afterActive', 'bottom'].includes(info.route?.pos) ? info.route.pos : 'afterActive';
      CM.dropMods([mod.filename], catId, pos);
    }
    const catName = catId === UNCATEGORIZED ? uncatName() : catById(catId)?.name;
    // A patch only works when it loads after its original.
    const order = computeLoadOrder();
    const late = mod.active && source?.active && order.indexOf(mod.filename) >= 0 && order.indexOf(mod.filename) < order.indexOf(source.filename);
    setStatus(t(late ? 'kmt.placedEarly' : turnOn ? 'kmt.placedOn' : 'kmt.placed', { name: mod.displayName || name, cat: catName, original: source?.displayName || '' }), late ? 'error' : 'success');
    if (typeof STATUS_INFO !== 'undefined') STATUS_INFO.schedule();
  }
  window.api.onKmtMadeMod((info) => { madeMod(info).catch((e) => setStatus(e.message, 'error')); });

  // The bar at the bottom: the translator, minimized there (from the start).
  const dockBtn = document.getElementById('kmt-dock');
  dockBtn.addEventListener('click', () => window.api.kmtDockClick());
  window.api.onKmtDock((d) => {
    dockBtn.classList.toggle('open', d.shown);
    if (d.target) target = d.target;
    const job = dockBtn.querySelector('.kmt-dock-job');
    job.textContent = d.running ? `${d.running}${d.total ? ` ${Math.floor((100 * d.done) / d.total)}%` : ' …'}${d.queued ? ` +${d.queued}` : ''}` : '';
  });
  window.api.kmtDockState();

  // A dialog opens / closes here: the translator window (if pinned over it) steps aside.
  let dialogKey = 'none';
  let dialogTimer = null;
  const checkDialog = () => {
    dialogTimer = null;
    const boxes = [...document.querySelectorAll('.modal-overlay:not(.hidden)')]
      .filter((o) => getComputedStyle(o).display !== 'none')
      .map((o) => (o.querySelector('.modal-box') || o).getBoundingClientRect())
      .filter((r) => r.width && r.height);
    // the setup screen (설정: game / Steam folders) takes the whole window
    if (mainScreen.classList.contains('hidden')) boxes.push({ left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight });
    let rect = null;
    if (boxes.length) {
      const x = Math.min(...boxes.map((r) => r.left)), y = Math.min(...boxes.map((r) => r.top));
      rect = { x, y, w: Math.max(...boxes.map((r) => r.right)) - x, h: Math.max(...boxes.map((r) => r.bottom)) - y };
    }
    // sent again whenever the dialog's box changes (it may still be growing when first seen)
    const key = rect ? [rect.x, rect.y, rect.w, rect.h].map(Math.round).join(',') : 'none';
    if (key === dialogKey) return;
    dialogKey = key;
    window.api.kmtMainDialog(rect);
  };
  const schedule = () => {
    if (dialogTimer) return;
    dialogTimer = setTimeout(checkDialog, 60);
    setTimeout(checkDialog, 400); // after an opening / closing animation
  };
  new MutationObserver(schedule)
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });

  // Mods dragged into the translator window: file names (or copy keys) -> .mod paths.
  function paths(names) {
    return names.map((f) => modByFile(f)).filter((m) => m && !m.missing && m.filePath).map((m) => m.filePath);
  }

  return { categories: categoryList, open, contextShown, targetCategory, paths, toggle: () => window.api.kmtDockClick() };
})();
window.KMT_BRIDGE = KMT_BRIDGE;
