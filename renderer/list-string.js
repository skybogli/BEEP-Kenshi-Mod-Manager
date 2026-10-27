// ===== A mod list as one string ('BEEP1:…', lib/list-string.js) =====
// 가져오기 ▾ → 문자열로 가져오기… (Ctrl+I): the string pasted (or found on the clipboard) is
// checked, then shown in the mod list viewer, opened in the import settings, or saved as the
// list file it was made from. A txt holding such a string opens with 가져오기 / the viewer too
// (listTextOf). The export side is the advanced export's "문자열" format (editing.js).

// The list file's text from what a file holds: the file itself, or the string in it.
async function listTextOf(content) {
  if (!(await window.api.listStrLooks(content))) return { text: content };
  return window.api.listStrDecode(content);
}

// (r = the answer: { error, game } for another manager's string, { error, message } for a save)
function listStringError(code, extra = '') {
  return t('strImp.err.' + (['other', 'prefix', 'chars', 'zlib', 'notList', 'save'].includes(code) ? code : 'zlib'), { e: extra, game: extra });
}

async function importStringModal() {
  if (dialogOpen() || mainScreen.classList.contains('hidden')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box km-choice" style="width:min(640px,92vw)">
      <div class="modal-title">${escapeText(t('strImp.title'))}</div>
      <div class="km-choice-text">${escapeText(t('strImp.text'))}</div>
      <textarea class="km-str-input" spellcheck="false" placeholder="BEEP1:…" style="width:100%;height:150px;resize:vertical;box-sizing:border-box;font-family:Consolas,monospace;font-size:12px;margin:8px 0;padding:6px;background:#141418;color:inherit;border:1px solid #34343c;border-radius:4px"></textarea>
      <div class="km-str-state" style="min-height:18px;font-size:12px"></div>
      <div class="modal-buttons">
        <button class="btn" data-k="cancel">${escapeText(t('modal.cancel'))}</button>
        <button class="btn" data-k="save" disabled>${escapeText(t('strImp.save'))}</button>
        <button class="btn" data-k="import" disabled>${escapeText(t('strImp.import'))}</button>
        <button class="btn btn-primary" data-k="view" disabled>${escapeText(t('strImp.view'))}</button>
      </div></div>`;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector('textarea');
  const state = overlay.querySelector('.km-str-state');
  const btn = (k) => overlay.querySelector(`[data-k="${k}"]`);
  const close = () => overlay.remove();
  let ok = null; // { text, src } when the string is good
  const check = async () => {
    ok = null;
    for (const k of ['save', 'import', 'view']) btn(k).disabled = true;
    const v = ta.value;
    if (!v.trim()) { state.textContent = ''; return; }
    const r = await window.api.listStrDecode(v);
    if (ta.value !== v) return; // typed on meanwhile
    const src = r.error ? null : parseImportText(r.text);
    if (r.error || !src) { state.style.color = '#e06c75'; state.textContent = listStringError(r.error || 'notList', r.game); return; }
    ok = { text: r.text, src };
    state.style.color = '#98c379';
    state.textContent = t('strImp.ok', { n: src.entries.length, c: src.cats ? src.cats.length : 0, when: src.savedAt ? new Date(src.savedAt).toLocaleString() : '-' });
    for (const k of ['save', 'import', 'view']) btn(k).disabled = false;
  };
  let timer = null;
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 150); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  overlay.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k || e.target.disabled) return;
    if (k === 'cancel') { close(); return; }
    if (!ok) return;
    const d = new Date();
    const p2 = (v) => String(v).padStart(2, '0');
    const stamp = `${p2(d.getFullYear() % 100)}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    if (k === 'save') {
      const r = await window.api.listStrSave(ta.value, `BEEP-mod-list_${stamp}.txt`);
      if (r.canceled) return;
      if (r.error) { state.style.color = '#e06c75'; state.textContent = listStringError(r.error, r.message); return; }
      close();
      setStatus(t('strImp.saved', { path: r.path }), 'success');
    } else if (k === 'import') {
      close();
      importPreview(ok.src);
    } else if (k === 'view') {
      const r = await window.api.vwOpen({ virtual: true, name: `${t('strImp.vwName')} ${stamp}.txt`, content: ok.text });
      if (r?.error === 'max') { state.style.color = '#e06c75'; state.textContent = t('vw.max', { n: r.max }); return; }
      close();
    }
  });
  // a string on the clipboard comes in at once
  try {
    const clip = await window.api.readText();
    if (clip && (await window.api.listStrLooks(clip))) { ta.value = clip.trim(); state.textContent = t('strImp.fromClip'); check(); }
  } catch { /* nothing there */ }
  ta.focus();
}
