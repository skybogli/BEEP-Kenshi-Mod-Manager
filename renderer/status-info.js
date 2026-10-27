// ===== Bottom bar, right side: alerts (only when there are some), the mod counts, app info =====
// SB (cat-adapter.js) is this app's side. Drawn again (at most once a frame) after the lists are
// drawn and on clicks / keys, and once a second for what comes in later (Workshop / portal data,
// a conflict check, the zoom).
const STATUS_INFO = (() => {
  const el = SB.el;
  el.classList.add('sb-right');
  let acts = [];
  let last = '';
  let pending = false;
  const chip = (it) => {
    let attr = '';
    if (it.act) { attr = ` data-i="${acts.length}"`; acts.push(it.act); }
    return `<span class="sb-item${it.cls ? ' sb-' + it.cls : ''}"${attr} title="${SB.esc(it.tip || '')}">${SB.esc(it.text)}</span>`;
  };
  const group = (items) => items.map(chip).join('<span class="sb-dot">·</span>');
  const alerts = () => {
    const list = [];
    const problems = CM.problems ? CM.problems() : [];
    list.push({ n: problems.length, text: t('sb.problems', { n: problems.length }), tip: t('sb.problemsTip'), cls: 'warn', act: () => jumpToProblem(1) });
    const get = SB.toGet();
    list.push({ n: get.length, text: t(SB.getKey, { n: get.length }), tip: t(SB.getKey + 'Tip'), cls: 'error', act: () => CM.getMissing(get) });
    const pins = SB.pins ? SB.pins() : [];
    list.push({ n: pins.length, text: t('sb.pinned', { n: pins.length }), tip: t('sb.pinnedTip'), act: () => { SEL.replace(pins); SEL.draw(); } });
    const clip = SB.clip();
    list.push({ n: clip.length, text: t('sb.clip', { n: clip.length }), tip: t('sb.clipTip', { key: CM.keys('paste') }), act: () => { SEL.replace(clip); SEL.draw(); } });
    const search = SB.search();
    if (search) list.push({ n: 1, text: t('sb.search', { n: search.count }), tip: t('sb.searchTip'), act: SB.clearSearch });
    const zoom = SB.zoom();
    if (Math.abs(zoom - 1) > 0.001) list.push({ n: 1, text: t('sb.zoom', { pct: Math.round(zoom * 100) }), tip: t('sb.zoomTip'), act: SB.resetZoom });
    return list.filter((a) => a.n);
  };
  const draw = () => {
    pending = false;
    if (SB.hidden()) return;
    acts = [];
    const n = SB.counts();
    const counts = [
      { text: t('sb.total', { n: n.total }), tip: t('sb.totalTip') },
      { text: t('sb.on', { n: n.on }), tip: t('sb.onTip') },
      { text: t('sb.sel', { n: n.selected }), tip: t('sb.selTip'), cls: n.selected ? '' : 'dim' },
    ];
    const a = alerts();
    const info = SB.info().filter(Boolean);
    const html = [a.length ? group(a) : '', group(counts), info.length ? group(info) : ''].filter(Boolean).join('<span class="sb-sep"></span>');
    if (html !== last) {
      el.innerHTML = html;
      last = html;
    }
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  };
  el.addEventListener('click', (e) => {
    const item = e.target.closest('[data-i]');
    if (item) acts[+item.dataset.i]?.();
  });
  for (const type of ['click', 'keyup', 'input', 'pointerup']) document.addEventListener(type, schedule, true);
  setInterval(schedule, 1000);
  schedule();
  return { schedule };
})();
