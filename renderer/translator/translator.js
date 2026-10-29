// The translator window: the mods to work on, how, the log and progress.
// Dialogs (settings, review, backups) are in translator-dialogs.js.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseName = (p) => String(p || '').split(/[\\/]/).pop();

const TR = {
  init: null, // what kmt-init gave
  settings: null,
  mods: [], // [{ path, state: 'wait'|'run'|'done'|'none'|'err', note }]
  running: null,
  jobStart: 0,
};

const stateName = (st) => T('state.' + st);
// A finished job's time ('261027 213440') and what it made: the patch mod's language (KO, JA …),
// Bak (the original edited, kept as .bak), Patch (a field-copy patch), Glo (the extracted glossary)
const doneStamp = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const doneTag = (d) => (d.mode === 'patchmod' ? (/_([A-Za-z]{2})\.mod$/i.exec(d.path)?.[1] || 'KO').toUpperCase() : { inplace: 'Bak', copypatch: 'Patch', extract: 'Glo' }[d.mode] || d.mode);

// ---- the list of mods to work on ----
// Click selects (Ctrl adds / takes out one, Shift a range); dragging moves the selected ones,
// Alt+↑ / ↓ too; Delete takes them out. Up to 10 rows the window grows with the list; past that
// the list scrolls, and the handle under it drags it taller (double-click: all rows / back).
const ROW_H = 26;
const AUTO_ROWS = 10;
const MIN_ROWS = 4;
TR.sel = new Set();
TR.anchor = -1;
TR.listH = 0; // a height dragged with the handle (0 = automatic)
TR.undo = []; // earlier lists (adding, taking out, moving), for Ctrl+Z / Ctrl+Y
TR.redo = [];

// ---- undo / redo of the list ----
function remember() {
  TR.undo.push(TR.mods.slice());
  if (TR.undo.length > 100) TR.undo.shift();
  TR.redo = [];
  showHistory();
}
function showHistory() {
  const badge = (n) => (n ? (n > 99 ? '99+' : String(n)) : '');
  $('undo-count').textContent = badge(TR.undo.length);
  $('redo-count').textContent = badge(TR.redo.length);
  $('btn-undo').disabled = !TR.undo.length;
  $('btn-redo').disabled = !TR.redo.length;
}
function historyStep(back) {
  const from = back ? TR.undo : TR.redo;
  const to = back ? TR.redo : TR.undo;
  if (!from.length) return;
  to.push(TR.mods.slice());
  let list = from.pop();
  // a mod being worked on stays in the list
  const run = TR.mods.find(isRunning);
  if (run && !list.includes(run)) list = [...list, run];
  TR.mods = list;
  TR.anchor = -1;
  renderMods();
  showHistory();
  window.kmt.reorder(TR.mods.map((m) => m.path));
}

function addMods(paths) {
  const fresh = [];
  for (const p of paths) {
    if (!p || !/\.mod$/i.test(p)) continue;
    if (!TR.mods.some((m) => m.path.toLowerCase() === p.toLowerCase()) && !fresh.some((m) => m.path.toLowerCase() === p.toLowerCase())) fresh.push({ path: p, state: 'wait', note: '' });
  }
  if (fresh.length) { remember(); TR.mods.push(...fresh); }
  renderMods();
}
const isRunning = (m) => !!(TR.running && TR.running.mod === m.path);

