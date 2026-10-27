// The translator window's dialogs: messages, the menu, the settings, backups (되돌리기) and
// taking over a KMT folder. Words: translator-i18n.js (T).
const DLG = (() => {
  const overlay = $('overlay');
  const menuEl = $('menu');
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const A = (key, vars) => esc(T(key, vars)); // for HTML (text and attributes)
  let closeCurrent = null;

  // A big dialog needs room: a short window (log folded) grows while it is open, then goes back.
  // (The settings grow by themselves to their tallest tab: fitSettings.)
  let grownFrom = 0;
  new MutationObserver(async () => {
    const big = !overlay.classList.contains('hidden') && overlay.querySelector('.tr-dialog:not(.small):not(.st-dialog)');
    const size = await window.kmt.win('size');
    if (!size || size.maximized) return;
    if (big && !grownFrom && size.height < 720) { grownFrom = size.height; window.kmt.win('height', 760); }
    else if (!big && grownFrom && overlay.classList.contains('hidden')) { window.kmt.win('height', grownFrom); grownFrom = 0; }
  }).observe(overlay, { attributes: true, childList: true });
  // The settings: the window grows until the tallest tab fits (no scroll bar, the same height for
  // every tab), up to the screen; it goes back when they close (the observer above).
  async function fitSettings(body, panels, shown) {
    let tallest = 0;
    for (const p of Object.values(panels)) {
      for (const q of Object.values(panels)) q.el.classList.toggle('hidden', q !== p);
      tallest = Math.max(tallest, body.scrollHeight);
    }
    for (const [k, q] of Object.entries(panels)) q.el.classList.toggle('hidden', k !== shown());
    const extra = tallest - body.clientHeight;
    const size = await window.kmt.win('size');
    if (extra <= 0 || !size || size.maximized || overlay.classList.contains('hidden')) return;
    if (!grownFrom) grownFrom = size.height;
    window.kmt.win('height', size.height + extra);
  }

  // Big ones (설정, 번역 검수) take the window's place under the title bar, like a page;
  // small ones (되돌리기) stay a dialog over it. Messages (ask / alert) have their own layer on top.
  function open(dialog, onClose) {
    overlay.innerHTML = '';
    overlay.appendChild(dialog);
    overlay.classList.toggle('page', !dialog.classList.contains('small'));
    overlay.classList.remove('hidden');
    closeCurrent = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; closeCurrent = null; if (onClose) onClose(); };
    return closeCurrent;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (msgClose) { msgClose(false); return; }
    if (!menuEl.classList.contains('hidden')) { menuEl.classList.add('hidden'); return; }
    if (topPage()) { topPage().close(); return; }
    if (closeCurrent && !overlay.querySelector('.tr-dialog[data-modal]')) { closeCurrent(); return; }
    // nothing open: Esc puts the window down to the manager's bar
    if (overlay.classList.contains('hidden') && !e.target.closest?.('input, textarea, select')) window.kmt.win('min');
  });

  // ---- messages ----
  const msgLayer = document.createElement('div');
  msgLayer.className = 'tr-overlay tr-msg-layer hidden';
  document.body.appendChild(msgLayer);
  let msgClose = null;
  // A message over whatever is open (the page under it stays). Resolves true for the main button.
  function ask(title, text, okText = T('common.ok'), cancelText = T('common.cancel')) {
    if (msgClose) msgClose(false);
    return new Promise((resolve) => {
      const d = h(`<div class="tr-dialog small"><div class="tr-dialog-head"></div><div class="tr-dialog-body"><div style="white-space:pre-wrap;line-height:1.55"></div></div>
        <div class="tr-dialog-foot"><span class="tr-grow"></span>${cancelText ? '<button class="tr-btn" data-r="0"></button>' : ''}<button class="tr-btn tr-primary" data-r="1"></button></div></div>`);
      d.querySelector('.tr-dialog-head').textContent = title;
      d.querySelector('.tr-dialog-body div').textContent = text;
      d.querySelector('[data-r="1"]').textContent = okText;
      if (cancelText) d.querySelector('[data-r="0"]').textContent = cancelText;
      msgLayer.innerHTML = '';
      msgLayer.appendChild(d);
      msgLayer.classList.remove('hidden');
      msgClose = (v) => { msgLayer.classList.add('hidden'); msgLayer.innerHTML = ''; msgClose = null; resolve(v); };
      d.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => msgClose(b.dataset.r === '1')));
      d.querySelector('[data-r="1"]').focus();
    });
  }
  const alert = (title, text) => ask(title, text, T('common.ok'), null);

  function menu(x, y, items) {
    menuEl.innerHTML = '';
    for (const it of items) {
      if (it === 'sep') { menuEl.appendChild(h('<div class="tr-menu-sep"></div>')); continue; }
      const el = h('<div class="tr-menu-item"></div>');
      el.textContent = it.text;
      el.addEventListener('click', () => { menuEl.classList.add('hidden'); it.fn(); });
      menuEl.appendChild(el);
    }
    menuEl.style.left = Math.max(4, Math.min(x, innerWidth - 250)) + 'px';
    menuEl.style.top = y + 'px';
    menuEl.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', () => menuEl.classList.add('hidden'), { once: true }), 0);
  }

  // The built-in items as they show (English from DEFS_EN; Korean as rules.js sends them).
  const fieldText = (k, label, short, long) => (isEn() && DEFS_EN.fields[k] ? DEFS_EN.fields[k] : [label, short, long]);
  const excludeText = (k, label, short, long) => (isEn() && DEFS_EN.exclude[k] ? DEFS_EN.exclude[k] : [label, short, long]);
  const langText = (k, name, tip) => (isEn() && DEFS_EN.langs[k] ? DEFS_EN.langs[k] : [name, tip]);
  const groupTitle = (i, title) => (isEn() && DEFS_EN.groups[i] ? DEFS_EN.groups[i] : title);

  // One tab of rules ('work' = 한글화 추출 설정 / 'patch' = 패치복사 추출 설정): { el, reset(defaults), collect() }
  function rulesPanel(which, s, after, tg) {
    const defs = TR.init.defs;
    const key = (k) => `set.${which}.${k}`;
    const el = h(`<div class="st-panel">
      <div class="tr-cols" data-g="lang-row">
        <div class="tr-group" data-g="target"><div class="tr-group-title">${A('set.target')}</div>
          <select class="tr-input" data-target style="max-width:360px"></select>
          <div class="tr-muted tr-note" data-target-note></div></div>
        <div class="tr-group" data-g="langs"><div class="tr-group-title">${A('set.langs')} <span class="tr-muted" style="font-weight:normal">${A('set.langsNote')}</span></div>
          <div class="tr-row" style="flex-wrap:wrap" data-list="langs"></div>
          <div class="tr-row"><button class="tr-btn tr-small" data-lang-all></button><button class="tr-btn tr-small" data-lang-none></button></div></div>
      </div>
      <div class="tr-cols">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div class="tr-group"><div class="tr-group-title">${A(key('left'))}</div><div data-list="fields"></div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div class="tr-group"><div class="tr-group-title">${A(key('right'))}</div><div data-list="exclude"></div></div>
          <div class="tr-group" data-g="header"><div class="tr-group-title">${A('set.hd')} <span class="tr-muted" style="font-weight:normal" data-hd-kind></span></div>
            <div class="hd-row" data-tip="${A('set.hd.depsTip')}"><span class="hd-label">${A('set.hd.deps')}</span>
              <label class="tr-radio"><input type="radio" data-hr="deps" value="keep"> ${A('set.hd.keep')}</label>
              <label class="tr-radio"><input type="radio" data-hr="deps" value="delete"> ${A('set.hd.delete')}</label>
              <label class="tr-radio"><input type="radio" data-hr="deps" value="move"> ${A('set.hd.move')}</label></div>
            <div class="hd-row" data-tip="${A('set.hd.refsTip')}"><span class="hd-label">${A('set.hd.refs')}</span>
              <label class="tr-radio"><input type="radio" data-hr="refs" value="keep"> ${A('set.hd.keep')}</label>
              <label class="tr-radio"><input type="radio" data-hr="refs" value="delete"> ${A('set.hd.delete')}</label></div>
            <label class="tr-def" data-tip="${A('set.hd.addTip')}"><input type="checkbox" data-h="addOriginal"> ${A('set.hd.add')}</label>
            <label class="tr-def" data-tip="${A('set.hd.prefixTip')}"><input type="checkbox" data-h="prefix"> <span data-prefix-text></span></label>
            <div class="tr-muted tr-note">${A('set.hd.note')}</div>
          </div>
        </div>
      </div>
      <div class="tr-cols">
        <div class="tr-group"><div class="tr-row"><label class="tr-check"><input type="checkbox" data-on="fields_on"> <b>${A(key('fieldsBox'))}</b></label><span class="tr-grow"></span>
          <button class="tr-btn tr-small" data-load="fields" title="${A('set.box.loadTip')}">${A('set.box.load')}</button><button class="tr-btn tr-small" data-save="fields" title="${A('set.box.saveTip')}">${A('set.box.save')}</button><button class="tr-btn tr-small" data-clear="fields" title="${A('set.box.clearTip')}">${A('set.box.clear')}</button></div>
          <textarea class="tr-textarea" data-custom="fields" spellcheck="false"></textarea></div>
        <div class="tr-group"><div class="tr-row"><label class="tr-check"><input type="checkbox" data-on="exclude_on"> <b>${A(key('excludeBox'))}</b></label><span class="tr-grow"></span>
          <button class="tr-btn tr-small" data-load="exclude" title="${A('set.box.loadTip')}">${A('set.box.load')}</button><button class="tr-btn tr-small" data-save="exclude" title="${A('set.box.saveTip')}">${A('set.box.save')}</button><button class="tr-btn tr-small" data-clear="exclude" title="${A('set.box.clearTip')}">${A('set.box.clear')}</button></div>
          <textarea class="tr-textarea" data-custom="exclude" spellcheck="false"></textarea></div>
      </div>
      <div class="tr-hint-wrap folded"><div class="tr-dialog-hint" data-hint></div><span class="tr-guide-btns"><button class="tr-btn tr-small" data-hint-more title="${A('set.moreTip')}">${A('set.more')}</button><button class="tr-btn tr-small" data-guide>${A('set.guide')}</button></span></div>
    </div>`);
    if (which === 'patch') el.querySelector('[data-g="lang-row"]').remove();
    // the target language this tab shows (tg.target: 'auto' or a code, as it will be saved)
    const tgNow = () => (tg.target === 'auto' ? TR.settings.targetAuto : tg.target);
    const scriptOf = (t) => (defs.TARGETS[t] || {}).script || null;
    const showTg = () => {
      const t = tgNow();
      const v = { target: t };
      el.querySelector('[data-hd-kind]').textContent = which === 'patch' ? T('set.hd.patch') : T('set.hd.ko', v);
      const p = which === 'patch' ? (t === 'ko' ? ['항목 복사 패치', '원본:'] : ['Field copy patch', 'Original:']) : defs.TARGETS[t].prefix;
      el.querySelector('[data-prefix-text]').textContent = T('set.hd.prefix', { text: `'[${p[0]}] ${p[1]} …'` });
      const sc = scriptOf(t);
      const all = el.querySelector('[data-lang-all]');
      if (all) { all.textContent = T(sc ? 'set.langsAll' : 'set.langsAllX', v); el.querySelector('[data-lang-none]').textContent = T(sc ? 'set.langsNone' : 'set.langsNoneX', v); }
      const note = el.querySelector('[data-target-note]');
      if (note) note.textContent = T('set.targetNote', v);
    };
    const sel = el.querySelector('[data-target]');
    if (sel) {
      const opt = (value, text) => sel.appendChild(Object.assign(document.createElement('option'), { value, textContent: text }));
      opt('auto', T('set.targetAuto', { target: TR.settings.targetAuto }));
      for (const [k, d] of Object.entries(defs.TARGETS)) opt(k, `${T('tl.' + k)} · ${d.native} (_${k.toUpperCase()})`);
      sel.value = tg.target;
      sel.addEventListener('change', () => {
        // the new language is no longer looked for, the old one is (as the service does: rules.js swapLangs)
        const a = tgNow();
        tg.target = sel.value;
        const b = tgNow();
        const sa = scriptOf(a), sb = scriptOf(b);
        if (sa !== sb) { if (sa) s.langs[sa] = true; if (sb) s.langs[sb] = false; }
        draw();
        for (const f of tg.subs) f();
      });
    }
    (tg.subs ||= []).push(showTg); // (the other tab's made-mod words follow it too)
    const hint = el.querySelector('[data-hint]');
    const tipOn = (x, text) => { x.addEventListener('mouseenter', () => { hint.textContent = text; }); };
    const box = (name) => el.querySelector(`[data-list="${name}"]`);
    const defRow = (label, short, checked, onChange, tip) => {
      const row = h('<label class="tr-def"><input type="checkbox"> <span></span> <small></small></label>');
      row.querySelector('span').textContent = label;
      row.querySelector('small').textContent = short || '';
      const cb = row.querySelector('input');
      cb.checked = checked;
      cb.addEventListener('change', () => onChange(cb.checked));
      tipOn(row, tip);
      return row;
    };
    const draw = () => {
      const fg = box('fields');
      fg.innerHTML = '';
      defs.FIELD_GROUPS.forEach(([title, items], gi) => {
        fg.appendChild(Object.assign(h('<div class="tr-group-title"></div>'), { textContent: groupTitle(gi, title) }));
        for (const [k, label, short, long] of items) { const [l2, s2, t2] = fieldText(k, label, short, long); fg.appendChild(defRow(l2, s2, !!s.fields[k], (v) => { s.fields[k] = v; }, t2)); }
      });
      const eg = box('exclude');
      eg.innerHTML = '';
      for (const [k, label, short, long] of defs.EXCLUDE_DEFS) { const [l2, s2, t2] = excludeText(k, label, short, long); eg.appendChild(defRow(l2, s2, !!s.exclude[k], (v) => { s.exclude[k] = v; }, t2)); }
      const lg = box('langs');
      if (lg) {
        lg.innerHTML = '';
        for (const [k, name, , tip] of defs.LANG_DEFS) { const [n2, t2] = langText(k, name, tip); lg.appendChild(defRow(n2, '', !!s.langs[k], (v) => { s.langs[k] = v; }, t2)); }
      }
      s.header = { deps: 'delete', refs: 'keep', addOriginal: true, prefix: true, ...(s.header || {}) };
      el.querySelectorAll('[data-h]').forEach((cb) => { cb.checked = !!s.header[cb.dataset.h]; cb.onchange = () => { s.header[cb.dataset.h] = cb.checked; }; });
      el.querySelectorAll('[data-hr]').forEach((r) => { r.name = `${which}-hd-${r.dataset.hr}`; r.checked = s.header[r.dataset.hr] === r.value; r.onchange = () => { if (r.checked) s.header[r.dataset.hr] = r.value; }; });
      for (const w of ['fields', 'exclude']) {
        const ta = el.querySelector(`[data-custom="${w}"]`);
        ta.value = (s.custom[w] || []).join('\n');
        const on = el.querySelector(`[data-on="${w}_on"]`);
        on.checked = s.custom[`${w}_on`] !== false;
        ta.disabled = !on.checked;
        on.onchange = () => { ta.disabled = !on.checked; };
      }
    };
    for (const w of ['fields', 'exclude']) {
      const ta = el.querySelector(`[data-custom="${w}"]`);
      tipOn(ta, hintText(which, w));
      ta.addEventListener('focus', () => { hint.textContent = hintText(which, w); });
    }
    el.querySelectorAll('[data-h]').forEach((cb) => tipOn(cb.closest('label'), cb.closest('label').dataset.tip));
    el.querySelectorAll('.hd-row[data-tip]').forEach((row) => tipOn(row, row.dataset.tip));
    draw();
    hint.textContent = hintText(which, 'fields');
    showTg();
    const allLangs = (on) => { const own = scriptOf(tgNow()); for (const [k] of defs.LANG_DEFS) if (k !== own) s.langs[k] = on; draw(); };
    el.querySelector('[data-lang-all]')?.addEventListener('click', () => allLangs(true));
    el.querySelector('[data-lang-none]')?.addEventListener('click', () => allLangs(false));
    // each box: 불러오기 (adds the file's lines) · 저장 (a txt with a dated name) · 모두 지우기 (Ctrl+Z brings it back)
    const stamp = () => { const d = new Date(); const p2 = (n) => String(n).padStart(2, '0'); return `${p2(d.getFullYear() % 100)}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`; };
    for (const w of ['fields', 'exclude']) {
      const ta = el.querySelector(`[data-custom="${w}"]`);
      el.querySelector(`[data-load="${w}"]`).addEventListener('click', async () => {
        const r = await window.kmt.pick({ kind: 'file', title: T('set.box.loadTitle', { box: T(key(w === 'fields' ? 'fieldsBox' : 'excludeBox')) }), defaultPath: TR.init.dataDir, filters: [{ name: T('common.text'), extensions: ['txt'] }] });
        if (!r) return;
        try {
          const lines = await window.kmt.readLines(r[0]);
          const cur = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
          let added = 0;
          for (const l of lines) if (l.trim() && !cur.includes(l.trim())) { cur.push(l.trim()); added++; }
          ta.focus();
          ta.select();
          document.execCommand('insertText', false, cur.join('\n')); // (undoable)
          hint.textContent = T('set.box.loaded', { path: r[0], n: added });
        } catch (e) { hint.textContent = T('set.box.loadFailed', { error: e.message }); }
      });
      el.querySelector(`[data-save="${w}"]`).addEventListener('click', async () => {
        const text = ta.value.split('\n').map((x) => x.trimEnd()).join('\r\n').trim();
        if (!text) { hint.textContent = T('set.box.nothing'); return; }
        const r = await window.kmt.saveText(`${T(`set.box.file.${which}.${w}`)}_${stamp()}.txt`, text + '\r\n');
        if (r) hint.textContent = T('set.box.savedTo', { path: r });
      });
      el.querySelector(`[data-clear="${w}"]`).addEventListener('click', () => {
        if (!ta.value) return;
        ta.disabled = false;
        ta.focus();
        ta.select();
        document.execCommand('delete'); // (undoable: Ctrl+Z)
        ta.disabled = !el.querySelector(`[data-on="${w}_on"]`).checked;
        hint.textContent = T('set.box.cleared');
      });
    }
    let guideAt = 'work-fields';
    for (const w of ['fields', 'exclude']) {
      const ta = el.querySelector(`[data-custom="${w}"]`);
      const set = () => { guideAt = `${which}-${w}`; };
      ta.addEventListener('focus', set);
      ta.addEventListener('mouseenter', set);
    }
    guideAt = `${which}-fields`;
    el.querySelector('[data-guide]').addEventListener('click', () => GUIDE.open(guideAt));
    const wrap = el.querySelector('.tr-hint-wrap');
    const moreBtn = el.querySelector('[data-hint-more]');
    let hintOpen = false;
    try { hintOpen = localStorage.getItem('kmt.hintOpen') === '1'; } catch { /* folded */ }
    const showHint = () => { wrap.classList.toggle('folded', !hintOpen); moreBtn.textContent = T(hintOpen ? 'set.less' : 'set.more'); };
    moreBtn.addEventListener('click', async () => {
      const before = wrap.offsetHeight;
      hintOpen = !hintOpen;
      try { localStorage.setItem('kmt.hintOpen', hintOpen ? '1' : '0'); } catch { /* not kept */ }
      document.querySelectorAll('.tr-hint-wrap').forEach((w) => { w.classList.toggle('folded', !hintOpen); const b = w.querySelector('[data-hint-more]'); if (b) b.textContent = T(hintOpen ? 'set.less' : 'set.more'); });
      // the window grows / shrinks with it (no scroll bar for it)
      const delta = wrap.offsetHeight - before;
      const size = await window.kmt.win('size');
      if (delta && size && !size.maximized) window.kmt.win('height', size.height + delta);
    });
    showHint();
    return {
      el,
      reset(def) {
        for (const k of Object.keys(s)) delete s[k];
        Object.assign(s, JSON.parse(JSON.stringify(def)));
        if (which === 'work') { after.exportNoGlossary = true; after.openExtract = true; }
        draw();
      },
      collect() {
        for (const w of ['fields', 'exclude']) {
          s.custom[w] = el.querySelector(`[data-custom="${w}"]`).value.split('\n').map((x) => x.trim()).filter(Boolean);
          s.custom[`${w}_on`] = el.querySelector(`[data-on="${w}_on"]`).checked;
        }
        return s;
      },
    };
  }

  // 패치 자동 정리: where a made mod goes, and turning it on.
  async function routePanel(route, opts) {
    const el = h(`<div class="st-panel"><div class="st-section">
      <div class="tr-box-title">${A('set.route.title')}</div>
      <div class="tr-muted tr-note">${A('set.route.note')}</div>
      <div class="tr-row"><span class="tr-label">${A('set.route.ko')}</span><select class="tr-input" data-r="ko"></select></div>
      <div class="tr-row"><span class="tr-label">${A('set.route.patch')}</span><select class="tr-input" data-r="patch"></select></div>
      <div class="tr-muted tr-note">${A('set.route.autoNote')}<br>${A('set.route.afterNote')}</div>
      <div class="tr-row" style="flex-wrap:wrap;gap:14px"><span class="tr-label">${A('set.route.pos')}</span>
        <label class="tr-radio"><input type="radio" name="route-pos" value="top"> ${A('set.route.top')}</label>
        <label class="tr-radio"><input type="radio" name="route-pos" value="afterActive"> ${A('set.route.afterActive')}</label>
        <label class="tr-radio"><input type="radio" name="route-pos" value="bottom"> ${A('set.route.bottom')}</label>
        <span class="tr-muted tr-note">${A('set.route.posNote')}</span></div>
      <label class="tr-check" title="${A('set.route.activateTip')}"><input type="checkbox" data-activate> ${A('set.route.activate')}</label>
      <div class="tr-muted tr-note">${A('set.route.foot')}</div>
    </div></div>`);
    const cats = await window.kmt.categories();
    const fill = (sel, auto, value) => {
      sel.innerHTML = '';
      const opt = (v, t) => sel.appendChild(Object.assign(document.createElement('option'), { value: v, textContent: t }));
      opt('', auto);
      opt('__after_original__', T('set.route.afterOriginal'));
      opt('__uncategorized__', T('set.route.uncat'));
      for (const c of cats) opt(c.id, c.name);
      sel.value = cats.some((c) => c.id === value) || value === '__uncategorized__' || value === '__after_original__' ? value : '';
    };
    const draw = () => {
      fill(el.querySelector('[data-r="ko"]'), T('set.route.autoKo'), route.ko);
      fill(el.querySelector('[data-r="patch"]'), T('set.route.autoPatch'), route.patch);
      el.querySelector('[data-activate]').checked = opts.activate !== false;
      const pos = ['top', 'afterActive', 'bottom'].includes(route.pos) ? route.pos : 'afterActive';
      el.querySelector(`input[name=route-pos][value=${pos}]`).checked = true;
    };
    draw();
    return {
      el,
      reset() { route.ko = ''; route.patch = ''; route.pos = 'afterActive'; opts.activate = true; draw(); },
      collect() {
        route.ko = el.querySelector('[data-r="ko"]').value;
        route.patch = el.querySelector('[data-r="patch"]').value;
        route.pos = el.querySelector('input[name=route-pos]:checked')?.value || 'afterActive';
        opts.activate = el.querySelector('[data-activate]').checked;
      },
    };
  }

  // 데이터 폴더 설정: these act at once.
  function dataPanel(after) {
    const el = h(`<div class="st-panel"><div class="st-section">
      <div class="tr-box-title">${A('set.data.title')}</div>
      <div class="tr-muted tr-note">${A('set.data.note')}</div>
      <div class="tr-row"><input class="tr-input" data-dir readonly></div>
      <div class="tr-row"><button class="tr-btn tr-small" data-open>${A('common.open')}</button><button class="tr-btn tr-small" data-change>${A('set.data.change')}</button><button class="tr-btn tr-small" data-default>${A('set.data.default')}</button></div>
      <label class="tr-radio"><input type="radio" name="layout" value="split"> <b>${A('set.data.split')}</b> <span class="tr-muted">${A('set.data.splitNote')}</span></label>
      <div class="tr-names" data-names>
        <span class="tr-muted">${A('set.data.cache')}</span><input class="tr-input" data-name="cache" spellcheck="false">
        <span class="tr-muted">${A('set.data.review')}</span><input class="tr-input" data-name="review" spellcheck="false">
        <span class="tr-muted">${A('set.data.extract')}</span><input class="tr-input" data-name="extract" spellcheck="false">
        <span class="tr-muted">${A('set.data.noGloss')}</span><input class="tr-input" data-name="noGloss" spellcheck="false">
      </div>
      <label class="tr-radio"><input type="radio" name="layout" value="single"> <b>${A('set.data.single')}</b> <span class="tr-muted">${A('set.data.singleNote')}</span></label>
      <div class="tr-muted tr-note" data-dirs></div>
    </div>
    <div class="st-section">
      <div class="tr-box-title">${A('set.after')}</div>
      <label class="tr-def" title="${A('set.after.openTip')}"><input type="checkbox" data-after="openExtract"> ${A('set.after.open')}</label>
      <label class="tr-def" title="${A('set.after.exportTip')}"><input type="checkbox" data-after="exportNoGlossary"> ${A('set.after.export')}</label>
    </div>
    <div class="st-section">
      <div class="tr-box-title">${A('set.data.import')}</div>
      <div class="tr-muted tr-note" title="${A('set.data.importTip')}">${A('set.data.importNote')}</div>
      <div class="tr-row"><button class="tr-btn tr-small" data-import>${A('set.data.importBtn')}</button></div>
    </div></div>`);
    const show = () => {
      el.querySelector('[data-dir]').value = TR.init.dataDir;
      const layout = TR.settings.dataLayout === 'single' ? 'single' : 'split';
      el.querySelector(`input[name=layout][value=${layout}]`).checked = true;
      el.querySelector('[data-names]').classList.toggle('off', layout !== 'split');
      const names = TR.settings.dataNames || {};
      el.querySelectorAll('[data-name]').forEach((inp) => { if (document.activeElement !== inp) inp.value = names[inp.dataset.name] || ''; });
      const d = TR.init.dirs || {};
      el.querySelector('[data-dirs]').textContent = ['cache', 'review', 'extract', 'noGloss'].map((k) => `${T('set.data.' + k)}: ${d[k] || ''}`).join('\n');
    };
    el.querySelector('[data-dirs]').style.whiteSpace = 'pre-wrap';
    show();
    el.querySelectorAll('[data-after]').forEach((cb) => { cb.checked = !!after[cb.dataset.after]; cb.addEventListener('change', () => { after[cb.dataset.after] = cb.checked; }); });
    el.querySelectorAll('input[name=layout]').forEach((r) => r.addEventListener('change', async () => { await save({ dataLayout: r.value }); show(); }));
    // a folder name: saved when it's left (empty or with \ / : * ? " < > | goes back)
    el.querySelectorAll('[data-name]').forEach((inp) => inp.addEventListener('change', async () => {
      const v = inp.value.trim().replace(/[. ]+$/, '');
      const names = { ...(TR.settings.dataNames || {}) };
      if (!v || /[\\/:*?"<>|]/.test(v)) { inp.value = names[inp.dataset.name] || ''; return; }
      names[inp.dataset.name] = v;
      await save({ dataNames: names });
      show();
    }));
    el.querySelector('[data-open]').addEventListener('click', () => window.kmt.openPath(TR.init.dataDir));
    el.querySelector('[data-change]').addEventListener('click', async () => {
      const r = await window.kmt.pick({ kind: 'folder', title: T('set.data.pick'), defaultPath: TR.init.dataDir });
      if (r) { await save({ dataDir: r[0] }); show(); }
    });
    el.querySelector('[data-default]').addEventListener('click', async () => { await save({ dataDir: '' }); show(); });
    el.querySelector('[data-import]').addEventListener('click', () => importKmt());
    return { el, reset: null, collect() {} };
  }

  // 기타 설정
  function etcPanel(opts) {
    const el = h(`<div class="st-panel"><div class="st-section">
      <div class="tr-box-title">${A('set.etc.title')}</div>
      <div class="tr-muted tr-note">${A('set.etc.note')}</div>
      <label class="tr-radio"><input type="radio" name="etc-overlap" value="minimize"> <b>${A('set.etc.min')}</b> <span class="tr-muted">${A('set.etc.minNote')}</span></label>
      <label class="tr-radio"><input type="radio" name="etc-overlap" value="behind"> <b>${A('set.etc.behind')}</b> <span class="tr-muted">${A('set.etc.behindNote')}</span></label>
      <label class="tr-radio"><input type="radio" name="etc-overlap" value="top"> <b>${A('set.etc.top')}</b> <span class="tr-muted">${A('set.etc.topNote')}</span></label>
    </div></div>`);
    const draw = () => { const v = ['minimize', 'behind', 'top'].includes(opts.overlap) ? opts.overlap : 'minimize'; el.querySelector(`input[name=etc-overlap][value=${v}]`).checked = true; };
    draw();
    return {
      el,
      reset() { opts.overlap = 'minimize'; draw(); },
      collect() { opts.overlap = el.querySelector('input[name=etc-overlap]:checked')?.value || 'minimize'; },
    };
  }

  async function settings(tab = 'work') {
    const work = JSON.parse(JSON.stringify(TR.settings.work));
    const patchcopy = JSON.parse(JSON.stringify(TR.settings.patchcopy));
    const after = { ...TR.settings.after };
    const route = { ...TR.settings.route };
    const opts = { activate: TR.settings.activate, overlap: TR.settings.overlap || 'minimize' };
    const tg = { target: TR.settings.target || 'auto' };
    const tgNow = () => (tg.target === 'auto' ? TR.settings.targetAuto : tg.target);
    const panels = {
      work: rulesPanel('work', work, after, tg),
      patch: rulesPanel('patch', patchcopy, after, tg),
      route: await routePanel(route, opts),
      data: dataPanel(after),
      etc: etcPanel(opts),
    };
    const d = h(`<div class="tr-dialog st-dialog"><div class="st-tabs"></div>
      <div class="tr-dialog-body" data-body></div><div class="tr-warn" data-warn style="padding:0 14px"></div>
      <div class="tr-dialog-foot"><button class="tr-btn" data-defaults title="${A('set.defaultsTip')}">${A('set.defaults')}</button><span class="tr-grow"></span><span class="tr-muted" data-saved style="font-size:12px"></span><button class="tr-btn tr-primary" data-save-all>${A('common.save')}</button><button class="tr-btn" data-cancel>${A('common.close')}</button></div></div>`);
    const tabs = d.querySelector('.st-tabs');
    const body = d.querySelector('[data-body]');
    const show = (k) => {
      tab = k;
      for (const [k2, p] of Object.entries(panels)) p.el.classList.toggle('hidden', k2 !== k);
      tabs.querySelectorAll('.st-tab').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      d.querySelector('[data-defaults]').classList.toggle('hidden', !panels[k].reset);
    };
    for (const [k, p] of Object.entries(panels)) {
      const b = h('<button class="st-tab"></button>');
      b.textContent = T('set.tab.' + k);
      b.dataset.k = k;
      b.addEventListener('click', () => show(k));
      tabs.appendChild(b);
      body.appendChild(p.el);
    }
    show(panels[tab] ? tab : 'work');
    d.querySelector('[data-defaults]').addEventListener('click', async () => {
      const p = panels[tab];
      if (tab === 'work' || tab === 'patch') p.reset(await window.kmt.defaults(tab, tgNow()));
      else if (p.reset) p.reset();
    });
    const page = { titleKey: 'set.title', kind: 'settings', close: async () => false };
    const close = open(d, () => popPage(page));
    pushPage(page);
    requestAnimationFrame(() => fitSettings(body, panels, () => tab));
    const snapshot = () => { panels.work.collect(); panels.patch.collect(); panels.route.collect(); panels.etc.collect(); return JSON.stringify({ work, patchcopy, after, route, a: opts.activate, o: opts.overlap, t: tg.target }); };
    let savedState = snapshot();
    const saved = d.querySelector('[data-saved]');
    d.addEventListener('input', () => { saved.textContent = ''; });
    d.addEventListener('change', () => { saved.textContent = ''; });
    // 닫기 (and the title bar's ✕, Esc): unsaved changes are asked about first
    page.close = async () => {
      if (snapshot() !== savedState) {
        const keep = await ask(T('set.unsavedTitle'), T('set.unsavedText'), T('set.unsavedSave'), T('set.unsavedDiscard'));
        if (keep && !(await doSave())) return false;
      }
      close();
      return true;
    };
    d.querySelector('[data-cancel]').addEventListener('click', () => page.close());
    const doSave = async () => {
      panels.work.collect();
      panels.patch.collect();
      panels.route.collect();
      panels.etc.collect();
      const warns = [...(await window.kmt.validate(work.custom)).map((w) => T('set.warnWork') + ' ' + w), ...(await window.kmt.validate(patchcopy.custom)).map((w) => T('set.warnPatch') + ' ' + w)];
      const w = d.querySelector('[data-warn]');
      if (warns.length && w.dataset.shown !== JSON.stringify(warns)) {
        w.dataset.shown = JSON.stringify(warns);
        w.textContent = T('set.warn') + '\n· ' + warns.join('\n· ');
        return false;
      }
      w.textContent = '';
      // langsFor: the detected languages were already swapped here for that target
      await save({ work, patchcopy, after, route, activate: opts.activate, overlap: opts.overlap, target: tg.target, langsFor: tgNow() });
      savedState = snapshot();
      saved.textContent = T('set.saved');
      return true;
    };
    // 저장: saved, the page stays open
    d.querySelector('[data-save-all]').addEventListener('click', doSave);
  }

  // ---- backups (되돌리기) ----
  async function restore() {
    const mods = TR.mods.map((m) => m.path);
    if (!mods.length) { alert(T('msg.noModsTitle'), T('bk.noMods')); return; }
    const d = h(`<div class="tr-dialog small" style="width:min(760px,100%)"><div class="tr-dialog-head">${A('bk.title')}</div><div class="tr-dialog-body">
      <div class="tr-row"><span class="tr-label">${A('bk.mod')}</span><select class="tr-input" data-mod></select></div><div data-list style="display:flex;flex-direction:column;gap:8px"></div>
      <div class="tr-muted tr-note">${A('bk.note')}</div></div>
      <div class="tr-dialog-foot"><span class="tr-grow"></span><button class="tr-btn" data-cancel>${A('common.close')}</button><button class="tr-btn tr-primary" data-go disabled>${A('bk.go')}</button></div></div>`);
    const sel = d.querySelector('[data-mod]');
    for (const m of mods) sel.appendChild(Object.assign(document.createElement('option'), { value: m, textContent: baseName(m) }));
    let pick = null;
    const list = d.querySelector('[data-list]');
    const draw = async () => {
      pick = null;
      d.querySelector('[data-go]').disabled = true;
      list.innerHTML = '';
      const groups = await window.kmt.backups(sel.value);
      const names = [T('bk.original'), T('bk.ko'), T('bk.patch')];
      groups.forEach((g, i) => {
        const box = h('<div class="bk-target"><div class="tr-box-title"></div><div class="tr-muted tr-note" data-p></div></div>');
        box.querySelector('.tr-box-title').textContent = names[i];
        box.querySelector('[data-p]').textContent = g.target + (g.exists ? '' : T('bk.missing'));
        if (!g.list.length) box.appendChild(Object.assign(h('<div class="tr-muted tr-note"></div>'), { textContent: T('bk.none') }));
        for (const b of g.list) {
          const row = h('<label class="bk-item"><input type="radio" name="bk"> <span></span> <span class="tr-muted"></span></label>');
          row.querySelector('span').textContent = b.kind === 'original' ? T('bk.origBak') : T('bk.dated');
          row.querySelector('.tr-muted').textContent = b.when;
          row.title = b.path;
          row.querySelector('input').addEventListener('change', () => { pick = { target: g.target, bak: b.path }; d.querySelector('[data-go]').disabled = false; });
          box.appendChild(row);
        }
        list.appendChild(box);
      });
    };
    sel.addEventListener('change', draw);
    const close = open(d);
    d.querySelector('[data-cancel]').addEventListener('click', close);
    d.querySelector('[data-go]').addEventListener('click', async () => {
      if (!pick) return;
      if (!(await ask(T('act.restore'), T('bk.ask', { target: baseName(pick.target), bak: baseName(pick.bak) }), T('act.restore')))) { open(d); return; }
      try {
        const pre = await window.kmt.restore(pick.target, pick.bak);
        appendLog([T('bk.done', { target: pick.target, bak: pick.bak }), pre ? T('bk.pre', { path: pre }) : '']);
        open(d);
        draw();
      } catch (e) { alert(T('bk.failed'), e.message); }
    });
    draw();
  }

  // ---- taking over a KMT folder ----
  async function importKmt() {
    const r = await window.kmt.pick({ kind: 'folder', title: T('set.data.importPick') });
    if (!r) return;
    try {
      const res = await window.kmt.importKmt(r[0]);
      await save({});
      $('glossary-path').value = TR.settings.glossaryPath || '';
      alert(T('set.data.import'), [
        T(res.settings ? 'set.data.imported' : 'set.data.importedNone'),
        res.glossary ? T('set.data.importedGloss', { path: res.glossary }) : '',
        T('set.data.importedCache', { n: res.cache }),
      ].filter(Boolean).join('\n'));
    } catch (e) { alert(T('set.data.importFailed'), e.message); }
  }

  return { ask, alert, menu, settings, restore, importKmt, open, h, get close() { return closeCurrent; } };
})();
