// ===== Fold the load-order panel / the detail panel at once =====
// A small button in the middle of each panel's resize bar hides the panel (the bar stays, with
// the button to bring it back at its old width). config.orderPanelFolded / detailPanelFolded
// keep it for the next start; init calls applyPanelFold().
const PANEL_FOLD = (() => {
  const make = (handleId, panelId, key, side) => {
    const handle = document.getElementById(handleId);
    const panel = document.getElementById(panelId);
    if (!handle || !panel) return null;
    handle.classList.add('km-fold-handle');
    const btn = document.createElement('button');
    btn.className = 'km-fold-btn';
    handle.appendChild(btn);
    const folded = () => panel.classList.contains('km-folded');
    const set = (on, save) => {
      panel.classList.toggle('km-folded', on);
      handle.classList.toggle('km-folded-bar', on);
      // the arrow points where the panel will go
      btn.textContent = (side === 'left') === on ? '▸' : '◂';
      btn.title = t(on ? 'fold.show' : 'fold.hide');
      if (save && config) { config[key] = on; window.api.saveConfig(config); }
    };
    // a press on the button is not a resize; a folded panel isn't resized either
    handle.addEventListener('mousedown', (e) => { if (e.target === btn || folded()) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    btn.addEventListener('click', (e) => { e.stopPropagation(); set(!folded(), true); });
    return set;
  };
  const order = make('order-resize-handle', 'order-panel', 'orderPanelFolded', 'left');
  const detail = make('panel-resize-handle', 'detail-panel', 'detailPanelFolded', 'right');
  return {
    apply() {
      order?.(!!config?.orderPanelFolded, false);
      detail?.(!!config?.detailPanelFolded, false);
    },
  };
})();
function applyPanelFold() { PANEL_FOLD.apply(); }