function renderMods() {
  const el = $('mods-list');
  $('mods-count').textContent = !TR.mods.length ? '' : TR.sel.size ? T('mods.countSel', { n: TR.mods.length, s: TR.sel.size }) : T('mods.count', { n: TR.mods.length });
  for (const p of [...TR.sel]) if (!TR.mods.some((m) => m.path === p)) TR.sel.delete(p);
  if (!TR.mods.length) {
    el.innerHTML = `<div class="tr-empty">${esc(T('mods.empty'))}</div>`;
  } else {
    el.innerHTML = '';
    TR.mods.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'tr-mod' + (TR.sel.has(m.path) ? ' sel' : '');
      row.dataset.i = i;
      const st = isRunning(m) ? 'run' : m.state;
      // done: the name, when, and what was made ([KO] / [Bak] / [Patch] / [Glo]: a click opens it,
      // a .mod in FCS); else the name and where the mod is
      const done = st === 'done' && m.done;
      row.innerHTML = `<span class="tr-mod-state st-${st === 'queued' ? 'wait' : st}">${esc(stateName(st))}</span>
        <span class="tr-mod-name" title="${esc(m.path)}">${esc(baseName(m.path).replace(/\.mod$/i, ''))}</span>
        ${done ? '<span class="tr-grow"></span>' : `<span class="tr-mod-path" title="${esc(m.path)}">${esc(m.path)}</span>`}
        ${done ? `<button class="tr-mod-done" title="${esc(T('mods.openDone', { path: m.done.path }))}">${esc(doneStamp(m.done.at))} [${esc(doneTag(m.done))}]</button>` : ''}
        ${m.note && !done ? `<span class="tr-mod-note" title="${esc(m.note)}">${esc(m.note)}</span>` : ''}
        <button class="tr-x" title="${esc(T('mods.remove'))}">✕</button>`;
      row.querySelector('.tr-mod-path')?.addEventListener('dblclick', () => window.kmt.showItem(m.path));
      row.querySelector('.tr-mod-done')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const r = await window.kmt.openResult(m.done.path);
        if (r === 'no-fcs') DLG.alert(T('mods.noFcsTitle'), T('mods.noFcs', { path: m.done.path }));
        else if (r === 'no-file') DLG.alert(T('mods.noFileTitle'), T('mods.noFile', { path: m.done.path }));
      });
      row.querySelector('.tr-x').addEventListener('click', () => removeMods([m]));
      el.appendChild(row);
    });
  }
  sizeList();
}

function removeMods(list) {
  const out = new Set(list.filter((m) => !isRunning(m)));
  if (!out.size) return;
  remember();
  TR.mods = TR.mods.filter((m) => !out.has(m));
  for (const m of out) TR.sel.delete(m.path);
  TR.anchor = -1;
  renderMods();
}

// The list's height; the window grows / shrinks by as much as the top part does.
function listHeight() {
  const n = TR.mods.length;
  const auto = Math.max(MIN_ROWS, Math.min(n, AUTO_ROWS)) * ROW_H + 2;
  const all = Math.max(MIN_ROWS, n) * ROW_H + 2;
  return TR.listH ? Math.min(Math.max(TR.listH, auto), all) : auto;
}
// How tall the list may get: the window can't grow past the screen (TR.area, from the main
// process); maximized, the list only takes the room left in the window.
TR.area = screen.availHeight;
TR.maxed = false;
function listRoom(cur) {
  const logBox = $('log-box');
  if (TR.maxed) {
    const spare = logBox.classList.contains('collapsed') ? innerHeight - contentHeight() : logBox.offsetHeight - 160;
    return cur + Math.max(0, spare);
  }
  return cur + Math.max(0, TR.area - innerHeight);
}
function sizeList() {
  const el = $('mods-list');
  const top = document.querySelector('.tr-top');
  const before = top.offsetHeight;
  const cur = el.offsetHeight || listHeight();
  const want = listHeight();
  el.style.height = (TR.ready && want > cur ? Math.min(want, listRoom(cur)) : want) + 'px';
  const delta = top.offsetHeight - before;
  $('list-grip').classList.toggle('hidden', TR.mods.length <= AUTO_ROWS);
  $('btn-list-all').classList.toggle('hidden', TR.mods.length <= AUTO_ROWS);
  $('btn-list-all').classList.toggle('on', !!TR.listH);
  if (delta && TR.ready) growWindow(delta);
}
async function growWindow(delta) {
  const size = await window.kmt.win('size');
  if (size) { TR.area = size.area; TR.maxed = size.maximized; }
  if (!size || size.maximized) return;
  // log folded: just as tall as what shows; open: the log keeps its height
  window.kmt.win('height', $('log-box').classList.contains('collapsed') ? contentHeight() : size.height + delta);
}

