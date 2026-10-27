// Kenshi FCS (.mod) file reader / writer, ported from Kenshi Mod Translator (KMT).
// Reads a .mod record by record and keeps where every string sits in the file, so a string
// can be swapped for its translation without touching anything else.
//
// Strings in a .mod are UTF-8, but some mods carry other bytes (cp1252 'é' and so on). Like
// Python's surrogateescape, a byte that isn't valid UTF-8 becomes the lone code unit U+DC80+byte
// and goes back to the same byte when written, so String IDs and field names stay exactly as in
// the file.

const MAX_STRING_LEN = 1 << 20; // a string longer than this means the layout guess is wrong
const MAX_COUNT = 5000000;

// FCS itemType numbers
const BUILDING_TYPE = 0;
const DIALOGUE_TYPE = 18;
const DIALOGUE_LINE_TYPE = 19;
const DIALOGUE_PACKAGE_TYPE = 73;
const DIALOGUE_FAMILY = new Set([DIALOGUE_TYPE, DIALOGUE_LINE_TYPE, DIALOGUE_PACKAGE_TYPE]);
// The record Name of these types is only the editor's own label: not translated.
const NAME_SKIP_TYPES = DIALOGUE_FAMILY;

// ModDataType of a record: changed from a mod it depends on (/ and renamed).
const CHANGED = -2147483647;
const CHANGED_RENAMED = -2147483645;

const DIALOGUE_TEXT_RE = /^text ?\d*$/;

class ModParseError extends Error {}

// ---- strings ----
function validLen(b, i) {
  const c = b[i];
  if (c < 0x80) return 1;
  const cont = (j, lo = 0x80, hi = 0xbf) => j < b.length && b[j] >= lo && b[j] <= hi;
  if (c >= 0xc2 && c <= 0xdf) return cont(i + 1) ? 2 : 0;
  if (c >= 0xe0 && c <= 0xef) {
    const lo = c === 0xe0 ? 0xa0 : 0x80;
    const hi = c === 0xed ? 0x9f : 0xbf;
    return cont(i + 1, lo, hi) && cont(i + 2) ? 3 : 0;
  }
  if (c >= 0xf0 && c <= 0xf4) {
    const lo = c === 0xf0 ? 0x90 : 0x80;
    const hi = c === 0xf4 ? 0x8f : 0xbf;
    return cont(i + 1, lo, hi) && cont(i + 2) && cont(i + 3) ? 4 : 0;
  }
  return 0;
}

// bytes -> string (bytes that aren't UTF-8 kept as U+DC80+byte)
function decodeStr(b, start = 0, end = b.length) {
  let out = '';
  let i = start;
  let run = start; // start of a run of plain UTF-8, decoded in one go
  const flush = (to) => { if (to > run) out += b.toString('utf8', run, to); };
  while (i < end) {
    const n = b[i] < 0x80 ? 1 : validLen(b, i);
    if (n && i + n <= end) { i += n; continue; }
    flush(i);
    out += String.fromCharCode(0xdc00 + b[i]);
    i += 1;
    run = i;
  }
  flush(end);
  return out;
}

const ESC_RE = /[\udc80-\udcff]/;
// string -> bytes (U+DC80..U+DCFF back to the byte it came from)
function encodeStr(s) {
  s = s || '';
  if (!ESC_RE.test(s)) return Buffer.from(s, 'utf8');
  const parts = [];
  let run = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xdc80 && c <= 0xdcff && !(i > 0 && s.charCodeAt(i - 1) >= 0xd800 && s.charCodeAt(i - 1) <= 0xdbff)) {
      if (run) { parts.push(Buffer.from(run, 'utf8')); run = ''; }
      parts.push(Buffer.from([c - 0xdc00]));
    } else run += s[i];
  }
  if (run) parts.push(Buffer.from(run, 'utf8'));
  return Buffer.concat(parts);
}

function hasEscaped(s) { return ESC_RE.test(s || ''); }
// For the screen, text files and Google: kept bytes shown as '�'.
function displayText(s) { return encodeStr(s || '').toString('utf8'); }

