// Steam Workshop subscribe queue (the same file in the ARK and Kenshi managers).
// Mods that aren't installed can't be downloaded by the app; Steam does that once the user
// subscribes. The queue lists them on the left and shows each one's Workshop page on the
// right (an in-app browser; the user logs in to Steam there once), with "Open in Steam"
// for the Steam client and, when allowed in Settings, "Subscribe to all", which clicks the
// page's Subscribe button for each mod in turn, slowly.
//
// subscribeQueue(box, { items, allowAuto, gap, byCount, tr, openExternal, onSettings, onClose })
//   box     — an empty element to draw into
//   items   — [{ id, title, url, steamUrl, search }]; search = a Workshop search page (no id)
//   gap     — seconds between page loads (Steam refuses too many requests in a row)
//   byCount — scale the gap with the queue's size: under 5 mods none, 5–9 half, 10+ all of it
//   tr      — the app's t(key, vars)
//   onClose — (items): status 'subscribed' = subscribed; checked && no status = seen not subscribed
//   onSettings — ({ subAuto, subGap, subGapByCount }) when they are changed with ⚙ in the queue

const SQ_DEFAULT_GAP = 6; // seconds; 2.5 s was refused after about ten pages

// The gap the queue actually uses for n mods (seconds).
function sqGapFor(n, gap, byCount) {
  const g = Math.max(0, Number(gap ?? SQ_DEFAULT_GAP) || 0);
  if (!byCount) return g;
  return n < 5 ? 0 : n < 10 ? g / 2 : g;
}