// Rows moved: to the list (and to the waiting jobs, in that order).
function moveSelected(to) {
  const picked = TR.mods.filter((m) => TR.sel.has(m.path));
  if (!picked.length) return;
  const before = TR.mods.slice(0, to).filter((m) => !TR.sel.has(m.path)).length;
  const rest = TR.mods.filter((m) => !TR.sel.has(m.path));
  rest.splice(before, 0, ...picked);
  const changed = rest.some((m, i) => m !== TR.mods[i]);
  if (changed) remember();
  TR.mods = rest;
  renderMods();
  if (changed) window.kmt.reorder(TR.mods.map((m) => m.path));
}
function stepSelected(dir) {
  const idx = TR.mods.map((m, i) => (TR.sel.has(m.path) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return;
  if (dir < 0 && idx[0] === 0) return;
  if (dir > 0 && idx[idx.length - 1] === TR.mods.length - 1) return;
  moveSelected(dir < 0 ? idx[0] - 1 : idx[idx.length - 1] + 2);
  const row = $('mods-list').querySelector('.tr-mod.sel');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function wireList() {
  const el = $('mods-list');
  el.tabIndex = 0;
  let drag = null; // { y, i, moved, plain }
  const rowAt = (y) => {
    const rows = [...el.querySelectorAll('.tr-mod')];
    for (const r of rows) { const b = r.getBoundingClientRect(); if (y < b.top + b.height / 2) return Number(r.dataset.i); }
    return rows.length;
  };
  const marks = () => el.querySelectorAll('.drop-above, .drop-below').forEach((x) => x.classList.remove('drop-above', 'drop-below'));
  el.addEventListener('mousedown', (e) => {
    const row = e.target.closest('.tr-mod');
    if (!row || e.button !== 0 || e.target.closest('.tr-x')) return;
    e.preventDefault();
    el.focus();
    const i = Number(row.dataset.i);
    const p = TR.mods[i].path;
    let plain = false;
    if (e.shiftKey && TR.anchor >= 0) {
      if (!e.ctrlKey) TR.sel.clear();
      const [a, b] = [Math.min(TR.anchor, i), Math.max(TR.anchor, i)];
      for (let k = a; k <= b; k++) TR.sel.add(TR.mods[k].path);
    } else if (e.ctrlKey) {
      if (TR.sel.has(p)) TR.sel.delete(p); else TR.sel.add(p);
      TR.anchor = i;
    } else {
      if (TR.sel.has(p)) plain = true; // a click without moving: only this one (on mouseup)
      else { TR.sel.clear(); TR.sel.add(p); }
      TR.anchor = i;
    }
    renderMods();
    drag = { y: e.clientY, i, moved: false, plain };
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientY - drag.y) < 5) return;
    if (!drag.moved && !TR.sel.has(TR.mods[drag.i]?.path)) { drag = null; return; }
    drag.moved = true;
    el.classList.add('dragging');
    marks();
    const to = rowAt(e.clientY);
    const rows = el.querySelectorAll('.tr-mod');
    if (to < rows.length) rows[to].classList.add('drop-above');
    else if (rows.length) rows[rows.length - 1].classList.add('drop-below');
    // near the edges the list scrolls
    const b = el.getBoundingClientRect();
    if (e.clientY < b.top + 14) el.scrollTop -= 12;
    else if (e.clientY > b.bottom - 14) el.scrollTop += 12;
  });
  document.addEventListener('mouseup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    el.classList.remove('dragging');
    marks();
    if (d.moved) moveSelected(rowAt(e.clientY));
    else if (d.plain) { TR.sel.clear(); TR.sel.add(TR.mods[d.i].path); renderMods(); }
  });
  el.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); stepSelected(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'Delete') { e.preventDefault(); removeMods(TR.mods.filter((m) => TR.sel.has(m.path))); return; }
    if (e.ctrlKey && e.code === 'KeyA') { e.preventDefault(); for (const m of TR.mods) TR.sel.add(m.path); renderMods(); return; }
    if (e.key === 'Escape' && TR.sel.size) { e.stopPropagation(); TR.sel.clear(); renderMods(); }
  });
  // the handle under the list: drag it taller (double-click: all rows / back to 10)
  const grip = $('list-grip');
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = el.offsetHeight;
    const move = (ev) => { TR.listH = Math.max(0, h0 + ev.clientY - y0); sizeList(); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  const showAll = () => { TR.listH = TR.listH ? 0 : TR.mods.length * ROW_H + 2; sizeList(); };
  grip.addEventListener('dblclick', showAll);
  $('btn-list-all').addEventListener('click', showAll); // one click: every row at once (again: back to 10)
  $('btn-undo').addEventListener('click', () => historyStep(true));
  $('btn-redo').addEventListener('click', () => historyStep(false));
  // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) anywhere but in a text box or a dialog
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select') || !$('overlay').classList.contains('hidden')) return;
    if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); historyStep(true); }
    else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); historyStep(false); }
  });
  showHistory();
  $('btn-clear-mods').addEventListener('click', () => {
    const picked = TR.mods.filter((m) => TR.sel.has(m.path));
    removeMods(picked.length ? picked : TR.mods.filter((m) => ['done', 'none', 'err'].includes(m.state)));
  });
  $('btn-clear-all').addEventListener('click', () => removeMods([...TR.mods]));
}

