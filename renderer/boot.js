// ===== The loading screen at start (shown by index.html until the first list is drawn) =====
// BOOT.step(percent, text) moves the bar to that point; while a step takes long the bar creeps on
// (never past the next step), so it doesn't look stuck. BOOT.done() fades it out; after that
// every call does nothing (a later refresh doesn't show it again).
const BOOT = (() => {
  const el = document.getElementById('boot-screen');
  let at = 0;
  let target = 0;
  let creep = null;
  const fill = () => el?.querySelector('.boot-fill');
  const show = () => { const f = fill(); if (f) f.style.width = at.toFixed(1) + '%'; };
  return {
    text(t) { const e = el?.querySelector('.boot-text'); if (e) e.textContent = t; },
    step(pct, t) {
      if (!el?.isConnected) return;
      target = Math.max(target, pct);
      at = Math.max(at, Math.min(pct, at + 30)); // a big jump shows at once
      show();
      if (t !== undefined) { const e = el.querySelector('.boot-step'); if (e) e.textContent = t; }
      clearInterval(creep);
      creep = setInterval(() => {
        const cap = Math.min(target + 18, 97);
        if (at < cap) { at += (cap - at) * 0.04; show(); }
      }, 120);
    },
    done() {
      if (!el?.isConnected) return;
      clearInterval(creep);
      at = 100;
      show();
      el.classList.add('boot-out');
      setTimeout(() => el.remove(), 260);
    },
  };
})();
// Something went wrong while starting: don't leave the screen covered.
window.addEventListener('error', () => BOOT.done());
window.addEventListener('unhandledrejection', () => BOOT.done());
