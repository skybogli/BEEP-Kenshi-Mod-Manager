// 번역 검수: every job's review file — look, fix, pick, then put the picked ones into the
// glossary, the _KO patch mod or the original mod. The files are listed on the left (folds):
// the newest 5 at once, the rest by mod under [이전 파일 더 보기], or found by the search box;
// a row is read (its @ lines, how many places) only when it is shown (reviewInfo).
DLG.review = async function review() {
  const { h, open, ask, alert, menu } = DLG;
  const ORIGINS = ['용어집', '구글', '저장', '기존', '한국어', '미번역']; // as review files write them (shown with T('origin.…'))
  const A = (key, vars) => esc(T(key, vars));
  const PAGE = 200;
  const files = await window.kmt.reviewFiles();
  if (!files.length) { alert(T('rv.title'), T('rv.none')); return; }

  const d = h(`<div class="tr-dialog" style="width:min(1300px,100%);height:100%">
    <div class="tr-dialog-body rv-split">
      <div class="rv-side" data-side><button class="rv-side-toggle" data-side-toggle></button>
        <div class="rv-side-body"><input class="tr-input rv-side-search" data-side-search spellcheck="false" placeholder="${A('rv.findFile')}"><div class="rv-side-list" data-side-list></div></div></div>
      <div class="rv-main">
      <div class="rv-meta-row"><div class="rv-meta" data-meta></div>
        <span class="rv-zoom" title="${A('rv.zoom')}"><button class="tr-btn tr-small" data-zoom-out title="${A('rv.zoomOut')}">A−</button><input class="tr-input" type="number" min="60" max="250" step="10" data-zoom><span class="tr-muted">%</span><button class="tr-btn tr-small" data-zoom-in title="${A('rv.zoomIn')}">A+</button></span></div>
      <div class="rv-filters" data-filters>
        <span class="rv-filter-label">${A('rv.filter')}</span><span data-origins style="display:flex;gap:4px"></span>
        <select class="tr-input" style="max-width:170px" data-type></select>
        <select class="tr-input" style="max-width:190px" data-field></select>
        <input class="tr-input" style="max-width:260px" placeholder="${A('rv.search')}" data-search spellcheck="false">
        <label class="tr-check tr-inline"><input type="checkbox" data-only-checked> ${A('rv.onlyChecked')}</label>
        <label class="tr-check tr-inline"><input type="checkbox" data-only-edited> ${A('rv.onlyEdited')}</label>
        <button class="tr-btn tr-small" data-filter-clear title="${A('rv.filterClearTip')}">${A('rv.filterClear')}</button>
      </div>
      <div class="rv-table-wrap"><table class="rv-table"><colgroup><col style="width:30px"><col style="width:150px"><col style="width:130px"><col><col><col style="width:64px"><col style="width:30px"></colgroup>
        <thead><tr><th><input type="checkbox" data-page-all title="${A('rv.pageAll')}"></th><th>String ID</th><th>${A('rv.col.kind')}</th><th>${A('rv.col.src')}</th><th>${A('rv.col.dst')}</th><th>${A('rv.col.origin')}</th><th></th></tr></thead><tbody data-rows></tbody></table></div>
      <div class="rv-pager"><button class="tr-btn tr-small" data-prev>◀</button><span data-page></span><button class="tr-btn tr-small" data-next>▶</button>
        <span class="tr-grow"></span><span class="rv-toast" data-toast></span><span class="tr-muted" data-count></span>
        <button class="tr-btn tr-small" data-sel-menu>${A('rv.selMenu')}</button></div>
      </div>
    </div>
    <div class="tr-dialog-foot"><button class="tr-btn" data-save-file title="${A('rv.saveFileTip')}">${A('rv.saveFile')}</button><span class="tr-grow"></span>
      <span class="rv-act-label" data-act-label></span>
      <button class="tr-btn" data-to-glossary title="${A('rv.toGlossaryTip')}">${A('rv.toGlossary')}</button>
      <button class="tr-btn" data-to-patch title="${A('rv.toPatchTip')}">${A('rv.toPatch')}</button>
      <button class="tr-btn" data-to-inplace title="${A('rv.toInplaceTip')}">${A('rv.toInplace')}</button>
      <span class="tr-sep"></span>
      <button class="tr-btn" data-close>${A('common.close')}</button></div></div>`);

  let cur = null; // { path, meta, entries, dirty }
  let page = 0;
  let lastChecked = null; // the row whose box was clicked last (Shift+click: the range from it)
  const removed = []; // rows taken out: [{ entry, at }] for Ctrl+Z
  const filt = { origins: new Set(ORIGINS), type: '', field: '', q: '', onlyChecked: false, onlyEdited: false };
  const fieldLabel = (f) => (f === '@name' ? 'Base - name' : f);

  // ---- the file list (left) ----
  const side = d.querySelector('[data-side]');
  const sideList = d.querySelector('[data-side-list]');
  const sideSearch = d.querySelector('[data-side-search]');
  const info = new Map(); // path -> { meta, n } (read when its row is shown)
  const openMods = new Set(); // mod groups opened under 이전 파일
  let showOlder = false;
  const RECENT = 5;
  const p2 = (n) => String(n).padStart(2, '0');
  const when = (f) => {
    if (f.stamp) return f.stamp; // (the job's time, in the file name)
    const c = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(info.get(f.path)?.meta.created || '');
    if (c) return `${c[1].slice(2)}${c[2]}${c[3]} ${c[4]}${c[5]}${c[6]}`;
    const t = new Date(f.at);
    return `${p2(t.getFullYear() % 100)}${p2(t.getMonth() + 1)}${p2(t.getDate())} ${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`;
  };
  const sideFolded = () => { try { return localStorage.getItem('kmt.rvSideFolded') === '1'; } catch { return false; } };
  side.classList.toggle('collapsed', sideFolded());
  d.querySelector('[data-side-toggle]').addEventListener('click', () => {
    const f = !side.classList.contains('collapsed');
    side.classList.toggle('collapsed', f);
    try { localStorage.setItem('kmt.rvSideFolded', f ? '1' : '0'); } catch { /* fine */ }
    drawList();
  });
  const fileRow = (f) => {
    const it = info.get(f.path);
    const on = cur && cur.path === f.path;
    const r = h('<div class="rv-file"><span class="rv-file-mod"></span><span class="rv-file-when"></span><span class="rv-file-n"></span></div>');
    r.classList.toggle('on', !!on);
    r.dataset.path = f.path;
    r.querySelector('.rv-file-mod').textContent = f.mod + (on && cur.dirty ? ' *' : '');
    r.querySelector('.rv-file-when').textContent = when(f);
    r.querySelector('.rv-file-n').textContent = it ? T('rv.fileN', { n: it.n }) : '';
    r.title = T('rv.fileTip', { path: f.path, mode: it ? T(it.meta.mode === 'inplace' ? 'rv.modeInplace' : 'rv.modePatch') : '', n: it ? it.n : '?' });
    r.addEventListener('click', () => load(f));
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(e.clientX, e.clientY, [{ text: T('rv.showInFolder'), fn: () => window.kmt.showItem(f.path) }]); });
    return r;
  };
  // the rows shown now get their details (once each), then the list is drawn again
  let asking = false;
  const needInfo = async (list) => {
    const want = list.filter((f) => !info.has(f.path)).map((f) => f.path);
    if (!want.length || asking) return;
    asking = true;
    try { for (const x of await window.kmt.reviewInfo(want)) info.set(x.path, x); } finally { asking = false; }
    drawList();
  };
  function drawList() {
    const open = !side.classList.contains('collapsed');
    d.querySelector('[data-side-toggle]').innerHTML = `<span class="rv-side-arrow">${open ? '◂' : '▸'}</span> <span>${esc(T('rv.files', { n: files.length }))}</span>`;
    if (!open) return;
    sideList.innerHTML = '';
    const shown = [];
    const q = sideSearch.value.trim().toLowerCase();
    if (q) {
      const hits = files.filter((f) => f.name.toLowerCase().includes(q));
      if (!hits.length) sideList.appendChild(Object.assign(h('<div class="rv-side-empty"></div>'), { textContent: T('rv.noFile') }));
      for (const f of hits.slice(0, 300)) { sideList.appendChild(fileRow(f)); shown.push(f); }
    } else {
      sideList.appendChild(Object.assign(h('<div class="rv-side-head"></div>'), { textContent: T('rv.recent') }));
      for (const f of files.slice(0, RECENT)) { sideList.appendChild(fileRow(f)); shown.push(f); }
      const older = files.slice(RECENT);
      if (older.length && !showOlder) {
        const b = h('<button class="tr-btn tr-small rv-side-more"></button>');
        b.textContent = T('rv.older', { n: older.length });
        b.addEventListener('click', () => { showOlder = true; drawList(); });
        sideList.appendChild(b);
      } else if (older.length) {
        sideList.appendChild(Object.assign(h('<div class="rv-side-head"></div>'), { textContent: T('rv.olderHead', { n: older.length }) }));
        // by mod, the mod worked on last first; a group shows its files when opened
        const groups = new Map();
        for (const f of older) { if (!groups.has(f.mod)) groups.set(f.mod, []); groups.get(f.mod).push(f); }
        for (const [mod, list] of groups) {
          const opened = openMods.has(mod) || (cur && list.some((f) => f.path === cur.path));
          const g = h('<div class="rv-group"><span class="rv-group-arrow"></span><span class="rv-file-mod"></span><span class="rv-file-n"></span></div>');
          g.querySelector('.rv-group-arrow').textContent = opened ? '▾' : '▸';
          g.querySelector('.rv-file-mod').textContent = mod;
          g.querySelector('.rv-file-n').textContent = String(list.length);
          g.title = mod;
          g.addEventListener('click', () => { if (openMods.has(mod)) openMods.delete(mod); else openMods.add(mod); drawList(); });
          sideList.appendChild(g);
          if (opened) for (const f of list) { const r = fileRow(f); r.classList.add('in-group'); sideList.appendChild(r); shown.push(f); }
        }
      }
    }
    needInfo(shown);
  }
  // the open file's row: marked, and * while it has unsaved edits
  const markCurrent = () => {
    sideList.querySelectorAll('.rv-file').forEach((r) => {
      const on = cur && r.dataset.path === cur.path;
      r.classList.toggle('on', !!on);
      const f = files.find((x) => x.path === r.dataset.path);
      if (f) r.querySelector('.rv-file-mod').textContent = f.mod + (on && cur.dirty ? ' *' : '');
    });
  };
  let qTimer2 = null;
  sideSearch.addEventListener('input', () => { clearTimeout(qTimer2); qTimer2 = setTimeout(drawList, 150); });
  const first = () => load(files[0]);

  function showMeta() {
    if (!cur) return;
    // the language this review file was made for (none written: Korean)
    const rt = { target: cur.meta.target || 'ko' };
    d.querySelectorAll('[data-origins] .rv-chip').forEach((c) => { c.textContent = T('origin.' + c.dataset.o, rt); });
    const tp = d.querySelector('[data-to-patch]');
    tp.textContent = T('rv.toPatch', rt);
    tp.title = T('rv.toPatchTip', rt);
    d.querySelector('[data-meta]').textContent = T('rv.meta', { mod: cur.meta.mod || '?', mode: T(cur.meta.mode === 'inplace' ? 'rv.modeInplace' : 'rv.modePatch'), created: cur.meta.created || '', n: cur.entries.length });
  }
  async function load(f) {
    if (cur && cur.path === f.path) return;
    if (cur && cur.dirty && !(await confirmLeave())) return;
    BUSY.show(T('busy.review'));
    let r;
    try { r = await window.kmt.reviewRead(f.path); } finally { BUSY.hide(); }
    cur = { path: f.path, meta: r.meta, entries: r.entries.map((e, i) => ({ ...e, i, checked: false })), dirty: false };
    removed.length = 0;
    showMeta();
    const types = [...new Set(cur.entries.map((e) => e.type))].sort();
    const fields = [...new Set(cur.entries.map((e) => e.field))].sort();
    const fill = (sel, all, list, fmt = (x) => x) => { sel.innerHTML = ''; sel.appendChild(Object.assign(document.createElement('option'), { value: '', textContent: all })); for (const x of list) sel.appendChild(Object.assign(document.createElement('option'), { value: x, textContent: fmt(x) })); };
    fill(d.querySelector('[data-type]'), T('rv.type'), types);
    fill(d.querySelector('[data-field]'), T('rv.field'), fields, fieldLabel);
    filt.type = filt.field = '';
    page = 0;
    draw();
    drawList();
  }
  async function confirmLeave() {
    const ok = await ask(T('rv.leaveTitle'), T('rv.leaveText'), T('rv.leaveOk'));
    open(d);
    return ok;
  }

  // a filter is on (some rows are hidden by it)
  const filtered = () => filt.origins.size !== ORIGINS.length || !!filt.type || !!filt.field || !!filt.q || filt.onlyChecked || filt.onlyEdited;
  const visible = () => {
    if (!cur) return [];
    const q = filt.q.toLowerCase();
    return cur.entries.filter((e) => filt.origins.has(e.origin) && (!filt.type || e.type === filt.type) && (!filt.field || e.field === filt.field)
      && (!filt.onlyChecked || e.checked) && (!filt.onlyEdited || e.edited)
      && (!q || e.src.toLowerCase().includes(q) || e.dst.toLowerCase().includes(q) || e.sid.toLowerCase().includes(q)));
  };

  // a short note next to the count (copied, deleted …)
  let toastTimer = null;
  const toast = (text) => {
    const t = d.querySelector('[data-toast]');
    t.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.textContent = ''; }, 2500);
  };
  // click a String ID / kind / field / source text: copied (not when text is being selected)
  const copyCell = (el, text) => {
    el.classList.add('rv-copy');
    el.title = T('rv.copyTip');
    el.addEventListener('click', () => {
      if (String(window.getSelection() || '')) return;
      window.kmt.copyText(text);
      el.classList.add('copied');
      setTimeout(() => el.classList.remove('copied'), 600);
      toast(T('rv.copied', { text: text.replace(/\s+/g, ' ').slice(0, 40) + (text.length > 40 ? '…' : '') }));
    });
  };
  function removeRow(e) {
    const at = cur.entries.indexOf(e);
    if (at < 0) return;
    cur.entries.splice(at, 1);
    removed.push({ entry: e, at });
    cur.dirty = true;
    showMeta();
    draw();
    toast(T('rv.rowDeleted'));
  }
  function undoRemove() {
    const last = removed.pop();
    if (!last) return;
    cur.entries.splice(Math.min(last.at, cur.entries.length), 0, last.entry);
    showMeta();
    draw();
    toast(T('rv.rowBack'));
  }

  function draw() {
    const rows = d.querySelector('[data-rows]');
    const vis = visible();
    const pages = Math.max(1, Math.ceil(vis.length / PAGE));
    page = Math.min(page, pages - 1);
    const slice = vis.slice(page * PAGE, page * PAGE + PAGE);
    rows.innerHTML = '';
    for (const e of slice) {
      const tr = h(`<tr tabindex="-1"><td><input type="checkbox"></td><td class="tr-muted"><span></span></td><td><div><span></span></div><div class="tr-muted"><span></span></div></td><td class="src"><span></span></td><td><textarea spellcheck="false"></textarea></td><td><span class="rv-origin"></span></td><td><button class="tr-x" title="${A('rv.rowDel')}">✕</button></td></tr>`);
      const cb = tr.querySelector('input');
      cb.checked = e.checked;
      cb.addEventListener('click', (ev) => {
        const vis = visible();
        const from = lastChecked ? vis.indexOf(lastChecked) : -1;
        const to = vis.indexOf(e);
        if (ev.shiftKey && from >= 0 && to >= 0 && from !== to) {
          for (let k = Math.min(from, to); k <= Math.max(from, to); k++) vis[k].checked = cb.checked;
          lastChecked = e;
          draw();
          return;
        }
        e.checked = cb.checked;
        lastChecked = e;
        counts();
      });
      const sid = tr.children[1].firstChild;
      sid.textContent = e.sid;
      copyCell(sid, e.sid);
      const ty = tr.children[2].children[0].firstChild;
      ty.textContent = e.type;
      copyCell(ty, e.type);
      const fl = tr.children[2].children[1].firstChild;
      fl.textContent = fieldLabel(e.field);
      copyCell(fl, fieldLabel(e.field));
      const src = tr.children[3].firstChild;
      src.textContent = e.src;
      copyCell(src, e.src);
      const ta = tr.querySelector('textarea');
      ta.value = e.dst;
      ta.rows = Math.min(6, Math.max(1, e.dst.split('\n').length, Math.ceil(e.src.length / 60)));
      ta.addEventListener('input', () => { e.dst = ta.value; e.edited = true; e.checked = true; cb.checked = true; cur.dirty = true; tr.classList.add('edited'); counts(); });
      const o = tr.querySelector('.rv-origin');
      o.textContent = T('origin.' + e.origin, { target: cur.meta.target || 'ko' });
      o.classList.add('o-' + e.origin);
      if (e.edited) tr.classList.add('edited');
      tr.querySelector('.tr-x').addEventListener('click', () => removeRow(e));
      // Delete on the row (not while typing in its translation): the row goes
      tr.addEventListener('mousedown', (ev) => { if (!ev.target.closest('textarea, input, button')) tr.focus(); });
      tr.addEventListener('keydown', (ev) => { if (ev.key === 'Delete' && !ev.target.closest('textarea, input')) { ev.preventDefault(); removeRow(e); } });
      rows.appendChild(tr);
    }
    d.querySelector('[data-page]').textContent = filtered() ? T('rv.pageFiltered', { p: page + 1, pages, n: vis.length, all: cur.entries.length }) : T('rv.page', { p: page + 1, pages, n: vis.length });
    d.querySelector('[data-filters]').classList.toggle('active', filtered());
    d.querySelector('[data-prev]').disabled = page === 0;
    d.querySelector('[data-next]').disabled = page >= pages - 1;
    d.querySelector('[data-page-all]').checked = slice.length > 0 && slice.every((e) => e.checked);
    counts();
  }
  function counts() {
    if (!cur) return;
    const n = cur.entries.filter((e) => e.checked).length;
    d.querySelector('[data-count]').textContent = T('rv.count', { n, all: cur.entries.length }) + (cur.dirty ? T('rv.unsaved') : '');
    markCurrent();
    d.querySelector('[data-act-label]').textContent = n ? T('rv.act', { n }) : T('rv.actNone');
    for (const k of ['to-glossary', 'to-patch', 'to-inplace']) d.querySelector(`[data-${k}]`).disabled = !n;
  }

  // the text size of the table (kept for the next time)
  const zoomIn = d.querySelector('[data-zoom]');
  let zoom = 100;
  try { zoom = Number(localStorage.getItem('kmt.reviewZoom')) || 100; } catch { /* default */ }
  const setZoom = (z) => {
    zoom = Math.max(60, Math.min(250, Math.round(z / 10) * 10 || 100));
    zoomIn.value = zoom;
    d.querySelector('.rv-table').style.fontSize = `${(12 * zoom) / 100}px`;
    try { localStorage.setItem('kmt.reviewZoom', String(zoom)); } catch { /* not kept */ }
  };
  setZoom(zoom);
  d.querySelector('[data-zoom-out]').addEventListener('click', () => setZoom(zoom - 10));
  d.querySelector('[data-zoom-in]').addEventListener('click', () => setZoom(zoom + 10));
  zoomIn.addEventListener('change', () => setZoom(Number(zoomIn.value)));
  d.querySelector('.rv-table-wrap').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });

  const oc = d.querySelector('[data-origins]');
  for (const o of ORIGINS) {
    const c = h('<span class="rv-chip on"></span>');
    c.dataset.o = o; // (named when a file is loaded: '한국어' is that file's language)
    c.classList.add('o-' + o);
    c.addEventListener('click', () => { if (filt.origins.has(o)) filt.origins.delete(o); else filt.origins.add(o); c.classList.toggle('on', filt.origins.has(o)); page = 0; draw(); });
    oc.appendChild(c);
  }
  d.querySelector('[data-type]').addEventListener('change', (e) => { filt.type = e.target.value; page = 0; draw(); });
  d.querySelector('[data-field]').addEventListener('change', (e) => { filt.field = e.target.value; page = 0; draw(); });
  let qTimer = null;
  d.querySelector('[data-search]').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { filt.q = e.target.value; page = 0; draw(); }, 200); });
  d.querySelector('[data-only-checked]').addEventListener('change', (e) => { filt.onlyChecked = e.target.checked; page = 0; draw(); });
  d.querySelector('[data-only-edited]').addEventListener('change', (e) => { filt.onlyEdited = e.target.checked; page = 0; draw(); });
  d.querySelector('[data-filter-clear]').addEventListener('click', () => {
    filt.origins = new Set(ORIGINS);
    oc.querySelectorAll('.rv-chip').forEach((c) => c.classList.add('on'));
    filt.type = filt.field = filt.q = '';
    filt.onlyChecked = filt.onlyEdited = false;
    d.querySelector('[data-type]').value = '';
    d.querySelector('[data-field]').value = '';
    d.querySelector('[data-search]').value = '';
    d.querySelector('[data-only-checked]').checked = false;
    d.querySelector('[data-only-edited]').checked = false;
    page = 0;
    draw();
  });
  d.querySelector('[data-prev]').addEventListener('click', () => { page--; draw(); d.querySelector('.rv-table-wrap').scrollTop = 0; });
  d.querySelector('[data-next]').addEventListener('click', () => { page++; draw(); d.querySelector('.rv-table-wrap').scrollTop = 0; });
  d.querySelector('[data-page-all]').addEventListener('change', (e) => { const vis = visible().slice(page * PAGE, page * PAGE + PAGE); for (const x of vis) x.checked = e.target.checked; draw(); });
  // 모두 선택 ▾: one button for the ways of picking
  d.querySelector('[data-sel-menu]').addEventListener('click', (ev) => {
    if (!cur) return;
    const r = ev.target.getBoundingClientRect();
    const vis = visible();
    const f = filtered();
    // (one page at a time: the box at the top of the table)
    const items = [
      { text: T(f ? 'rv.selAllF' : 'rv.selAll', { n: vis.length }), fn: () => { for (const x of vis) x.checked = true; draw(); } },
      { text: T(f ? 'rv.selNoneF' : 'rv.selNone'), fn: () => { for (const x of vis) x.checked = false; draw(); } },
      { text: T('rv.selInvert'), fn: () => { for (const x of vis) x.checked = !x.checked; draw(); } },
    ];
    if (f) items.push('sep', { text: T('rv.selClearAll'), fn: () => { for (const x of cur.entries) x.checked = false; draw(); } });
    DLG.menu(r.right - 230, r.top - 4 - (items.length) * 30, items);
  });
  // Ctrl+Z outside the text boxes: the last deleted row comes back
  const undoKey = (e) => {
    if (!d.isConnected) { document.removeEventListener('keydown', undoKey, true); return; }
    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyZ' && !e.target.closest?.('textarea, input') && removed.length && topPage() === rvPage) { e.preventDefault(); e.stopPropagation(); undoRemove(); }
  };
  document.addEventListener('keydown', undoKey, true);

  const picked = () => (cur ? cur.entries.filter((e) => e.checked) : []);
  const strip = (e) => ({ sid: e.sid, type: e.type, field: e.field, origin: e.origin, edited: e.edited, src: e.src, dst: e.dst });
  async function saveFile() {
    if (!cur) return;
    await window.kmt.reviewWrite(cur.path, cur.meta, cur.entries.map(strip));
    cur.dirty = false;
    removed.length = 0;
    counts();
  }
  d.querySelector('[data-save-file]').addEventListener('click', async () => { await saveFile(); appendLog([T('rv.logSaved', { path: cur.path })]); toast(T('rv.fileSaved')); });
  d.querySelector('[data-to-glossary]').addEventListener('click', async () => {
    const list = picked().filter((e) => e.dst.trim());
    if (!list.length) { await alert(T('rv.toGlossary'), T('rv.glossNone')); return; }
    try {
      const r = await window.kmt.glossaryUpdate(list.map((e) => [e.src, e.dst]), cur.meta.target || 'ko');
      await alert(T('rv.toGlossary'), T('rv.glossDone', { path: r.path, r: r.replaced, a: r.added }) + (r.skipped ? T('rv.glossSkipped', { n: r.skipped }) : '') + (r.backup ? T('rv.glossBackup', { path: r.backup }) : ''));
      appendLog([T('rv.logGloss', { path: r.path, r: r.replaced, a: r.added, s: r.skipped })]);
    } catch (e) { await alert(T('rv.glossFailed'), e.message); }
  });
  const apply = (mode) => async () => {
    const list = picked();
    if (!list.length) return;
    if (cur.dirty) await saveFile();
    const what = T(mode === 'inplace' ? 'rv.putWhatInplace' : 'rv.putWhatPatch', { target: cur.meta.target || 'ko' });
    if (!(await ask(T('rv.putTitle'), T('rv.putText', { n: list.length, what, mod: cur.meta.mod }), T('rv.putOk')))) return;
    const r = await window.kmt.reviewApply(cur.meta, list.map(strip), mode);
    if (r.error) await alert(T('rv.putFailed'), r.error);
    else await alert(T('rv.putDone'), T('rv.putResult', { path: r.path, n: r.changed }) + (r.same ? T('rv.putSame', { n: r.same }) : '') + (r.missing ? T('rv.putMissing', { n: r.missing }) : '') + (r.backup ? T('rv.putBackup', { path: r.backup }) : ''));
  };
  d.querySelector('[data-to-patch]').addEventListener('click', apply('patchmod'));
  d.querySelector('[data-to-inplace]').addEventListener('click', apply('inplace'));
  d.dataset.modal = '1'; // Escape doesn't close it (unsaved edits)
  // 닫기 (and the title bar's ✕, Esc): unsaved edits are asked about first
  const rvPage = { titleKey: 'rv.title', kind: 'review', close: async () => false };
  const close = open(d, () => popPage(rvPage));
  pushPage(rvPage);
  rvPage.close = async () => {
    if (cur && cur.dirty && !(await confirmLeave())) return false;
    close();
    return true;
  };
  d.querySelector('[data-close]').addEventListener('click', () => rvPage.close());
  if (first) await first();
};