// ---- loading spinner ----
// BUSY.show(text) / BUSY.hide(); shown at the start until the window is ready. A short wait
// (under 150 ms) doesn't flash it.
const BUSY = (() => {
  let n = 0;
  let timer = null;
  const el = () => $('busy');
  return {
    show(text = T('common.loading')) {
      n++;
      $('busy-text').textContent = text;
      clearTimeout(timer);
      timer = setTimeout(() => el().classList.remove('hidden'), 150);
    },
    hide() {
      n = Math.max(0, n - 1);
      if (n) return;
      clearTimeout(timer);
      el().classList.add('hidden');
    },
  };
})();

// ---- pages (설정 · 번역 검수 · 작성 방법) ----
// A page takes the window under the title bar; the title bar names the top one and its ✕ closes
// it (as the page's own 닫기 does) instead of the window. page = { titleKey, kind, close() -> bool }
const PAGES = [];
function pushPage(p) { PAGES.push(p); showTitle(); }
function popPage(p) { const i = PAGES.indexOf(p); if (i >= 0) PAGES.splice(i, 1); showTitle(); }
const topPage = () => PAGES[PAGES.length - 1];
function showTitle() {
  const top = topPage();
  $('title-main').textContent = top ? T(top.titleKey) : T('app.title');
  $('btn-settings').classList.toggle('dim', PAGES.some((p) => p.kind === 'settings'));
  $('btn-close').title = top ? T('head.closePage', { title: T(top.titleKey) }) : T('head.close');
}
// a page that would replace the open one: the open one is closed first (it may ask, or stay)
async function closePages() {
  while (PAGES.length) { if (!(await topPage().close())) return false; }
  return true;
}