// ---- reader ----
class BinReader {
  constructor(data, pos = 0) { this.data = data; this.pos = pos; this.size = data.length; }
  need(n) { if (n < 0 || this.pos + n > this.size) throw new ModParseError(`범위 초과 (pos=${this.pos}, need=${n})`); }
  skip(n) { this.need(n); this.pos += n; }
  u8() { this.need(1); return this.data[this.pos++]; }
  i32() { this.need(4); const v = this.data.readInt32LE(this.pos); this.pos += 4; return v; }
  f32() { this.need(4); const v = this.data.readFloatLE(this.pos); this.pos += 4; return v; }
  f32s(n) { this.need(4 * n); const v = []; for (let k = 0; k < n; k++) { v.push(this.data.readFloatLE(this.pos)); this.pos += 4; } return v; }
  count(unit = 1) {
    const n = this.i32();
    if (n < 0 || n > MAX_COUNT || n * unit > this.size - this.pos) throw new ModParseError(`비정상 개수 값: ${n} (pos=${this.pos})`);
    return n;
  }
  string() {
    const n = this.i32();
    if (n < 0 || n > MAX_STRING_LEN) throw new ModParseError(`비정상 문자열 길이: ${n} (pos=${this.pos})`);
    this.need(n);
    const s = decodeStr(this.data, this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
}

function normalizeKey(key) {
  return key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---- layouts ----
// The record / header layout differs between file versions; every combination is tried until
// one reads exactly to the end of the file.
//   lead: an instance count before each record / nameFirst: name before stringId /
//   change: a ModDataType int / quat: a quaternion list after vec3
const RECORD_VARIANTS = [];
for (const lead of [true, false]) for (const nameFirst of [true, false]) for (const change of [true, false]) for (const quat of [true, false]) RECORD_VARIANTS.push({ lead, nameFirst, change, quat });
const PREFERRED = { pre: 0, nStr: 1, post: 1, variant: { lead: true, nameFirst: true, change: true, quat: true } };
let lastLayout = null;

const layoutKey = (c) => `${c.pre}/${c.nStr}/${c.post}/${+c.variant.lead}${+c.variant.nameFirst}${+c.variant.change}${+c.variant.quat}`;

function* layoutCandidates(first) {
  const seen = new Set();
  for (const c of [first, lastLayout, PREFERRED]) {
    if (!c || seen.has(layoutKey(c))) continue;
    seen.add(layoutKey(c));
    yield c;
  }
  for (const pre of [0, 1, 2, 3]) for (const nStr of [4, 3, 5, 2, 6, 1, 0]) for (const post of [0, 1, 2, 3, 4]) for (const variant of RECORD_VARIANTS) {
    const c = { pre, nStr, post, variant };
    if (!seen.has(layoutKey(c))) yield c;
  }
}

const pyBool = (v) => (v ? 'True' : 'False');
const pyVariant = (v) => `{'lead': ${pyBool(v.lead)}, 'name_first': ${pyBool(v.nameFirst)}, 'change': ${pyBool(v.change)}, 'quat': ${pyBool(v.quat)}}`;

function layoutOf(info) { return { ...info.layout, variant: info.variant }; }

function newInfo(wantNumeric) {
  return { typeCounts: new Map(), dlgRecords: 0, dlgTexts: 0, dlgKeys: new Set(), dlgRecs: [], recSids: [], numeric: wantNumeric ? [] : null, headerEnd: null, variant: null, layout: null };
}

// Base field (settings key) for a string field; null when it is not one of the base fields.
function fieldIdFor(nkey, recType) {
  if (nkey === 'category') return 'general.category';
  if (nkey === 'building category') return 'type.building category';
  if (nkey === 'building group') return 'type.building group';
  if (nkey === 'building name') return 'town.building name';
  if (nkey === 'description') return recType === BUILDING_TYPE ? 'type.description' : 'general.description';
  return null;
}

// Span: { start, end, text, fid, sid, key, raw, rec }  (start/end include the 4-byte length;
//   fid 'custom' = not a base field, picked by the user's own rules; raw = null for the Name)
// NumField: { start, kind, raw, key, value, sid, rec }
function parseRecord(r, variant, spans, info) {
  if (variant.lead) r.i32();
  const type = r.i32();
  const id = r.i32();
  let name, sid, nameStart, nameEnd;
  if (variant.nameFirst) {
    nameStart = r.pos; name = r.string(); nameEnd = r.pos; sid = r.string();
  } else {
    sid = r.string(); nameStart = r.pos; name = r.string(); nameEnd = r.pos;
  }
  const rec = { type, id, name, sid };
  info.recSids.push(sid);
  info.typeCounts.set(type, (info.typeCounts.get(type) || 0) + 1);
  const isLine = type === DIALOGUE_LINE_TYPE;
  if (isLine) info.dlgRecords++;
  if (!NAME_SKIP_TYPES.has(type)) spans.push({ start: nameStart, end: nameEnd, text: name, fid: 'base.name', sid, key: 'name', raw: null, rec });
  if (variant.change) r.i32();

  const nums = info.numeric;
  const num = (kind, unit, read) => {
    for (let n = r.count(unit); n > 0; n--) {
      const start = r.pos;
      const raw = r.string();
      const value = read();
      if (nums) nums.push({ start, kind, raw, key: normalizeKey(raw), value, sid, rec });
    }
  };
  num('bool', 5, () => r.u8());
  num('float', 8, () => r.f32());
  num('int', 8, () => r.i32());
  num('vec3', 16, () => r.f32s(3));
  if (variant.quat) num('quat', 20, () => r.f32s(4));

  for (let n = r.count(8); n > 0; n--) {
    const key = r.string();
    const start = r.pos;
    const val = r.string();
    const nkey = normalizeKey(key);
    if (isLine) {
      info.dlgKeys.add(nkey);
      if (DIALOGUE_TEXT_RE.test(nkey)) {
        spans.push({ start, end: r.pos, text: val, fid: 'dialogue.text', sid, key: nkey, raw: key, rec });
        info.dlgTexts++;
      } else spans.push({ start, end: r.pos, text: val, fid: 'custom', sid, key: nkey, raw: key, rec });
    } else {
      spans.push({ start, end: r.pos, text: val, fid: fieldIdFor(nkey, type) || 'custom', sid, key: nkey, raw: key, rec });
    }
  }
  for (let n = r.count(8); n > 0; n--) { r.string(); r.string(); } // file names

  const refs = [];
  for (let n = r.count(8); n > 0; n--) {
    const cat = r.string();
    for (let m = r.count(16); m > 0; m--) {
      const target = r.string();
      r.skip(12);
      refs.push([cat, target]);
    }
  }
  for (let n = r.count(8); n > 0; n--) { // instances
    r.string(); r.string();
    r.skip(28);
    for (let m = r.count(4); m > 0; m--) r.string();
  }
  if (DIALOGUE_FAMILY.has(type)) info.dlgRecs.push({ type, sid, name, refs });
}

// Read a whole .mod. Returns { spans, recCount, info }; info.headerEnd = where the record count
// sits (the header bytes are data[0, headerEnd)).
//   layout: tried first / only: try just that layout (the check before saving)
function parseMod(data, { log, wantNumeric = false, layout = null, only = false } = {}) {
  let best = { pos: -1, layout: null, err: null };
  const cands = only && layout ? [layout] : layoutCandidates(layout);
  for (const c of cands) {
    const r = new BinReader(data);
    const spans = [];
    const info = newInfo(wantNumeric);
    try {
      const version = r.i32();
      if (!(version > 0 && version < 1000)) throw new ModParseError(`비정상 버전: ${version}`);
      r.skip(4 * c.pre);
      for (let k = 0; k < c.nStr; k++) r.string();
      r.skip(4 * c.post);
      const headerEnd = r.pos;
      const recCount = r.count(20);
      if (recCount === 0) throw new ModParseError('레코드 0개');
      for (let k = 0; k < recCount; k++) parseRecord(r, c.variant, spans, info);
      if (r.pos !== r.size) throw new ModParseError(`파일 끝 불일치 (${r.pos}/${r.size})`);
      info.headerEnd = headerEnd;
      info.variant = c.variant;
      info.layout = { pre: c.pre, nStr: c.nStr, post: c.post };
      lastLayout = c;
      if (log) log(`레이아웃 확인: version=${version}, 레코드=${recCount}개 (pre=${c.pre}, str=${c.nStr}, post=${c.post}, ${pyVariant(c.variant)})`);
      return { spans, recCount, info };
    } catch (e) {
      if (!(e instanceof ModParseError) && !(e instanceof RangeError)) throw e;
      if (r.pos > best.pos) best = { pos: r.pos, layout: c, err: e };
    }
  }
  if (log) log(`[진단] 가장 멀리 읽은 시도: 위치=${best.pos}, 오류=${best.err && best.err.message}`);
  throw new ModParseError('지원되는 FCS 구조로 파싱하지 못했습니다: ' + (best.err && best.err.message));
}

// The bytes outside the strings (what translating never changes).
function outsideSpans(data, spans) {
  const parts = [];
  let pos = 0;
  for (const sp of [...spans].sort((a, b) => a.start - b.start)) { parts.push(data.subarray(pos, sp.start)); pos = sp.end; }
  parts.push(data.subarray(pos));
  return Buffer.concat(parts);
}

// Is cur a translation of bak? (same records, same number of strings, same bytes outside them)
// If not, the mod was updated after the .bak was made.
function isDerivedFrom(cur, bak) {
  if (cur.recCount !== bak.recCount || cur.spans.length !== bak.spans.length) return false;
  const a = cur.info.recSids;
  const b = bak.info.recSids;
  if (a.length !== b.length || a.some((s, i) => s !== b[i])) return false;
  return outsideSpans(cur.data, cur.spans).equals(outsideSpans(bak.data, bak.spans));
}

// The source text to work from:
//   no '<mod>.bak' -> the mod itself; the mod is a translation of its .bak -> the .bak (re-running
//   is safe); a .bak that no longer matches (the mod was updated) -> the mod (stale = true).
function readModSource(fs, modPath, log, wantNumeric = false) {
  const bakPath = modPath + '.bak';
  log('모드 파일 읽는 중: ' + modPath);
  const data = fs.readFileSync(modPath);
  const cur = { data, ...parseMod(data, { log, wantNumeric }) };
  const result = (path, x, stale) => ({ srcPath: path, data: x.data, spans: x.spans, recCount: x.recCount, info: x.info, stale });
  if (!fs.existsSync(bakPath)) return result(modPath, cur, false);
  let bak;
  try {
    const bdata = fs.readFileSync(bakPath);
    bak = { data: bdata, ...parseMod(bdata, { wantNumeric, layout: layoutOf(cur.info) }) };
  } catch (e) {
    log(`[경고] 원본 백업(.bak)을 읽지 못해 지금 모드 파일을 원문으로 사용합니다: ${bakPath} (${e.message})`);
    return result(modPath, cur, true);
  }
  if (isDerivedFrom(cur, bak)) {
    log('원본 백업(.bak)을 원문으로 사용합니다: ' + bakPath);
    return result(bakPath, bak, false);
  }
  log(`[경고] 원본 백업(.bak)과 지금 모드 파일의 구조가 다릅니다 (레코드 ${bak.recCount}개 -> ${cur.recCount}개). 모드가 업데이트된 것으로 보고, 오래된 .bak 대신 지금 모드 파일을 원문으로 사용합니다.`);
  return result(modPath, cur, true);
}

// ---- dialogue tree (DIALOGUE_PACKAGE > DIALOGUE > DIALOGUE_LINE) ----
class DialogueIndex {
  constructor(recs) {
    this.bySid = new Map(recs.map((r) => [r.sid, r]));
    this.parents = new Map();
    for (const r of recs) for (const [, target] of r.refs) {
      if (!this.parents.has(target)) this.parents.set(target, []);
      this.parents.get(target).push(r.sid);
    }
    this.order = this.lineOrder(recs);
    this.cache = new Map();
  }
  lineOrder(recs) {
    const order = new Map();
    let counter = 0;
    for (const rec of recs) {
      if (rec.type !== DIALOGUE_TYPE) continue;
      const stack = rec.refs.map(([, t]) => t).reverse();
      while (stack.length) {
        const sid = stack.pop();
        const child = this.bySid.get(sid);
        if (!child || child.type !== DIALOGUE_LINE_TYPE || order.has(sid)) continue;
        order.set(sid, counter++);
        stack.push(...child.refs.map(([, t]) => t).reverse());
      }
    }
    return order;
  }
  ancestors(start) {
    const out = [];
    const seen = new Set([start]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const p of this.parents.get(queue[i]) || []) {
        if (seen.has(p)) continue;
        seen.add(p);
        const rec = this.bySid.get(p);
        if (!rec) continue;
        out.push(rec);
        queue.push(p);
      }
    }
    return out;
  }
  context(lineSid) {
    if (this.cache.has(lineSid)) return this.cache.get(lineSid);
    const anc = this.ancestors(lineSid);
    const dialogue = anc.find((a) => a.type === DIALOGUE_TYPE) || null;
    const base = dialogue ? this.ancestors(dialogue.sid) : anc;
    const pkgs = base.filter((a) => a.type === DIALOGUE_PACKAGE_TYPE).sort((a, b) => cmpStr(a.sid, b.sid));
    const v = { dialogue, pkgs };
    this.cache.set(lineSid, v);
    return v;
  }
}
DialogueIndex.BIG = 1e9;

// Python's string order (by code point), for the same sorting as KMT.
function cmpStr(a, b) {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
}

// ---- writing ----
function i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; }
function packStr(s) { const raw = encodeStr(s); return Buffer.concat([i32(raw.length), raw]); }

// One 'changed from the mod it depends on' record holding only the given fields (the rest of
// the original's values, references and instances stay as they are).
//   newName: the translated name or null / fields: [[raw key, text]] / nums: {bool,float,int,vec3,quat: [[key, value]]}
function packChangedRecord(variant, rec, newName, fields, nums = {}) {
  const b = [];
  if (variant.lead) b.push(i32(0));
  b.push(i32(rec.type), i32(rec.id));
  const name = newName || rec.name;
  if (variant.nameFirst) b.push(packStr(name), packStr(rec.sid));
  else b.push(packStr(rec.sid), packStr(name));
  if (variant.change) b.push(i32(newName ? CHANGED_RENAMED : CHANGED));
  const list = (k) => nums[k] || [];
  const f32 = (v) => { const x = Buffer.alloc(4); x.writeFloatLE(v); return x; };
  b.push(i32(list('bool').length));
  for (const [k, v] of list('bool')) b.push(packStr(k), Buffer.from([v & 0xff]));
  b.push(i32(list('float').length));
  for (const [k, v] of list('float')) b.push(packStr(k), f32(v));
  b.push(i32(list('int').length));
  for (const [k, v] of list('int')) b.push(packStr(k), i32(v));
  b.push(i32(list('vec3').length));
  for (const [k, v] of list('vec3')) b.push(packStr(k), ...v.map(f32));
  if (variant.quat) {
    b.push(i32(list('quat').length));
    for (const [k, v] of list('quat')) b.push(packStr(k), ...v.map(f32));
  }
  b.push(i32(fields.length));
  for (const [k, v] of fields) b.push(packStr(k), packStr(v));
  b.push(i32(0), i32(0), i32(0)); // file names, references, instances
  return Buffer.concat(b);
}

module.exports = {
  ModParseError, BinReader, decodeStr, encodeStr, hasEscaped, displayText, normalizeKey,
  parseMod, layoutOf, readModSource, isDerivedFrom, DialogueIndex, cmpStr, i32, packStr, packChangedRecord,
  BUILDING_TYPE, DIALOGUE_TYPE, DIALOGUE_LINE_TYPE, DIALOGUE_PACKAGE_TYPE, DIALOGUE_FAMILY, CHANGED, CHANGED_RENAMED,
};
