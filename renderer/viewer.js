// ===== An exported list in its own window (lib/list-viewer.js, preload-viewer.js) =====
// In the main window: VIEW_HOST, what the list windows ask of it (my mods, my list for the
// comparison, the subscribe queue, the import settings) and 파일 → 내보내기 파일 보기….
// In a list window (window.api.vwId): this same page shows the file. It opens as 보기 (look,
// select, search, filters); 수정 lets mods and categories be moved, turned on / off, added,
// renamed, deleted, and my mods the file doesn't name be added from their own column
// (내 모드 추가). Nothing here reaches the game or my settings; 다른 이름으로 저장 writes a new
// export file ('<name>_사본 01.txt').

if (!window.api.vwId) {
  // 가져오기 ▾: 모드 목록 뷰어
  document.getElementById('import-list-more-btn')?.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    POP.open([
      { text: t('menu.importString'), keys: shortcutLabel('importString'), fn: () => importStringModal() },
      { text: t('menu.viewList'), keys: shortcutLabel('viewList'), fn: () => VIEW_HOST.open() },
    ], r.left, r.bottom + 2);
  });
  window.VIEW_HOST = {
    // my installed mods, as found on disk (a list window lays them out as its file says)
    myMods() {
      return JSON.parse(JSON.stringify(mods.filter((m) => !m.missing).map((m) => {
        const { category, ...rest } = m;
        return { ...rest, filename: m.realFile };
      })));
    },
    // my list now: what I have, what is on, the load order (real file names)
    myState() {
      return { have: mods.filter((m) => !m.missing).map((m) => m.realFile), on: mods.filter((m) => m.active && !m.missing).map((m) => m.realFile), order: loadOrderFiles() };
    },
    // [[file, Workshop id]] from a list window: into my subscribe queue
    subscribe(items) {
      for (const [file, ws] of items) if (ws) importWorkshopIds[file] = ws;
      openSubscribeQueue(items.map(([file]) => file));
    },
    // a list window's layout into my import settings (nothing is applied before I choose)
    importText(text) {
      const src = parseImportText(text);
      if (!src) { setStatus(t('status.noModFilenames'), 'error'); return; }
      importPreview(src);
    },
    async open() {
      const file = await window.api.openFileDialog([{ name: 'Text Files', extensions: ['txt'] }]);
      if (!file) return;
      const got = await listTextOf(file.content); // (a txt holding a 'BEEP1:' string)
      if (got.error) { setStatus(listStringError(got.error, got.game), 'error'); return; }
      const r = await window.api.vwOpen({ file: file.path, content: got.text });
      if (r?.error === 'max') choiceModal(t('vw.maxTitle'), t('vw.max', { n: r.max }), [{ key: 'ok', text: t('modal.close'), primary: true }]);
      else if (r?.error) setStatus(t('status.noModFilenames'), 'error');
    },
  };
} else {
  (() => {
    let POOL = '__vw_pool__';
    let edit = false;
    let baseline = null;
    let fileName = '';
    let mine = null; // { have, on, order } of my own list
    let filter = '';
    let marks = { miss: new Set(), off: new Set(), ord: new Set() };
    document.body.classList.add('vw', 'vw-view');

    const style = document.createElement('style');
    style.textContent = `
      body.vw #kmt-dock, body.vw .toolbar-right > .btn-group:not(.vw-bar), body.vw #tab-guide, body.vw #tab-workshop, body.vw #tab-packs,
      body.vw #tab-tutorial, body.vw #tab-conflicts, body.vw #mod-context-create-links, body.vw #mod-context-remove-links,
      body.vw #mod-context-link-separator, body.vw #mod-context-kmt-sep, body.vw #mod-context-kmt-ko, body.vw #mod-context-kmt-patch,
      body.vw #mod-context-kmt-open, body.vw #reset-categories-btn { display: none !important; }
      body.vw-view #mod-context-menu > *:not(.vw-keep) { display: none !important; }
      body.vw-edit #vw-ctx-page { display: none !important; }
      body.vw-view #vw-ctx-remove { display: none !important; }
      body.vw .km-cat-nav-item[data-cat="${POOL}"] { display: none !important; }
      /* 보기: what can't be used there, greyed out */
      body.vw-view #undo-btn, body.vw-view #redo-btn, body.vw-view #add-category-btn, body.vw-view #auto-classify-btn, body.vw-view #order-reset-btn,
      body.vw-view .column-header input, body.vw-view .column-header-name-editable, body.vw-view .column-header button:not(.km-min-btn),
      body.vw-view .column-header .column-move-btn:not(.km-min-btn):not(.km-fit-btn),
      body.vw-view .mod-card input[type="checkbox"], body.vw-view #order-panel input { opacity: .35 !important; pointer-events: none !important; filter: grayscale(1); }
      .vw-bar { display: flex; gap: 6px; align-items: center; }
      .vw-seg { display: inline-flex; border: 1px solid var(--border, #444); border-radius: 6px; overflow: hidden; }
      .vw-seg button { border: 0; border-radius: 0; opacity: .7; }
      .vw-seg button.on { opacity: 1; font-weight: 700; }
      .vw-seg button[data-mode="view"].on { background: #34c77b; color: #0d1f15; }
      .vw-seg button[data-mode="edit"].on { background: #ffb238; color: #241600; }
      /* 보유 모드 추가: my mods this list doesn't have, between the load order and the categories */
      .vw-pool { width: 240px; }
      .vw-pool.collapsed { width: 24px; }
      .vw-pool.collapsed .vw-pool-body { display: none; }
      .vw-pool-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
      .vw-pool-search { flex: none; margin: 6px; height: 26px; padding: 3px 8px; border: 1px solid #34343c; border-radius: 4px; background: #1a1a1f; color: inherit; font: inherit; font-size: 12px; outline: none; }
      .vw-pool-search:focus { border-color: #4a6fa5; }
      .vw-pool-note { padding: 0 8px 6px; font-size: 11px; opacity: .7; }
      .vw-pool-list { flex: 1; min-height: 0; display: flex; flex-direction: column; }
      .vw-pool-list .category-column { flex: 1 !important; width: auto !important; min-width: 0 !important; max-width: none !important; border: none !important; }
      .vw-pool-list .column-header { display: none !important; }
      body.vw-view .vw-pool-list .mod-card { cursor: default; }
      .vw-summary { display: flex; gap: 6px; align-items: center; padding: 4px 12px; font-size: 12px; border-bottom: 1px solid rgba(128,128,128,.25); flex-wrap: wrap; }
      .vw-chip { padding: 2px 9px; border-radius: 10px; border: 1px solid rgba(128,128,128,.4); cursor: pointer; background: transparent; color: inherit; font-size: 12px; }
      .vw-chip.on { background: rgba(97,175,239,.25); border-color: #61afef; }
      .vw-chip[data-f="miss"] i { color: #e5c07b; } .vw-chip[data-f="off"] i { color: #e06c75; } .vw-chip[data-f="ord"] i { color: #61afef; }
      .vw-mode-note { margin-left: auto; opacity: .75; }
      .mod-card.vw-off { box-shadow: inset 3px 0 0 #e06c75; }
      .mod-card.vw-ord { box-shadow: inset 3px 0 0 #61afef; }
      .mod-card.vw-off.vw-ord { box-shadow: inset 3px 0 0 #e06c75, inset 6px 0 0 #61afef; }
      .mod-card.ghost.vw-goff { opacity: .55; }
      .vw-goff-tag { margin-left: 4px; font-size: 10px; opacity: .85; }
      body.vw-f-miss .mod-card:not(.vw-miss), body.vw-f-off .mod-card:not(.vw-off), body.vw-f-ord .mod-card:not(.vw-ord) { display: none !important; }
    `;
    document.head.appendChild(style);

    const poolMod = (m) => m && m.category === POOL;
    const inView = () => !edit;
    const note = () => setStatus(t('vw.editOnly'), 'error');
    const selected = () => [...selectedMods].map(modByFile).filter(Boolean);

    // ---- what the file is now (the export of this window) ----
    const _inScope = exportInScope;
    exportInScope = (m, o) => !poolMod(m) && _inScope(m, o);
    // (the hidden category of my other mods is never written; its mods are out of scope already)
    function stripPool(text) {
      const lines = text.split('\n');
      const at = lines.indexOf(`[${catById(POOL)?.name}]`);
      if (at >= 0) lines.splice(at, lines[at + 1] === '' ? 2 : 1);
      return lines.join('\n');
    }
    const fileText = () => stripPool(buildExportText(EXPORT_ALL).text);
    // the advanced export (내보내기 ▾): the file / the string of this list, saved next to its file
    EXP.buildApp = (o) => { const r = buildExportText(o); return { ...r, text: stripPool(r.text) }; };
    EXP.exportApp = (o) => saveAs(EXP.buildApp(o).text, false);

    // ---- the window's title: file · mode · unsaved ----
    const dirty = () => baseline !== null && captureLayout() !== baseline;
    function showTitle() {
      document.title = `${fileName}${dirty() ? ' *' : ''} — ${t('vw.title')} (${t(edit ? 'vw.edit' : 'vw.view')})`;
      const h = document.querySelector('.toolbar-left h2');
      if (h) h.textContent = fileName + (dirty() ? ' *' : '');
    }

    // ---- the comparison with my own list ----
    function lisKeep(seq) { // indexes of a longest increasing run of seq
      const tails = [], prev = new Array(seq.length), idx = [];
      seq.forEach((v, i) => {
        let lo = 0, hi = tails.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
        tails[lo] = v; idx[lo] = i; prev[i] = lo ? idx[lo - 1] : -1;
      });
      const keep = new Set();
      for (let i = tails.length ? idx[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
      return keep;
    }
    function compare() {
      marks = { miss: new Set(), off: new Set(), ord: new Set() };
      const list = mods.filter((m) => !poolMod(m));
      for (const m of list) if (m.missing) marks.miss.add(m.filename);
      if (mine) {
        const myOn = new Set(mine.on);
        for (const m of list) if (!m.missing && exportIsOn(m) && !myOn.has(m.realFile)) marks.off.add(m.filename);
        const myAt = new Map(mine.order.map((f, i) => [f, i]));
        const common = actualOrder.map(modByFile).filter((m) => m && !m.missing && !poolMod(m) && m.active && myAt.has(m.realFile));
        const keep = lisKeep(common.map((m) => myAt.get(m.realFile)));
        common.forEach((m, i) => { if (!keep.has(i)) marks.ord.add(m.filename); });
      }
      for (const card of document.querySelectorAll('.mod-card')) {
        const k = SEL.keyOf(card);
        card.classList.toggle('vw-miss', marks.miss.has(k));
        card.classList.toggle('vw-off', marks.off.has(k));
        card.classList.toggle('vw-ord', marks.ord.has(k));
        // a mod I don't have: on / off as the file has it (it has no check box)
        if (card.classList.contains('ghost')) {
          const off = ghostStore()[modByFile(k)?.realFile]?.on === false;
          card.classList.toggle('vw-goff', off);
          card.querySelector('.vw-goff-tag')?.remove();
          if (off) card.querySelector('.ghost-badge')?.insertAdjacentHTML('beforeend', `<span class="vw-goff-tag">(${escapeText(t('vw.ghostOff'))})</span>`);
        }
      }
      drawSummary();
    }

    // ---- the bar: 보기 / 수정, 내 모드 추가, 구독, 이대로 가져오기, 다른 이름으로 저장, 새로고침 ----
    const bar = document.createElement('div');
    bar.className = 'btn-group vw-bar';
    bar.innerHTML = `
      <span class="vw-seg"><button class="btn" data-mode="view"></button><button class="btn" data-mode="edit"></button></span>
      <button class="btn" data-a="sub"></button>
      <button class="btn" data-a="import"></button>
      <button class="btn" data-a="refresh"></button>
      <span class="btn-split"><button class="btn btn-primary" data-a="save"></button><button class="btn btn-primary split-more" data-a="save-more">▾</button></span>`;
    document.querySelector('.toolbar-right')?.appendChild(bar);
    const summary = document.createElement('div');
    summary.className = 'vw-summary';
    document.querySelector('#main-screen .toolbar')?.after(summary);

    function drawBar() {
      const b = (sel) => bar.querySelector(sel);
      b('[data-mode="view"]').textContent = t('vw.view');
      b('[data-mode="view"]').title = t('vw.viewTip');
      b('[data-mode="edit"]').textContent = t('vw.edit');
      b('[data-mode="edit"]').title = t('vw.editTip');
      b('[data-mode="view"]').classList.toggle('on', !edit);
      b('[data-mode="edit"]').classList.toggle('on', edit);
      const miss = mods.filter((m) => m.missing && !poolMod(m)).length;
      b('[data-a="sub"]').textContent = t('vw.subscribe', { n: miss });
      b('[data-a="sub"]').disabled = !miss;
      b('[data-a="import"]').textContent = t('vw.import');
      b('[data-a="import"]').title = t('vw.importTip');
      b('[data-a="refresh"]').textContent = t('toolbar.refresh');
      b('[data-a="refresh"]').title = t('vw.refreshTip');
      b('[data-a="save"]').textContent = t('toolbar.exportList');
      b('[data-a="save"]').title = t('vw.exportTip');
      b('[data-a="save-more"]').title = t('toolbar.exportMoreTip');
    }
    function drawSummary() {
      const total = mods.filter((m) => !poolMod(m)).length;
      const chip = (f, n, label) => `<button class="vw-chip${filter === f ? ' on' : ''}" data-f="${f}"><i>●</i> ${escapeText(t(label, { n }))}</button>`;
      summary.innerHTML = `<button class="vw-chip${!filter ? ' on' : ''}" data-f="">${escapeText(t('vw.sum.total', { n: total }))}</button>`
        + chip('miss', marks.miss.size, 'vw.sum.miss') + chip('off', marks.off.size, 'vw.sum.off') + chip('ord', marks.ord.size, 'vw.sum.ord')
        + `<span class="vw-mode-note">${escapeText(t(edit ? 'vw.editNote' : 'vw.viewNote'))}</span>`;
    }
    summary.addEventListener('click', (e) => {
      const c = e.target.closest('.vw-chip');
      if (!c) return;
      filter = filter === c.dataset.f ? '' : c.dataset.f;
      for (const f of ['miss', 'off', 'ord']) document.body.classList.toggle('vw-f-' + f, filter === f);
      drawSummary();
    });

    function setMode(on) {
      edit = on;
      document.body.classList.toggle('vw-edit', edit);
      document.body.classList.toggle('vw-view', !edit);
      drawPool();
      drawBar();
      drawSummary();
      showTitle();
    }
    bar.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-mode]');
      if (m) { setMode(m.dataset.mode === 'edit'); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'sub') subscribeMissing(mods.filter((m) => m.missing && !poolMod(m)).map((m) => m.realFile), true);
      else if (a === 'import') { await window.api.vwImport(fileText()); setStatus(t('vw.imported'), 'success'); }
      else if (a === 'refresh') refresh();
      else if (a === 'save') saveAs();
      else if (a === 'save-more') exportAdvancedModal();
    });

    // ---- 보유 모드 추가: the hidden category's column, shown in its own panel left of the categories
    // (보기: seen, not dragged; 수정: dragged into a category = added, back here = taken out) ----
    const pool = document.createElement('div');
    pool.className = 'km-cat-nav vw-pool';
    pool.innerHTML = '<button class="km-cat-nav-toggle vw-pool-toggle"></button><div class="vw-pool-body"><input class="vw-pool-search" spellcheck="false"><div class="vw-pool-note"></div><div class="vw-pool-list"></div></div>';
    document.getElementById('order-resize-handle')?.after(pool);
    const poolFolded = () => { try { return localStorage.getItem('vw.poolFolded') !== '0'; } catch { return true; } }; // (folded at first)
    pool.classList.toggle('collapsed', poolFolded());
    pool.querySelector('.vw-pool-toggle').addEventListener('click', () => {
      const f = !pool.classList.contains('collapsed');
      pool.classList.toggle('collapsed', f);
      try { localStorage.setItem('vw.poolFolded', f ? '1' : '0'); } catch { /* fine */ }
      drawPool();
    });
    const poolSearch = pool.querySelector('.vw-pool-search');
    const filterPool = () => {
      const q = poolSearch.value.trim().toLowerCase();
      pool.querySelectorAll('.vw-pool-list .mod-card').forEach((c) => { c.style.display = !q || c.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    };
    poolSearch.addEventListener('input', filterPool);
    function drawPool() {
      const list = pool.querySelector('.vw-pool-list');
      const col = columnsContainer.querySelector(`.category-column[data-category="${POOL}"]`);
      if (col) { list.innerHTML = ''; list.appendChild(col); }
      const n = getModsForCategory(POOL).length;
      const open = !pool.classList.contains('collapsed');
      const tg = pool.querySelector('.vw-pool-toggle');
      tg.innerHTML = `<span class="km-cat-nav-arrow">${open ? '◂' : '▸'}</span> <span>${escapeText(t('vw.poolBtn', { n }))}</span>`;
      tg.title = t('vw.poolTip');
      poolSearch.placeholder = t('search.placeholder');
      pool.querySelector('.vw-pool-note').textContent = t(edit ? 'vw.poolEditNote' : 'vw.poolViewNote');
      filterPool();
    }

    // ---- 내보내기: a new file '<name>_사본 01.txt' (the window becomes that file); from the advanced
    // export (adopt = false) only that file is written ----
    async function saveAs(text = fileText(), adopt = true) {
      const r = await window.api.vwSaveAs({ text, word: t('vw.copyWord'), adopt });
      if (!r) return false;
      if (adopt) {
        fileName = r.name;
        baseline = captureLayout();
        showTitle();
      }
      setStatus(t('vw.saved', { name: r.name }), 'success');
      return true;
    }

    // ---- 구독: the main window's queue ----
    async function subscribeMissing(files, ask) {
      files = [...new Set(files)];
      if (!files.length) return;
      if (ask && files.length > 1) {
        const go = await choiceModal(t('vw.subTitle'), t('vw.subText', { n: files.length }), [
          { key: 'no', text: t('modal.cancel') }, { key: 'yes', text: t('vw.subGo'), primary: true }]);
        if (go !== 'yes') return;
      }
      await window.api.vwSubscribe(files.map((f) => [f, ghostWorkshopId(f)]));
      setStatus(t('vw.subSent', { n: files.length }), 'success');
    }
    openSubscribeQueue = (files) => subscribeMissing(files, false);

    // ---- 새로고침: what I have installed now (mods subscribed meanwhile come in), my list again ----
    async function refresh() {
      config.__vwLive = {
        active: mods.filter((m) => (m.missing ? ghostStore()[m.realFile]?.on !== false : m.active) && !poolMod(m)).map((m) => m.realFile),
        order: loadOrderFiles(),
      };
      const keepBase = baseline;
      await loadMods();
      delete config.__vwLive;
      baseline = keepBase;
      mine = await window.api.vwMyState();
      compare();
      drawBar();
      showTitle();
    }

    // ---- 켜짐 / 꺼짐 (수정): a mod I don't have keeps it in the file's record (ghostStore().on) ----
    function toggleOnOff() {
      const list = selected().filter((m) => !poolMod(m));
      if (!list.some((m) => m.missing)) { toggleSelected(); return; }
      const isOn = (m) => (m.missing ? ghostStore()[m.realFile]?.on !== false : m.active);
      const turnOn = list.some((m) => !isOn(m));
      for (const m of list) {
        if (m.missing) (ghostStore()[m.realFile] ||= { cat: m.category, after: null, ws: ghostWorkshopId(m.realFile) }).on = turnOn;
        else m.active = turnOn;
      }
      commitLayout();
      setStatus(t(turnOn ? 'keys.turnedOn' : 'keys.turnedOff', { count: list.length }), 'success');
    }

    // ---- 파일에서 빼기 (수정): to the hidden column of my mods (placeholders: gone) ----
    function removeFromFile(list = selected()) {
      if (inView()) { note(); return; }
      list = list.filter((m) => !poolMod(m));
      if (!list.length) return;
      for (const m of list) {
        if (m.missing) { delete ghostStore()[m.realFile]; delete modCategories[m.filename]; continue; }
        m.active = false;
        m.parked = false;
        moveMod(m, POOL, null, true);
      }
      selectedMods.clear();
      commitLayout();
      setStatus(t('vw.removed', { n: list.length }), 'success');
    }

    // ---- 보기: nothing changes ----
    const blockIn = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onPoolHeader = (e) => e.target.closest?.(`.category-column[data-category="${POOL}"] .column-header`);
    document.addEventListener('dragstart', (e) => {
      if (inView() && e.target.closest?.('#main-screen')) blockIn(e);
      else if (onPoolHeader(e)) blockIn(e);
    }, true);
    document.addEventListener('drop', (e) => { if (inView() && e.target.closest?.('#main-screen')) blockIn(e); }, true);
    document.addEventListener('click', (e) => {
      const t0 = e.target;
      if (!t0.closest) return;
      // (header controls: ◀ ▶, colour, ✕, sort are spans; − and the width buttons only change the view)
      const headerCtl = t0.closest('.column-header input, .column-header-name-editable, .column-header button:not(.km-min-btn), .column-header .column-move-btn:not(.km-min-btn):not(.km-fit-btn)');
      if (headerCtl && (inView() || onPoolHeader(e))) { blockIn(e); if (inView()) note(); return; }
      if (inView() && (t0.closest('.mod-card input[type="checkbox"]') || t0.closest('#add-category-btn'))) { blockIn(e); note(); }
    }, true);
    document.addEventListener('dblclick', (e) => { if (inView() && e.target.closest?.('#main-screen')) blockIn(e); }, true);
    document.addEventListener('contextmenu', (e) => {
      if ((inView() || onPoolHeader(e)) && e.target.closest?.('.column-header, .order-header')) blockIn(e);
    }, true);
    document.addEventListener('focusin', (e) => { if (inView() && e.target.closest?.('#order-panel input')) e.target.blur(); }, true);
    const _runEdit = runEditCommand;
    runEditCommand = (cmd) => { if (inView() && cmd !== 'selectAll') { note(); return; } _runEdit(cmd); };
    const _hist = runHistoryCommand;
    runHistoryCommand = (cmd) => { if (inView()) return; _hist(cmd); };
    Object.assign(SHORTCUT_ACTIONS, {
      save: () => saveAs(),
      exportList: () => saveAs(),
      exportAdvanced: () => exportAdvancedModal(),
      toggle: () => { if (inView()) note(); else toggleOnOff(); },
      deleteFiles: () => removeFromFile(),
      importList: () => {}, importString: () => {}, viewList: () => {}, translator: () => {}, settings: () => {},
    });

    // ---- the mod menu: 창작마당 페이지 (보기) / 파일에서 빼기 (수정) ----
    const menu = document.getElementById('mod-context-menu');
    for (const id of ['mod-context-open-folder', 'mod-context-subscribe']) document.getElementById(id)?.classList.add('vw-keep');
    const item = (id, onClick) => {
      const el = document.createElement('div');
      el.id = id;
      el.className = 'context-item vw-keep';
      el.addEventListener('click', () => { hideContextMenu(); onClick(); });
      menu?.insertBefore(el, menu.firstChild);
      return el;
    };
    const pageItem = item('vw-ctx-page', () => {
      for (const m of selected().slice(0, 10)) {
        const ws = m.missing ? ghostWorkshopId(m.realFile) : workshopIdOf(m);
        const url = ws ? 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + ws : m.url;
        if (url) window.api.openExternal(url);
      }
    });
    const removeItem = item('vw-ctx-remove', () => removeFromFile());
    document.addEventListener('contextmenu', () => {
      pageItem.textContent = t('vw.ctxPage');
      removeItem.textContent = t('vw.ctxRemove');
    }, true);

    // ---- after every drawing: pool mods stay off, marks, the bar, the title ----
    const _render = renderColumns;
    renderColumns = function (...args) {
      for (const m of mods) if (poolMod(m)) { m.active = false; m.parked = false; }
      const r = _render.apply(this, args);
      drawPool();
      // the count by the title: the file's mods only (not my others in the hidden column)
      const listed = mods.filter((m) => !poolMod(m));
      modCount.textContent = t('modCount', { total: listed.length, active: listed.filter((m) => m.active).length });
      compare();
      drawBar();
      showTitle();
      return r;
    };

    // ---- start: the file as it was opened is "saved" ----
    const _load = loadMods;
    let first = true;
    loadMods = async function (...args) {
      if (first && config?.vw) {
        POOL = config.vw.pool;
        fileName = config.vw.name;
        const pool = catById(POOL);
        if (pool) pool.name = t('vw.pool');
      }
      const r = await _load.apply(this, args);
      if (first) {
        first = false;
        mine = await window.api.vwMyState();
        baseline = captureLayout();
        compare();
        setMode(false);
      }
      return r;
    };
    // the language: the pool's name follows
    const _lang = typeof changeLanguage === 'function' ? changeLanguage : null;
    if (_lang) changeLanguage = async (l) => { await _lang(l); const p = catById(POOL); if (p) p.name = t('vw.pool'); drawBar(); drawSummary(); showTitle(); };

    // ---- the window's own keys (a list window has no menu): minimize, maximize / restore, full screen ----
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const act = ctrl && !e.altKey && e.code === 'KeyM' ? (e.shiftKey ? 'max' : 'min') : !ctrl && !e.altKey && !e.shiftKey && e.code === 'F11' ? 'full' : null;
      if (!act) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.api.vwWin(act);
    }, true);

    // ---- closing: unsaved changes are asked about ----
    window.api.onVwConfirmClose(async () => {
      window.api.vwCloseAck();
      if (!dirty()) { window.api.vwCloseNow(); return; }
      const c = await choiceModal(t('vw.closeTitle'), t('vw.closeText', { name: fileName }), [
        { key: 'cancel', text: t('modal.cancel') }, { key: 'discard', text: t('vw.closeDiscard') }, { key: 'save', text: t('vw.closeSave'), primary: true }]);
      if (c === 'save' && (await saveAs())) window.api.vwCloseNow();
      else if (c === 'discard') window.api.vwCloseNow();
      else window.api.vwCloseCancel();
    });
  })();
}