// ---- settings on the main screen ----
const mode = () => document.querySelector('input[name=mode]:checked')?.value || 'patchmod';
async function save(patch) {
  const r = await window.kmt.saveSettings(patch);
  const before = TR.settings.targetNow;
  TR.settings = r.settings;
  TR.init.dataDir = r.dataDir;
  TR.init.dirs = r.dirs;
  TR.init.outRoot = r.outRoot;
  showSummary(r.summary);
  if (r.settings.targetNow !== before) showTarget();
  showOut();
  return r;
}
// The language translated into (settings.targetNow): the words that name it, and the glossary's.
function showTarget() {
  const t = (TR.settings && TR.settings.targetNow) || 'ko';
  I18N.target = t;
  applyI18n();
  // in Korean, for Korean: the names the modes have always had
  const classic = !isEn() && t === 'ko';
  $('mode-patchmod').textContent = T(classic ? 'mode.patchmod' : 'mode.patchmodTl');
  $('mode-inplace').textContent = T(classic ? 'mode.inplace' : 'mode.inplaceTl');
  $('btn-target').textContent = T('mode.target');
  $('glossary-path').value = TR.settings.glossaryPath || '';
  showSummary();
}

// sum = { work, patch } from rules.summaryData: the counts, written here in the window's language
let lastSummary = null;
function showSummary(sum) {
  if (sum) lastSummary = sum;
  const d = lastSummary;
  if (!d || !d.work) return;
  const line = (x, patch) => {
    const parts = [T(patch ? 'sum.pfields' : 'sum.fields', { on: x.fOn, all: x.fAll }), T(patch ? 'sum.pexclude' : 'sum.exclude', { on: x.eOn, all: x.eAll })];
    if (x.nf || x.ne) parts.push(T('sum.custom', { f: x.nf, e: x.ne }));
    if (!patch) parts.push(T('sum.langs', { l: x.langs.length ? x.langs.map((k) => (isEn() ? k : { ko: '한', en: '영', zh: '중', ja: '일', ru: '러' }[k])).join('·') : T('sum.none') }));
    return parts.join(' · ');
  };
  $('settings-summary').innerHTML = `${esc(T(I18N.target === 'ko' && !isEn() ? 'sum.work' : 'sum.workTl', { text: line(d.work, false) }))}<br>${esc(T('sum.patch', { text: line(d.patch, true) }))}`;
}
function showOut() {
  const s = TR.settings;
  $('out-root').value = s.outRoot || '';
  $('out-root').placeholder = TR.init.modsDir ? T('out.phMods', { path: TR.init.modsDir }) : T('out.phNone');
  $('foot').textContent = T(TR.settings.dataLayout === 'single' ? 'foot.data' : 'foot.dataSplit', { path: TR.init.dataDir });
}
// ---- log ----
const MAX_LINES = 20000;
function lineClass(t) {
  if (t.startsWith('# [')) return 'l-sid';
  if (t.startsWith('====')) return 'l-head';
  // (the log is in the manager's language: lib/kmt/lang.js)
  if (/^\[(오류|실패|Error|Failed)\]|\[(실패|Failed)\]|^\[(중지|Stopped)\]/.test(t)) return 'l-err';
  if (/^\[(경고|주의|안내|Warning|Caution|Note)\]|\[(대기|Waiting)\]/.test(t)) return 'l-warn';
  if (/^저장 완료|^\[완료\]|^완료 -|검증 통과|^Saved: |^\[Done\]|^Done - |check passed/.test(t)) return 'l-ok';
  if (/구글 번역:|\] Google: /.test(t)) return 'l-google';
  return '';
}
function appendLog(lines) {
  const el = $('log');
  const frag = document.createDocumentFragment();
  for (const t of lines) {
    const span = document.createElement('span');
    const c = lineClass(t);
    if (c) span.className = c;
    span.textContent = t + '\n';
    frag.appendChild(span);
  }
  el.appendChild(frag);
  while (el.childNodes.length > MAX_LINES) el.removeChild(el.firstChild);
  if ($('log-follow').checked) el.scrollTop = el.scrollHeight;
  const last = lines.filter((t) => t.trim()).pop();
  if (last) $('log-last').textContent = last;
}