function subscribeQueue(box, { items, allowAuto, gap, byCount = true, tr, openExternal, onSettings, onClose }) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const secs = (ms) => Math.max(1, Math.ceil(ms / 1000));
  let cur = 0;
  let running = false;
  let stop = false;
  let loggedIn = null;
  let auto = !!allowAuto;
  let gapSec = Math.max(0, Number(gap ?? SQ_DEFAULT_GAP) || 0);
  let gapByCount = byCount;
  let gapMs = sqGapFor(items.length, gapSec, gapByCount) * 1000;
  let fullGapMs = gapSec * 1000;
  let askNow = true; // ask before opening a held page at once ("don't ask again" turns it off)

  box.innerHTML = `<div class="sq">
    <div class="sq-side">
      <div class="sq-head">${esc(tr('sq.title'))} <span class="sq-count"></span></div>
      <div class="sq-desc">${esc(tr('sq.desc'))}</div>
      <div class="sq-desc">${esc(tr('sq.keys'))}</div>
      <div class="sq-desc sq-gap-info"></div>
      <div class="sq-list"></div>
      <div class="sq-note"></div>
    </div>
    <div class="sq-main">
      <div class="sq-bar">
        <button class="sq-btn" data-q="prev" title="${esc(tr('sq.prev'))}">◀</button>
        <button class="sq-btn" data-q="next" title="${esc(tr('sq.next'))}">▶</button>
        <span class="sq-name"></span>
        <span class="sq-wait" hidden><span class="sq-wait-text"></span><button class="sq-btn sq-small" data-q="now"></button></span>
        <button class="sq-btn" data-q="steam" title="${esc(tr('sq.steamTip'))}">${esc(tr('sq.steam'))}</button>
        <button class="sq-btn sq-gear" data-q="settings" title="${esc(tr('sq.settingsTip'))}">⚙</button>
        <button class="sq-btn sq-primary" data-q="auto" title="${esc(tr('sq.autoTip'))}"${auto ? '' : ' hidden'}>${esc(tr('sq.auto'))}</button>
        <button class="sq-btn" data-q="close">${esc(tr('sq.close'))}</button>
      </div>
      <div class="sq-stage">
        <webview class="sq-view" src="about:blank"></webview>
        <div class="sq-hold" hidden><div class="sq-hold-box">
          <div class="sq-hold-title"></div>
          <div class="sq-hold-text"></div>
          <div class="sq-hold-buttons"></div>
        </div></div>
        <div class="sq-hold sq-set" hidden><div class="sq-hold-box sq-set-box">
          <div class="sq-hold-title">⚙ ${esc(tr('sq.settings'))}</div>
          <label class="sq-set-row"><input type="checkbox" data-s="auto"> ${esc(tr('sq.autoSetting'))}</label>
          <div class="sq-set-row"><span>${esc(tr('sq.gapSetting'))}</span><input type="number" class="sq-gap-input" data-s="gap" min="0" max="120" step="0.5"></div>
          <label class="sq-set-row"><input type="checkbox" data-s="count"> ${esc(tr('sq.gapByCount'))}</label>
          <div class="sq-set-note">${esc(tr('sq.gapNote'))}</div>
          <div class="sq-set-warn" hidden><div class="sq-set-warn-text"></div>
            <div class="sq-hold-buttons"><button class="sq-btn" data-s="warn-no">${esc(tr('modal.cancel'))}</button><button class="sq-btn sq-danger" data-s="warn-ok">${esc(tr('sq.gapLowOk'))}</button></div></div>
          <div class="sq-set-note">${esc(tr('sq.settingsSaved'))}</div>
          <div class="sq-hold-buttons"><button class="sq-btn" data-s="close">${esc(tr('sq.close'))}</button></div>
        </div></div>
      </div>
    </div>
  </div>`;
  const view = box.querySelector('.sq-view');
  const list = box.querySelector('.sq-list');
  const note = box.querySelector('.sq-note');
  const chip = box.querySelector('.sq-wait');
  const hold = box.querySelector('.sq-hold');
  const panel = box.querySelector('.sq-set');

  const STATE_SCRIPT = `(() => {
    const b = document.getElementById('SubscribeItemBtn');
    const logged = typeof g_steamID !== 'undefined' && !!g_steamID;
    const text = (document.title + ' ' + (document.body ? document.body.innerText.slice(0, 2000) : '')).toLowerCase();
    const limited = /too many requests|너무 많은 요청|リクエストが多すぎ|请求过多/.test(text);
    return { logged, limited, button: !!b, subscribed: !!b && b.classList.contains('toggled') };
  })()`;
  // W/A/↑/← = previous mod, S/D/↓/→ = next (by key position, so the Korean keyboard's
  // ㅈ/ㅁ/ㄴ/ㅇ work too). Inside the page the keys come back through console messages.
  const KEY_MOVES = { KeyW: -1, KeyA: -1, ArrowUp: -1, ArrowLeft: -1, KeyS: 1, KeyD: 1, ArrowDown: 1, ArrowRight: 1 };
  const KEY_SCRIPT = `(() => { if (window.__sqKeys) return; window.__sqKeys = true;
    const moves = ${JSON.stringify(KEY_MOVES)};
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || !(e.code in moves)) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      console.log('__SQKEY__' + moves[e.code]);
    }, true); })()`;
  const CLICK_SCRIPT = `(() => { const b = document.getElementById('SubscribeItemBtn'); if (b && !b.classList.contains('toggled')) { b.click(); return true; } return false; })()`;
  // "This item requires…" dialog: take its first green button (subscribe to all / continue).
  const DIALOG_SCRIPT = `(() => { const m = document.querySelector('.newmodal'); if (!m) return false; const b = m.querySelector('.btn_green_steamui, .btn_green_white_innerfade'); if (b) { b.click(); return true; } return false; })()`;

  const drawGapInfo = () => {
    box.querySelector('.sq-gap-info').textContent = gapMs
      ? tr('sq.gapInfo', { s: +(gapMs / 1000).toFixed(1), n: items.length })
      : tr('sq.gapNone', { n: items.length });
  };

  const drawList = () => {
    const done = items.filter((it) => it.status === 'subscribed').length;
    box.querySelector('.sq-count').textContent = `${done}/${items.length}`;
    list.innerHTML = items.map((it, i) => `<div class="sq-item${i === cur ? ' current' : ''}${it.status ? ' ' + it.status : ''}" data-i="${i}" title="${esc(it.id)}">
      <span class="sq-mark">${it.status === 'subscribed' ? '✔' : it.status === 'failed' ? '✕' : it.search ? '🔍' : '•'}</span>
      <span class="sq-title">${esc(it.title)}</span></div>`).join('');
    box.querySelector('.sq-name').textContent = items[cur] ? items[cur].title + (items[cur].search ? ' — ' + tr('sq.searchNote') : '') : '';
    const autoBtn = box.querySelector('[data-q="auto"]');
    autoBtn.hidden = !auto && !running;
    autoBtn.textContent = running ? tr('sq.stop') : tr('sq.auto');
    autoBtn.disabled = !running && !items.some((it) => !it.search && it.status !== 'subscribed');
  };

  const setNote = (text, bad = false) => {
    note.textContent = text || '';
    note.classList.toggle('bad', bad);
  };

  // What the queue is doing right now, in the bar: "Waiting 4 s [Open now]", "Loading…",
  // "Steam refused — retrying in 25 s [Retry now]". The page area shows the same while it waits.
  let tick = null;
  let waitUntil = 0;
  let waitKind = null; // 'gap' | 'retry' | 'auto' | 'autoRetry' | 'loading' | null
  let onNow = null;
  const drawWait = () => {
    const left = waitUntil - Date.now();
    const timed = waitKind && waitKind !== 'loading';
    chip.hidden = !waitKind;
    chip.classList.toggle('bad', waitKind === 'retry' || waitKind === 'autoRetry');
    const label = !waitKind ? '' : waitKind === 'loading' ? tr('sq.loading')
      : tr('sq.wait.' + waitKind, { s: secs(left) });
    box.querySelector('.sq-wait-text').textContent = label;
    const nowBtn = chip.querySelector('[data-q="now"]');
    nowBtn.hidden = !onNow;
    nowBtn.textContent = waitKind === 'retry' ? tr('sq.retryNow') : tr('sq.openNow');
    const showHold = timed && !hold.dataset.ask;
    if (showHold) {
      hold.hidden = false;
      hold.querySelector('.sq-hold-title').textContent = label;
      hold.querySelector('.sq-hold-text').textContent = tr(waitKind === 'retry' || waitKind === 'autoRetry' ? 'sq.holdRetry' : 'sq.holdGap');
      // Only when it changes: replacing the button every tick would swallow clicks on it.
      const html = onNow ? `<button class="sq-btn" data-q="now">${esc(waitKind === 'retry' ? tr('sq.retryNow') : tr('sq.openNow'))}</button>` : '';
      const btns = hold.querySelector('.sq-hold-buttons');
      if (btns.dataset.html !== html) { btns.innerHTML = html; btns.dataset.html = html; }
    } else if (!hold.dataset.ask) hold.hidden = true;
  };
  const setWait = (kind, ms = 0, now = null) => {
    clearInterval(tick);
    waitKind = kind;
    waitUntil = Date.now() + ms;
    onNow = now;
    if (kind && kind !== 'loading') tick = setInterval(() => { if (!box.isConnected) clearInterval(tick); else drawWait(); }, 250);
    drawWait();
  };
  let askCancel = null; // ends an open "open now?" question (the wait ended by itself)
  const clearWait = (kind) => { if (!kind || waitKind === kind) { if (askCancel) askCancel(); setWait(null); } };

  // Opening a held page at once may get "Sorry! Too many requests". Ask first (once per window
  // if the user says so).
  const confirmNow = () => new Promise((resolve) => {
    if (!askNow) return resolve(true);
    hold.dataset.ask = '1';
    hold.hidden = false;
    hold.querySelector('.sq-hold-title').textContent = tr('sq.nowTitle');
    hold.querySelector('.sq-hold-text').textContent = tr('sq.nowWarn');
    const btns = hold.querySelector('.sq-hold-buttons');
    btns.dataset.html = '';
    btns.innerHTML = `<label class="sq-ask-check"><input type="checkbox" class="sq-noask"> ${esc(tr('sq.noAsk'))}</label>
      <button class="sq-btn" data-a="wait">${esc(tr('sq.keepWaiting'))}</button>
      <button class="sq-btn sq-primary" data-a="go">${esc(tr('sq.openNow'))}</button>`;
    const finish = (yes) => {
      hold.removeEventListener('click', onClick);
      askCancel = null;
      delete hold.dataset.ask;
      drawWait();
      resolve(yes);
    };
    const onClick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'go' && hold.querySelector('.sq-noask').checked) askNow = false;
      finish(a === 'go');
    };
    askCancel = () => finish(false);
    hold.addEventListener('click', onClick);
  });

  // Pages load at most one per gap: moving quickly through the list only loads the mod it
  // stops on. The webview must also finish its own start-up first, or its first load replaces
  // ours.
  let ready = false;
  let lastLoad = 0;
  let loadTimer = null;
  let retryTimer = null;
  const go = (url) => {
    clearTimeout(loadTimer);
    if (!ready || !box.isConnected) return;
    lastLoad = Date.now();
    clearWait();
    view.src = url;
  };
  const load = (url) => {
    clearTimeout(loadTimer);
    const left = lastLoad ? gapMs - (Date.now() - lastLoad) : 0;
    if (left <= 400) { loadTimer = setTimeout(() => go(url), lastLoad ? 250 : 0); return; }
    setWait('gap', left, async () => { if (await confirmNow()) go(url); });
    loadTimer = setTimeout(() => go(url), left);
  };
  const show = (i) => {
    if (!items[i]) return;
    cur = i;
    clearTimeout(retryTimer);
    load(items[i].url);
    drawList();
    list.querySelector('.sq-item.current')?.scrollIntoView({ block: 'nearest' });
  };

  const pageState = async () => {
    try { return await view.executeJavaScript(STATE_SCRIPT); } catch { return null; }
  };

  const waitLoad = () => new Promise((resolve) => {
    const done = () => { view.removeEventListener('did-stop-loading', done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 20000);
    view.addEventListener('did-stop-loading', done);
  });

  // Waits ms in the bar with a countdown; "now" (when given) ends it early.
  const countdown = (kind, ms, canSkip) => new Promise((resolve) => {
    if (ms <= 0) return resolve();
    let t = null;
    let finished = false;
    const poll = setInterval(() => { if (stop || !box.isConnected) end(); }, 200);
    function end() { if (finished) return; finished = true; clearTimeout(t); clearInterval(poll); clearWait(kind); resolve(); }
    t = setTimeout(end, ms);
    setWait(kind, ms, canSkip ? async () => { if (await confirmNow()) end(); } : null);
  });

  const step = (d) => { if (!running && !hold.dataset.ask && panel.hidden) show(Math.max(0, Math.min(items.length - 1, cur + d))); };
  const onKey = (e) => {
    if (!box.isConnected) { window.removeEventListener('keydown', onKey, true); return; }
    if (e.ctrlKey || e.altKey || e.metaKey || !(e.code in KEY_MOVES)) return;
    if (e.target.closest?.('input, textarea, select')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    step(KEY_MOVES[e.code]);
  };
  window.addEventListener('keydown', onKey, true);
  view.addEventListener('console-message', (e) => {
    const m = /^__SQKEY__(-?1)$/.exec(e.message || '');
    if (m) step(+m[1]);
  });

  view.addEventListener('did-start-loading', () => { if (!running && !waitKind && view.getURL() !== 'about:blank') setWait('loading'); });

  // After any page load: is the user logged in, is this mod subscribed already? Did Steam
  // refuse ("too many requests")? Then wait, load it again, and keep a longer gap from now on.
  view.addEventListener('did-stop-loading', async () => {
    clearWait('loading');
    if (view.getURL() === 'about:blank') return;
    view.executeJavaScript(KEY_SCRIPT).catch(() => {});
    const st = await pageState();
    if (!st) return;
    if (st.limited) {
      gapMs = Math.max(gapMs * 1.5, fullGapMs, 3000);
      drawGapInfo();
      setNote(tr('sq.rateLimited', { s: +(gapMs / 1000).toFixed(1) }), true);
      if (!running) {
        clearTimeout(retryTimer);
        const at = cur;
        const retry = () => { clearTimeout(retryTimer); clearWait('retry'); if (cur === at && box.isConnected) { lastLoad = Date.now(); view.reload(); } };
        retryTimer = setTimeout(retry, 30000);
        setWait('retry', 30000, async () => { if (await confirmNow()) retry(); });
      }
      return;
    }
    loggedIn = st.logged;
    markFromPage(st);
    if (!running) setNote(loggedIn ? tr('sq.loggedIn') : tr('sq.notLoggedIn'), !loggedIn);
  });

  // The page's subscribe state belongs to the mod whose page it is — not to the one selected
  // in the list, which may have changed while the page was loading.
  const workshopIdOf = (url) => { try { return new URL(url).searchParams.get('id'); } catch { return null; } };
  const pageItem = () => {
    const id = workshopIdOf(view.getURL());
    return id ? items.find((it) => !it.search && workshopIdOf(it.url) === id) : null;
  };
  const markFromPage = (st) => {
    const it = pageItem();
    if (!it || !st?.button) return;
    it.checked = true; // its page was seen: status is Steam's word (onClose may clear an old mark)
    const status = st.subscribed ? 'subscribed' : it.status === 'subscribed' ? undefined : it.status;
    if (status !== it.status) { it.status = status; drawList(); }
  };
  // Subscribe / Unsubscribe on the page doesn't load a new page: look every second and a half.
  const watch = setInterval(async () => {
    if (!box.isConnected) { clearInterval(watch); return; }
    if (running || !ready || view.isLoading?.() || view.getURL() === 'about:blank') return;
    const st = await pageState();
    if (st && !st.limited) markFromPage(st);
  }, 1500);

  const runAuto = async () => {
    running = true;
    stop = false;
    clearTimeout(loadTimer);
    clearTimeout(retryTimer);
    clearWait();
    drawList();
    const autoGap = Math.max(gapMs, 3000);
    for (let i = 0; i < items.length && !stop; i++) {
      const it = items[i];
      if (it.search || it.status === 'subscribed') continue;
      setNote(tr('sq.autoProgress', { i: i + 1, n: items.length }));
      cur = i;
      drawList();
      list.querySelector('.sq-item.current')?.scrollIntoView({ block: 'nearest' });
      let st = null;
      for (let tries = 0; tries < 4 && !stop; tries++) {
        await countdown('auto', Math.max(autoGap, gapMs) - (Date.now() - lastLoad), false);
        if (stop) break;
        const loaded = waitLoad();
        lastLoad = Date.now();
        view.src = it.url;
        await loaded;
        await sleep(800);
        st = await pageState();
        if (!st?.limited) break;
        // Steam refused: wait a minute, keep a longer gap, and try this mod again.
        gapMs = Math.max(gapMs * 1.5, fullGapMs, 3000);
        drawGapInfo();
        setNote(tr('sq.rateLimitedAuto'), true);
        await countdown('autoRetry', 60000, false);
      }
      if (stop) break;
      if (!st || !st.logged) { setNote(tr('sq.notLoggedIn'), true); break; }
      if (!st.subscribed && st.button) {
        await view.executeJavaScript(CLICK_SCRIPT).catch(() => {});
        await sleep(1500);
        await view.executeJavaScript(DIALOG_SCRIPT).catch(() => {});
        await sleep(1500);
        st = await pageState();
      }
      it.status = st?.subscribed ? 'subscribed' : 'failed';
      drawList();
    }
    running = false;
    clearWait();
    if (!stop) setNote(tr('sq.autoDone', { n: items.filter((it) => it.status === 'subscribed').length, total: items.length }));
    drawList();
  };

  // ⚙: the Workshop subscribe settings, right here (the same as in the app's Settings).
  const gapInput = panel.querySelector('[data-s="gap"]');
  const warn = panel.querySelector('.sq-set-warn');
  let pendingGap = null; // a shorter wait waiting for "Shorten"
  const drawSettings = () => {
    panel.querySelector('[data-s="auto"]').checked = auto;
    panel.querySelector('[data-s="count"]').checked = gapByCount;
    gapInput.value = pendingGap ?? gapSec;
    warn.hidden = pendingGap === null;
    if (pendingGap !== null) warn.querySelector('.sq-set-warn-text').textContent = tr('sq.gapLowText', { s: pendingGap, d: SQ_DEFAULT_GAP });
  };
  const applySettings = () => {
    fullGapMs = gapSec * 1000;
    gapMs = sqGapFor(items.length, gapSec, gapByCount) * 1000;
    drawGapInfo();
    drawList();
    if (onSettings) onSettings({ subAuto: auto, subGap: gapSec, subGapByCount: gapByCount });
  };
  panel.addEventListener('change', (e) => {
    const k = e.target.dataset.s;
    if (k === 'auto') {
      auto = e.target.checked;
      if (!auto && running) { stop = true; setNote(tr('sq.stopped')); }
      applySettings();
    } else if (k === 'count') {
      gapByCount = e.target.checked;
      applySettings();
    } else if (k === 'gap') {
      const v = Math.min(120, Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 2) / 2));
      if (v < gapSec && v < SQ_DEFAULT_GAP) pendingGap = v; // ask first
      else { pendingGap = null; gapSec = v; applySettings(); }
      drawSettings();
    }
  });
  panel.addEventListener('click', (e) => {
    const k = e.target.closest('button')?.dataset.s;
    if (k === 'warn-ok') { gapSec = pendingGap; pendingGap = null; applySettings(); drawSettings(); }
    else if (k === 'warn-no') { pendingGap = null; drawSettings(); }
    else if (k === 'close') { pendingGap = null; panel.hidden = true; }
  });

  box.addEventListener('click', (e) => {
    if (hold.dataset.ask) return;
    if (e.target.closest('.sq-set')) return; // the "open now?" question answers itself
    const row = e.target.closest('.sq-item');
    if (row && !running) return show(+row.dataset.i);
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (!q) return;
    if (q === 'prev' && !running) show(Math.max(0, cur - 1));
    else if (q === 'next' && !running) show(Math.min(items.length - 1, cur + 1));
    else if (q === 'now' && onNow) onNow();
    else if (q === 'settings') { pendingGap = null; drawSettings(); panel.hidden = !panel.hidden; }
    else if (q === 'steam' && items[cur]) openExternal(items[cur].steamUrl);
    else if (q === 'auto') { if (running) { stop = true; setNote(tr('sq.stopped')); } else runAuto(); }
    else if (q === 'close') { stop = true; clearTimeout(loadTimer); clearTimeout(retryTimer); clearInterval(tick); clearInterval(watch); window.removeEventListener('keydown', onKey, true); onClose(items); }
  });

  view.addEventListener('dom-ready', () => {
    if (ready) return;
    ready = true;
    show(cur);
  });
  drawGapInfo();
  drawList();
  show(0);
  return { stop: () => { stop = true; } };
}
