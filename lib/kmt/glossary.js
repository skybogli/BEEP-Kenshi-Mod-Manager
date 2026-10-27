// Glossary ('source = translation' lines), main.po reuse, the Google cache and Google itself.
// A source with '=' in it is written 'source =|= translation': a line with '=|=' splits there,
// any other at its first '=' (KMT's way, so older glossaries read as before).
const fs = require('fs');
const path = require('path');
const { readTextLines, decodeText, splitLines, encodeText } = require('./textfile');
const { displayText, decodeStr, encodeStr } = require('./fcs');
const backups = require('./backups');

const SEP2 = '=|=';
// A glossary line -> [source, translation] (null: a note / not an entry).
function splitGlossaryLine(line) {
  const st = line.trim();
  if (!st || st.startsWith('#')) return null;
  let i = st.indexOf(SEP2);
  let w = SEP2.length;
  if (i < 0) { i = st.indexOf('='); w = 1; }
  if (i < 0) return null;
  return [st.slice(0, i).trim().replace(/\\n/g, '\n'), st.slice(i + w).trim().replace(/\\n/g, '\n')];
}
// How a source and its translation are written ('' = no translation yet): ' = ', or ' =|= ' when
// the source has '='. null: it can't be written ('=|=' itself in the source or the translation).
function glossaryLine(src, dst = '') {
  if (src.includes(SEP2) || dst.includes(SEP2)) return null;
  const esc = (t) => t.replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
  return `${esc(src)} ${src.includes('=') ? SEP2 : '='}${dst ? ' ' + esc(dst) : ''}`;
}

// glossary.txt -> { glossary: Map(source -> translation), blank: Set(sources with no translation) }
//   '\n' in the file is a line break; 'source =' keeps the source as it is (no Google);
//   'source =|= translation' for a source with '=' in it.
function loadGlossary(file, log) {
  const glossary = new Map();
  const blank = new Set();
  if (!file) { if (log) log('용어집 미지정 - 용어집 없이 진행합니다.'); return { glossary, blank }; }
  if (!fs.existsSync(file)) { if (log) log(`[안내] 용어집 파일이 없습니다: ${file} (용어집 없이 진행)`); return { glossary, blank }; }
  let lines;
  try { lines = readTextLines(file); } catch { if (log) log('[경고] 용어집 인코딩을 읽을 수 없어 무시합니다.'); return { glossary, blank }; }
  for (const line of lines) {
    const kv = splitGlossaryLine(line);
    if (!kv) continue;
    const [src, dst] = kv;
    if (!src) continue;
    if (dst) { glossary.set(src, dst); blank.delete(src); }
    else if (!glossary.has(src)) { glossary.set(src, src); blank.add(src); }
  }
  if (log) log(`용어집 로드: ${glossary.size}개 항목 (번역이 비어 있어 원문 그대로 유지: ${blank.size}개)`);
  return { glossary, blank };
}

// Put 'source = translation' into the glossary file: an existing source's line is changed,
// new ones go at the end. A dated backup is made first; the file keeps its encoding.
function updateGlossaryFile(file, entries) {
  let lines = [];
  let enc = 'utf-8-sig';
  let backup = '';
  if (fs.existsSync(file)) {
    const d = decodeText(fs.readFileSync(file));
    enc = d.enc;
    lines = splitLines(d.text);
    backup = backups.saveDated(file);
  }
  const pending = new Map();
  let skipped = 0;
  for (const [src0, dst0] of entries) {
    const src = displayText(src0).replace(/\r\n/g, '\n');
    const dst = displayText(dst0);
    if (!src.trim() || !(dst || '').trim() || glossaryLine(src, dst) === null) { skipped++; continue; }
    pending.set(src, dst);
  }
  const done = new Set();
  lines = lines.map((line) => {
    const kv = splitGlossaryLine(line);
    if (!kv || !pending.has(kv[0])) return line;
    done.add(kv[0]);
    return glossaryLine(kv[0], pending.get(kv[0]));
  });
  const added = [...pending].filter(([k]) => !done.has(k));
  if (added.length) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push('');
    lines.push(`# [번역 검수에서 추가 ${backups.stamp('yyMMdd HHmmss')}]`);
    for (const [k, v] of added) lines.push(glossaryLine(k, v));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, encodeText(lines.join('\r\n') + '\r\n', enc));
  fs.renameSync(tmp, file);
  return { replaced: done.size, added: added.length, skipped, path: file, backup };
}