// The log folds away (it starts folded); the window gets shorter / taller with it.
let unfoldedHeight = 0;
function contentHeight() {
  const main = document.querySelector('.tr-main');
  const kids = [...main.children];
  const cs = getComputedStyle(main);
  const inner = kids.reduce((n, k) => n + k.offsetHeight, 0) + parseFloat(cs.rowGap || cs.gap || 10) * (kids.length - 1) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  return document.querySelector('.tr-head').offsetHeight + inner + $('foot').offsetHeight + 2;
}
async function setLogFolded(folded) {
  const box = $('log-box');
  if (box.classList.contains('collapsed') === folded) return;
  const size = await window.kmt.win('size');
  if (folded) {
    if (size && !size.maximized) unfoldedHeight = size.height;
    box.classList.add('collapsed');
    $('btn-log-fold').textContent = '▸';
    if (size && !size.maximized) window.kmt.win('height', contentHeight());
  } else {
    box.classList.remove('collapsed');
    $('btn-log-fold').textContent = '▾';
    if (size && !size.maximized) window.kmt.win('height', Math.max(unfoldedHeight, contentHeight() + 140));
    const el = $('log');
    if ($('log-follow').checked) el.scrollTop = el.scrollHeight;
  }
}
const logText = () => $('log').textContent;

// ---- progress ----
const fmtTime = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function showProgress({ done, total }) {
  const bar = $('progress-fill').parentElement;
  if (!total) {
    bar.classList.add('busy');
    $('progress-text').textContent = TR.running ? T('prog.reading', { name: baseName(TR.running.mod) }) : '';
    return;
  }
  bar.classList.remove('busy');
  $('progress-fill').style.width = `${(100 * done) / total}%`;
  const el = Date.now() - TR.jobStart;
  const left = done ? (el / done) * (total - done) : 0;
  $('progress-text').textContent = T('prog.count', { done, total, el: fmtTime(el) }) + (done < total && done > 2 ? T('prog.left', { left: fmtTime(left) }) : '');
}
function resetProgress() {
  $('progress-fill').parentElement.classList.remove('busy');
  $('progress-fill').style.width = '0';
}

function applyState(st) {
  const prev = TR.running;
  TR.running = st.running;
  if (st.running && (!prev || prev.id !== st.running.id)) { TR.jobStart = Date.now(); resetProgress(); }
  for (const m of TR.mods) if (m.state === 'queued' && !st.queue.some((q) => q.mod === m.path) && !(st.running && st.running.mod === m.path)) m.state = 'wait';
  for (const q of st.queue) { const m = TR.mods.find((x) => x.path === q.mod); if (m) m.state = 'queued'; }
  const busy = !!st.running || st.queue.length > 0;
  $('btn-stop').disabled = !busy;
  $('btn-start').disabled = busy;
  $('btn-extract').disabled = busy;
  if (!busy) { $('progress-fill').parentElement.classList.remove('busy'); }
  renderMods();
}

// ---- starting jobs ----
async function startJobs(jobMode) {
  const list = TR.mods.filter((m) => !(TR.running && TR.running.mod === m.path));
  if (!list.length) { DLG.alert(T('msg.noModsTitle'), T('msg.noModsText')); return; }
  if (jobMode === 'inplace') {
    const ok = await DLG.ask(T('msg.inplaceTitle'), T('msg.inplaceText', { n: list.length }), T('msg.inplaceOk'));
    if (!ok) return;
  }
  if (jobMode !== 'extract' && jobMode !== 'copypatch' && !TR.settings.glossaryOnly && !TR.settings.glossaryPath) {
    // fine: Google only — just a note in the log
    appendLog([T('msg.noGlossary')]);
  }
  for (const m of list) { m.state = 'queued'; m.note = ''; }
  renderMods();
  applyState(await window.kmt.start(list.map((m) => ({ mod: m.path, mode: jobMode }))));
}

