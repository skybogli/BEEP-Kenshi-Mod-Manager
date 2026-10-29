// ===== Pop-up menus with grey headings and sub-menus =====
// (Shared by the category menu, the empty-space selection menu and the category list.)
// items: 'sep' | { heading, tip? } | { text, keys?, check?, danger?, disabled?, tip?, fn(ev) }
//        | { text, sub: items }. A click gets its event, so fn can look at ev.shiftKey.
// The app gives POP_CLS: the class names of its own right-click menu (look and theme).
const POP = (() => {
  let panels = [];
  const close = () => {
    panels.forEach((p) => p.remove());
    panels = [];
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
  };
  const outside = (e) => { if (!panels.some((p) => p.contains(e.target))) close(); };
  const place = (el, x, y, fromRight = null) => {
    el.style.left = '0px';
    el.style.top = '0px';
    const r = el.getBoundingClientRect();
    let left = x;
    if (left + r.width > innerWidth - 4) left = fromRight !== null ? fromRight - r.width : innerWidth - r.width - 4;
    el.style.left = Math.max(4, left) + 'px';
    el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  };
  const panel = (items, level) => {
    const el = document.createElement('div');
    el.className = POP_CLS.menu + ' pop-panel';
    el.dataset.level = level;
    let openSub = null;
    const closeFrom = () => { panels.splice(level + 1).forEach((p) => p.remove()); openSub = null; };
    // Leading, trailing and doubled separators (items left out) aren't drawn.
    const list = items.filter(Boolean).filter((it, i, a) => it !== 'sep' || (i > 0 && i < a.length - 1 && a[i + 1] !== 'sep'));
    for (const it of list) {
      const row = document.createElement('div');
      if (it === 'sep') { row.className = POP_CLS.sep; el.appendChild(row); continue; }
      if (it.heading !== undefined) {
        row.className = POP_CLS.label + ' pop-heading';
        row.textContent = it.heading;
        if (it.tip) row.title = it.tip;
        el.appendChild(row);
        continue;
      }
      row.className = POP_CLS.item + ' pop-item' + (it.disabled ? ' disabled pop-disabled' : '') + (it.danger ? ' ' + POP_CLS.danger : '') + (it.sub ? ' pop-has-sub' : '');
      if (it.tip) row.title = it.tip;
      row.innerHTML = `<span class="pop-check">${it.check ? '✓' : ''}</span><span class="pop-text"></span><span class="pop-keys">${it.sub ? '▸' : ''}</span>`;
      row.querySelector('.pop-text').textContent = it.text;
      // it.icon: the app's own inline SVG (the column buttons' icons), before the text
      if (it.icon) row.querySelector('.pop-text').insertAdjacentHTML('afterbegin', `<span class="pop-icon">${it.icon}</span>`);
      if (it.keys) row.querySelector('.pop-keys').textContent = it.keys;
      row.addEventListener('mouseenter', () => {
        if (openSub === row) return;
        closeFrom();
        if (!it.sub || it.disabled) return;
        openSub = row;
        const sub = panel(it.sub, level + 1);
        document.body.appendChild(sub);
        panels.push(sub);
        const r = row.getBoundingClientRect();
        place(sub, r.right - 2, r.top - 4, r.left + 2);
      });
      if (!it.sub && !it.disabled) row.addEventListener('click', (ev) => { close(); it.fn(ev); });
      el.appendChild(row);
    }
    return el;
  };
  const open = (items, x, y) => {
    close();
    const el = panel(items, 0);
    document.body.appendChild(el);
    panels.push(el);
    place(el, x, y);
    setTimeout(() => {
      document.addEventListener('mousedown', outside, true);
      window.addEventListener('blur', close);
      window.addEventListener('resize', close);
    });
  };
  document.addEventListener('keydown', (e) => {
    if (panels.length && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  document.addEventListener('scroll', (e) => { if (panels.length && !panels.some((p) => p.contains(e.target))) close(); }, true);
  return { open, close, isOpen: () => panels.length > 0 };
})();

// ===== Drag to reorder (the category list; the Sort dialog's rows after a long press) =====
// opts: { item: selector, key(el), drop(key, toIndex, beforeKey), longPress: ms (0 = a plain drag),
//         skip: selector of parts that keep their own mouse behaviour,
//         area(): the scrolling list, when it's drawn again inside `container` }
function dragReorder(container, opts) {
  let press = null; // { el, key, x, y, timer, live }
  let line = null;
  const area = () => (opts.area ? opts.area() : container) || container;
  const items = () => [...area().querySelectorAll(opts.item)];
  const targetIndex = (y) => {
    const list = items().filter((el) => el !== press.el);
    let i = 0;
    for (const el of list) {
      const r = el.getBoundingClientRect();
      if (y > r.top + r.height / 2) i++;
    }
    return i;
  };
  const showLine = (y) => {
    const list = items().filter((el) => el !== press.el);
    const i = targetIndex(y);
    const box = area();
    const cr = box.getBoundingClientRect();
    const ref = list[i] ? list[i].getBoundingClientRect().top : (list[list.length - 1]?.getBoundingClientRect().bottom ?? cr.top);
    if (!line) { line = document.createElement('div'); line.className = 'reorder-line'; document.body.appendChild(line); }
    Object.assign(line.style, { left: cr.left + 4 + 'px', width: cr.width - 8 + 'px', top: ref - 1 + 'px' });
    // Near the top / bottom edge: scroll that way.
    if (y < cr.top + 24) box.scrollTop -= 10;
    else if (y > cr.bottom - 24) box.scrollTop += 10;
  };
  const start = () => {
    press.live = true;
    press.el.classList.add('reordering');
    document.body.classList.add('reorder-active');
  };
  const end = () => {
    if (!press) return;
    clearTimeout(press.timer);
    press.el.classList.remove('reordering', 'reorder-armed');
    document.body.classList.remove('reorder-active');
    line?.remove();
    line = null;
    press = null;
  };
  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest(opts.item);
    if (!el || !container.contains(el) || (opts.skip && e.target.closest(opts.skip))) return;
    press = { el, key: opts.key(el), x: e.clientX, y: e.clientY, live: false };
    if (opts.longPress) {
      press.timer = setTimeout(() => { if (press) { el.classList.add('reorder-armed'); start(); showLine(press.y); } }, opts.longPress);
    }
  });
  document.addEventListener('pointermove', (e) => {
    if (!press) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (!press.live) {
      // Long press: moving first is a normal drag / scroll, not a reorder.
      if (opts.longPress) { if (moved > 6) end(); return; }
      if (moved < 5) return;
      start();
    }
    e.preventDefault();
    press.y = e.clientY;
    showLine(e.clientY);
  });
  document.addEventListener('pointerup', (e) => {
    if (!press) return;
    if (press.live) {
      const key = press.key;
      const to = targetIndex(e.clientY);
      const before = items().filter((el) => el !== press.el)[to];
      const beforeKey = before ? opts.key(before) : null;
      // The click that ends a drag isn't a click on the item.
      const swallow = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      end();
      opts.drop(key, to, beforeKey);
      return;
    }
    end();
  });
  window.addEventListener('blur', end);
}

// ===== The category menu =====
// Right-click on a category header (and its ⇅), or on a category in the category list.
// CM is this app's side (see the adapter next to this file's script tag).
function categoryMenu(catId, x, y) {
  const n = (count) => (count ? ` (${count})` : '');
  const ids = CM.cats();
  const i = ids.indexOf(catId);
  const last = ids.length - 1;
  const uncat = CM.isUncat(catId);
  const editable = CM.canRename ? CM.canRename(catId) : !uncat;
  const vertical = CM.vertical();
  const fit = vertical ? null : CM.fitMode(catId);
  const files = CM.modsIn(catId);
  const pinned = files.filter(CM.pinned);
  const missing = files.filter(CM.missing);
  const links = CM.links ? CM.links(catId) : null;
  const items = [
    { heading: CM.name(catId) },
    editable && { text: '✎ ' + CM.t('cm.rename'), fn: () => CM.rename(catId) },
    editable && CM.pickColor && { text: '🎨 ' + CM.t('cm.color'), fn: () => CM.pickColor(catId) },
    // (an app with categories that can be kept from loading)
    CM.noLoad && { text: '🚫 ' + CM.t('cm.noLoad'), check: CM.noLoad(catId), tip: CM.t('cm.noLoadTip'), fn: () => CM.setNoLoad(catId, !CM.noLoad(catId)) },
    'sep',
    { heading: CM.sortState(catId) },
    { text: '⇅ ' + CM.t('sortRule.openSettings'), fn: () => CM.sortSettings(catId) },
    ...CM.sortItems(catId),
    'sep',
    { heading: CM.t('cm.placeHead') },
    { text: (vertical ? '▲ ' : '◀ ') + CM.t(vertical ? 'cm.moveUp' : 'cm.moveFwd'), keys: CM.keys('colLeft'), disabled: i <= 0, fn: () => CM.moveTo(catId, i - 1) },
    { text: (vertical ? '▼ ' : '▶ ') + CM.t(vertical ? 'cm.moveDown' : 'cm.moveBack'), keys: CM.keys('colRight'), disabled: i >= last, fn: () => CM.moveTo(catId, i + 1) },
    { text: '⏮ ' + CM.t(vertical ? 'cm.moveTop' : 'cm.moveFirst'), keys: CM.keys('colFirst'), disabled: i <= 0, fn: () => CM.moveTo(catId, 0) },
    { text: '⏭ ' + CM.t(vertical ? 'cm.moveBottom' : 'cm.moveLast'), keys: CM.keys('colLast'), disabled: i >= last, fn: () => CM.moveTo(catId, last) },
    fit && 'sep',
    fit && { heading: CM.t('cm.widthHead') },
    fit && { icon: SHRINK_ICON, text: CM.t('cm.shrink'), check: fit === 'shrink', fn: () => CM.toggleFit(catId, 'shrink') },
    fit && { icon: EXPAND_ICON, text: CM.t('cm.expand'), check: fit === 'expand', fn: () => CM.toggleFit(catId, 'expand') },
  ];
  const modItems = [
    links && links.link.length && { text: '🔗 ' + CM.t('cm.linkAll') + n(links.link.length), fn: () => CM.link(links.link) },
    links && links.unlink.length && { text: CM.t('cm.unlinkAll') + n(links.unlink.length), fn: () => CM.unlink(links.unlink) },
    pinned.length && { text: '📌 ' + CM.t('cm.unpin') + n(pinned.length), fn: () => CM.unpin(pinned) },
    missing.length && { text: CM.t('cm.getMissing') + n(missing.length), fn: () => CM.getMissing(missing) },
  ].filter(Boolean);
  if (modItems.length) items.push('sep', { heading: CM.t('cm.modsHead') }, ...modItems);
  if (CM.canDelete ? CM.canDelete(catId) : !uncat) items.push('sep', { text: '✕ ' + CM.t('cm.delete'), danger: true, fn: () => CM.remove(catId) });
  POP.open(items, x, y);
}

// ===== Empty space in a category (or the load order): choose mods by a condition =====
// A plain click: just these mods; with Shift: added to the selection.
function selectionMenu(catId, x, y) {
  const choose = (keys) => (ev) => {
    const base = ev.shiftKey ? SEL.list() : [];
    SEL.replace([...new Set([...base, ...keys])]);
    if (keys.length) SEL.anchor(keys[keys.length - 1]);
    SEL.draw();
    CM.status(CM.t(ev.shiftKey ? 'cm.selAdded' : 'cm.selChosen', { n: keys.length }));
  };
  const group = (keys) => {
    const pick = (test) => keys.filter(test);
    return [
      { text: CM.t('cm.selAll') + ` (${keys.length})`, disabled: !keys.length, fn: choose(keys) },
      { text: CM.t('cm.selOn'), test: CM.on },
      { text: CM.t('cm.selOff'), test: (k) => !CM.on(k) },
      CM.hasPins && { text: '📌 ' + CM.t('cm.selPinned'), test: CM.pinned },
      { text: CM.t('cm.selMissing'), test: CM.missing },
    ].filter(Boolean).map((it) => {
      if (!it.test) return it;
      const found = pick(it.test);
      return { text: it.text + ` (${found.length})`, disabled: !found.length, fn: choose(found) };
    });
  };
  const all = CM.allMods();
  const problems = CM.problems ? CM.problems() : null;
  const extras = CM.extraConditions ? CM.extraConditions(all) : [];
  const toItem = (c) => (c.sub ? { text: c.text, sub: c.sub.map(toItem) } : { text: c.text + ` (${c.keys.length})`, disabled: !c.keys.length, fn: choose(c.keys) });
  const here = catId ? CM.modsIn(catId) : null;
  const shiftTip = CM.t('cm.shiftAdds');
  const items = here
    ? [{ heading: CM.t('cm.selHere', { name: CM.name(catId) }), tip: shiftTip }, ...group(here), 'sep',
      { text: CM.t('cm.selEverywhere'), sub: group(all) }]
    : [{ heading: CM.t('cm.selEverywhereHead'), tip: shiftTip }, ...group(all)];
  if (problems) {
    items.push('sep', { text: '⚠ ' + CM.t('cm.nextProblem', { n: problems.length }), keys: CM.keys('problemNext'), disabled: !problems.length, fn: () => jumpToProblem(1) });
  }
  if (extras.length) items.push(problems ? null : 'sep', { text: CM.t('cm.moreConditions'), sub: extras.map(toItem) });
  items.push('sep');
  if (here) {
    items.push({ text: CM.t('cm.invertHere'), disabled: !here.length, fn: () => {
      const sel = new Set(SEL.list());
      SEL.replace([...sel].filter((k) => !here.includes(k)).concat(here.filter((k) => !sel.has(k))));
      SEL.draw();
    } });
  }
  items.push({ text: CM.t('cm.clearSel'), disabled: !SEL.list().length, fn: () => { SEL.replace([]); SEL.draw(); } });
  POP.open(items, x, y);
}

// ===== F8 / Shift+F8: the next / previous mod with a problem (in load order) =====
let problemAt = -1;
function jumpToProblem(dir) {
  const list = CM.problems ? CM.problems() : [];
  if (!list.length) { CM.status(CM.t('cm.noProblems')); return; }
  // From the selected mod if it's one of them, else from the last one shown.
  const cur = list.findIndex((p) => p.key === SEL.list()[SEL.list().length - 1]);
  const from = cur !== -1 ? cur : problemAt;
  problemAt = ((from === -1 ? (dir > 0 ? -1 : 0) : from) + dir + list.length) % list.length;
  const p = list[problemAt];
  CM.reveal(p.key);
  CM.status(CM.t('cm.problemAt', { i: problemAt + 1, n: list.length, name: CM.modName(p.key), why: p.text }), true);
}

// ===== Ctrl+Shift+Alt+Home / End: the focused category to the front / back =====
function moveFocusedCategoryToEnd(last) {
  const catId = CM.focusedCat();
  if (!catId) return;
  const ids = CM.cats();
  CM.moveTo(catId, last ? ids.length - 1 : 0);
}

// ===== Wiring: right-clicks and the category list =====
(() => {
  // Category headers (and ⇅ on them): the category menu. Capture, so the old menu doesn't open.
  document.addEventListener('contextmenu', (e) => {
    if (CM.blocked()) return;
    const header = e.target.closest?.(CM.headerSel);
    if (header && CM.catOfHeader(header)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      categoryMenu(CM.catOfHeader(header), e.clientX, e.clientY);
      return;
    }
    const navItem = e.target.closest?.(CM.navItemSel);
    if (navItem) {
      e.preventDefault();
      e.stopImmediatePropagation();
      categoryMenu(navItem.dataset.cat, e.clientX, e.clientY);
      return;
    }
    // Empty space: in a category's list (not on a mod), or in the load order list.
    if (e.target.closest?.('.mod-card, input, button, a, select, textarea')) return;
    const col = e.target.closest?.('.category-column');
    if (col && e.target.closest(CM.colBodySel) && CM.catOfColumn(col)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectionMenu(CM.catOfColumn(col), e.clientX, e.clientY);
      return;
    }
    if (e.target.closest?.(CM.orderListSel)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectionMenu(null, e.clientX, e.clientY);
    }
  }, true);
  // The category list: drag a category to a new place.
  dragReorder(CM.navList, {
    item: CM.navItemSel,
    key: (el) => el.dataset.cat,
    drop: (catId, to) => CM.moveTo(catId, to),
  });
  // The Sort dialog's rows: press and hold, then drag (the dialog keeps it in its draft).
  if (CM.sortRows) {
    dragReorder(CM.sortRows.container, {
      item: CM.sortRows.item,
      key: (el) => el.dataset.id,
      longPress: 350,
      skip: CM.sortRows.skip,
      area: CM.sortRows.area,
      drop: (id, to, beforeId) => sortReorderDrop?.(id, to, beforeId),
    });
  }
})();

// ===== Mods dropped on the category list: into that category =====
// Dragging mods over a category there opens it into three places, as on the import board: the
// top / after the mods that are on / the bottom (the default when dropped on its name).
(() => {
  let modDrag = false;
  let open = null;
  const close = () => {
    if (!open) return;
    open.classList.remove('nav-drop-open');
    open.querySelector('.nav-drop')?.remove();
    open = null;
  };
  document.addEventListener('dragstart', (e) => { modDrag = !!e.target.closest?.('.mod-card'); }, true);
  document.addEventListener('dragend', () => { modDrag = false; close(); }, true);
  CM.navList.addEventListener('dragover', (e) => {
    if (!modDrag) return;
    const item = e.target.closest(CM.navItemSel);
    if (!item) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (open !== item) {
      close();
      open = item;
      item.classList.add('nav-drop-open');
      const zones = document.createElement('div');
      zones.className = 'nav-drop';
      for (const pos of ['top', 'afterActive', 'bottom']) {
        const z = document.createElement('div');
        z.className = 'nav-drop-zone';
        z.dataset.pos = pos;
        z.textContent = CM.t('imp.zone.' + pos);
        zones.appendChild(z);
      }
      item.appendChild(zones);
    }
    const zone = e.target.closest('.nav-drop-zone');
    open.querySelectorAll('.nav-drop-zone').forEach((z) => z.classList.toggle('on', z === zone || (!zone && z.dataset.pos === 'bottom')));
  });
  CM.navList.addEventListener('dragleave', (e) => {
    if (open && !CM.navList.contains(e.relatedTarget)) close();
  });
  CM.navList.addEventListener('drop', (e) => {
    if (!modDrag || !open) return;
    e.preventDefault();
    const pos = e.target.closest('.nav-drop-zone')?.dataset.pos || 'bottom';
    const catId = open.dataset.cat;
    const keys = CM.draggedMods(e);
    close();
    modDrag = false;
    if (keys.length) CM.dropMods(keys, catId, pos);
  });
})();