// ---- main.po (a translation the mod already ships) ----
function unquote(s) {
  const m = /^"(.*)"\s*$/.exec(s.trim());
  if (!m) return '';
  return m[1].replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', a: '\x07', b: '\b', f: '\f', v: '\v' }[c] ?? '\\' + c));
}
function loadPo(file) {
  const out = new Map();
  const lines = splitLines(decodeText(fs.readFileSync(file)).text);
  let cur = null;
  let field = null;
  const flush = () => { if (cur && cur.msgid && cur.msgstr && !cur.plural) out.set(cur.msgid, cur.msgstr); cur = null; field = null; };
  for (let line of lines) {
    line = line.replace(/^#~\s?/, '');
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (t.startsWith('#')) continue;
    let m;
    if ((m = /^msgctxt\s+(.*)$/.exec(t))) { flush(); cur = { msgid: '', msgstr: '' }; field = null; continue; }
    if ((m = /^msgid\s+(.*)$/.exec(t))) { if (cur && field && field !== 'ctx') flush(); cur = cur || { msgid: '', msgstr: '' }; cur.msgid = unquote(m[1]); field = 'msgid'; continue; }
    if ((m = /^msgid_plural\s+(.*)$/.exec(t))) { if (cur) cur.plural = true; field = 'plural'; continue; }
    if ((m = /^msgstr\s+(.*)$/.exec(t))) { if (cur) { cur.msgstr = unquote(m[1]); field = 'msgstr'; } continue; }
    if ((m = /^msgstr\[\d+\]\s+(.*)$/.exec(t))) { field = 'plural'; continue; }
    if (t.startsWith('"') && cur && field) {
      if (field === 'msgid') cur.msgid += unquote(t);
      else if (field === 'msgstr') cur.msgstr += unquote(t);
    }
  }
  flush();
  return out;
}

// ---- the Google cache (translations Google already gave) ----
function loadCache(file) {
  if (!fs.existsSync(file)) return new Map();
  try {
    const data = JSON.parse(decodeStr(fs.readFileSync(file)));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('format');
    return new Map(Object.entries(data).filter(([, v]) => v).map(([k, v]) => [String(k), String(v)]));
  } catch {
    // a broken cache is moved aside (saving over it would lose every translation)
    try { fs.renameSync(file, backups.datedPath(file)); } catch { /* left as it is */ }
    return new Map();
  }
}
function saveCache(file, cache) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { atomicWrite } = require('./textfile');
    atomicWrite(file, encodeStr(JSON.stringify(Object.fromEntries(cache))));
  } catch { /* the job goes on */ }
}

// ---- Google Translate (the gtx URL) ----
const TRANSLATE_DELAY = 1.0;
const RETRY_WAITS = [5, 15, 40, 90];

class RateLimitError extends Error {
  constructor(code, wait) { super('HTTP ' + code); this.code = code; this.wait = wait; }
}
class StopError extends Error { constructor() { super('사용자 중지'); } }

async function sleepCheck(sec, stop) {
  const end = Date.now() + sec * 1000;
  for (;;) {
    if (stop && stop()) throw new StopError();
    const left = end - Date.now();
    if (left <= 0) return;
    await new Promise((r) => setTimeout(r, Math.min(500, left)));
  }
}

async function translateLine(text, target = 'ko') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(displayText(text))}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal });
  } finally { clearTimeout(timer); }
  if (res.status === 429 || res.status === 503) {
    const ra = res.headers.get('retry-after');
    throw new RateLimitError(res.status, ra && /^\d+$/.test(ra) ? Number(ra) : null);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const payload = await res.json();
  return (payload[0] || []).filter((seg) => seg && seg[0]).map((seg) => seg[0]).join('');
}

// Translated line by line (keeps the line breaks), waiting between requests and longer and
// longer when Google limits them (429).
async function googleTranslate(text, stop, log, translate = translateLine, delay = TRANSLATE_DELAY) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) { out.push(line); continue; }
    for (let attempt = 0; ; attempt++) {
      if (stop && stop()) throw new StopError();
      try {
        out.push(await translate(line));
        break;
      } catch (e) {
        if (e instanceof StopError) throw e;
        if (e instanceof RateLimitError) {
          if (attempt >= RETRY_WAITS.length) throw e;
          const wait = Math.max(e.wait || 0, RETRY_WAITS[attempt]);
          if (log) log(`   [대기] 구글이 요청을 제한했습니다(${e.message}). ${wait}초 후 다시 시도합니다 (${attempt + 1}/${RETRY_WAITS.length})`);
          await sleepCheck(wait, stop);
        } else {
          if (attempt >= 2) throw e;
          await sleepCheck(2 * (attempt + 1), stop);
        }
      }
    }
    if (delay) await sleepCheck(delay + Math.random() * 0.5, stop);
  }
  return out.join('\n');
}

module.exports = { splitGlossaryLine, glossaryLine, loadGlossary, updateGlossaryFile, loadPo, loadCache, saveCache, googleTranslate, translateLine, StopError, RateLimitError, sleepCheck };