function wire() {
  for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', () => save({ mode: mode() }));
  $('glossary-path').addEventListener('change', (e) => save({ glossaryPath: e.target.value.trim().replace(/^"|"$/g, '') }));
  $('glossary-only').addEventListener('change', (e) => save({ glossaryOnly: e.target.checked }));
  $('out-root').addEventListener('change', (e) => save({ outRoot: e.target.value.trim().replace(/^"|"$/g, '') }));
  $('btn-glossary-pick').addEventListener('click', async () => {
    const r = await window.kmt.pick({ kind: 'file', title: T('gloss.pick'), defaultPath: TR.settings.glossaryPath || TR.init.dataDir, filters: [{ name: T('common.text'), extensions: ['txt'] }] });
    if (r) { $('glossary-path').value = r[0]; save({ glossaryPath: r[0] }); }
  });
  $('btn-glossary-open').addEventListener('click', () => TR.settings.glossaryPath && window.kmt.openPath(TR.settings.glossaryPath));
  $('btn-out-pick').addEventListener('click', async () => {
    const r = await window.kmt.pick({ kind: 'folder', title: T('out.pick'), defaultPath: TR.init.outRoot });
    if (r) save({ outRoot: r[0] });
  });
  $('btn-out-open').addEventListener('click', () => window.kmt.openPath(TR.init.outRoot));
  $('btn-add-mods').addEventListener('click', async () => {
    const r = await window.kmt.pick({ kind: 'files', title: T('mods.pickTitle'), defaultPath: TR.init.steamModsPath || TR.init.modsDir || undefined, filters: [{ name: T('mods.pickFilter'), extensions: ['mod'] }] });
    if (r) addMods(r);
  });
  wireList();
  $('btn-start').addEventListener('click', () => startJobs(mode()));
  $('btn-extract').addEventListener('click', () => startJobs('extract'));
  $('btn-stop').addEventListener('click', () => window.kmt.stop());
  $('btn-review').addEventListener('click', async () => { if (!(await closePages())) return; BUSY.show(T('busy.review')); try { await DLG.review(); } finally { BUSY.hide(); } });
  $('btn-restore').addEventListener('click', () => DLG.restore());
  $('btn-settings').addEventListener('click', async () => {
    if (PAGES.some((p) => p.kind === 'settings')) return;
    if (!(await closePages())) return;
    BUSY.show(T('busy.settings'));
    try { await DLG.settings(); } finally { BUSY.hide(); }
  });
  // the window's own title bar
  $('btn-min').addEventListener('click', () => window.kmt.win('min'));
  $('btn-max').addEventListener('click', () => window.kmt.win('max'));
  $('btn-close').addEventListener('click', () => { if (topPage()) topPage().close(); else window.kmt.win('close'); });
  $('btn-pin').addEventListener('click', () => {
    const on = !$('btn-pin').classList.contains('on');
    $('btn-pin').classList.toggle('on', on);
    TR.settings.pinned = on;
    window.kmt.win('pin', on);
  });
  window.kmt.onMaxed((m) => { $('btn-max').innerHTML = m ? '&#xE923;' : '&#xE922;'; TR.maxed = m; });
  // the screen it is on (moved to another monitor: another height limit)
  let areaTimer = null;
  window.addEventListener('resize', () => { clearTimeout(areaTimer); areaTimer = setTimeout(async () => { const s = await window.kmt.win('size'); if (s) { TR.area = s.area; TR.maxed = s.maximized; } }, 200); });
  $('btn-log-fold').addEventListener('click', () => setLogFolded(!$('log-box').classList.contains('collapsed')));
  $('log-title').addEventListener('click', () => setLogFolded(!$('log-box').classList.contains('collapsed')));
  $('log-last').addEventListener('click', () => setLogFolded(false));
  $('btn-log-copy').addEventListener('click', () => window.kmt.copyText(logText()));
  $('btn-log-clear').addEventListener('click', () => { $('log').textContent = ''; });
  $('btn-log-save').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + logText()], { type: 'text/plain' }));
    a.download = `translator-log-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.txt`;
    a.click();
  });
  // Drop on the window: .mod files from Explorer, or mods dragged from the manager's lists
  // (they bring their file names; the manager gives their paths).
  let dragDepth = 0;
  const listEl = $('mods-list');
  document.addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) listEl.classList.add('drop-on'); });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; listEl.classList.remove('drop-on'); } });
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    const allowed = e.dataTransfer.effectAllowed;
    e.dataTransfer.dropEffect = /copy|all|uninitialized/i.test(allowed) ? 'copy' : /move/i.test(allowed) ? 'move' : 'link';
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    listEl.classList.remove('drop-on');
    const files = [...(e.dataTransfer?.files || [])].map((f) => window.kmt.pathOf(f)).filter(Boolean);
    if (files.length) { addMods(files); return; }
    const names = (e.dataTransfer.getData('text/plain') || '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (names.length) addMods(await window.kmt.resolveMods(names));
  });
  // Ctrl+T here: back down to the manager's bar (as there it brings this window up)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyT') { e.preventDefault(); window.kmt.win('min'); }
  });

  window.kmt.onLog(appendLog);
  window.kmt.onProgress(showProgress);
  window.kmt.onState(applyState);
  window.kmt.onIdle(() => { const el = $('progress-text'); if (!el.textContent.endsWith(T('prog.allDone'))) el.textContent += '  ' + T('prog.allDone'); });
  window.kmt.onJobDone((r) => {
    const m = TR.mods.find((x) => x.path === r.mod);
    if (m) {
      m.state = r.error ? 'err' : r.nochange ? 'none' : 'done';
      m.note = r.error ? r.error.split('\n')[0] : r.nochange ? (r.message || '').split('\n')[0] : r.path ? baseName(r.path) : '';
      m.done = !r.error && !r.nochange && r.path ? { mode: r.mode, path: r.path, at: Date.now() } : null;
    }
    renderMods();
    if (r.error && r.error !== '사용자 중지') DLG.alert(T('msg.jobFailed', { name: baseName(r.mod) }), r.error);
  });
  window.kmt.onRequest((req) => {
    if (req.mode && req.mode !== 'extract') {
      const radio = document.querySelector(`input[name=mode][value="${req.mode}"]`);
      if (radio && !radio.checked) { radio.checked = true; save({ mode: req.mode }); }
    }
    addMods(req.mods);
  });
}

(async function boot() {
  TR.init = await window.kmt.init();
  setLang(TR.init.lang);
  applyI18n();
  $('busy-text').textContent = T('common.loading');
  TR.settings = TR.init.settings;
  const s = TR.settings;
  const radio = document.querySelector(`input[name=mode][value="${s.mode}"]`);
  if (radio) radio.checked = true;
  $('glossary-only').checked = !!s.glossaryOnly;
  $('btn-pin').classList.toggle('on', !!s.pinned);
  if (TR.init.maximized) $('btn-max').innerHTML = '&#xE923;';
  showOut();
  showSummary(await window.kmt.summary());
  showTarget();
  wire();
  $('btn-target').addEventListener('click', () => { if (!PAGES.some((p) => p.kind === 'settings')) DLG.settings('work'); });
  // the target language changed (its setting, or the manager's language it follows)
  window.kmt.onTarget(async (settings) => {
    TR.settings = settings;
    showTarget();
    showSummary(await window.kmt.summary());
  });
  // the manager's language changed: this window follows (a page that is open shows it when reopened)
  window.kmt.onLang((lang) => {
    setLang(lang);
    showTarget();
    showTitle();
    showOut();
    showSummary();
    renderMods();
  });
  applyState(TR.init.state);
  // folded log: the window just as tall as what it shows
  const size0 = await window.kmt.win('size');
  if (size0) { TR.area = size0.area; TR.maxed = size0.maximized; }
  requestAnimationFrame(() => { if (!TR.init.maximized) window.kmt.win('height', contentHeight()); TR.ready = true; $('busy').classList.add('hidden'); });
})();
