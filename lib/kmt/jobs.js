// The translator's jobs, ported from Kenshi Mod Translator (KMT):
//   patchmod  — a separate translation patch mod <out>/<mod>_KO/<mod>_KO.mod (the original untouched;
//               _KO / _EN / _JA … by the target language, ctx.target: rules.js TARGETS, 'ko' if none)
//   inplace   — the original mod edited (kept as '<mod>.bak' first)
//   copypatch — the chosen fields copied as they are into <out>/<mod>_Patch/<mod>_Patch.mod
//   extract   — the strings to translate written as a 'source =' glossary file
//   review    — every job saves a review file; picked entries can go into the glossary / the mod
// ctx = { log(text), progress(done, total), stop() -> bool, dataDir, target?, translate? }
const fs = require('fs');
const path = require('path');
const fcs = require('./fcs');
const R = require('./rules');
const G = require('./glossary');
const backups = require('./backups');
const { atomicWrite } = require('./textfile');

const PATCH_SUFFIX = '_KO';
const COPY_PATCH_SUFFIX = '_Patch';
const LOCALE_PO = path.join('locale', 'ko-KR', 'LC_MESSAGES', 'main.po');
const MAX_CONSEC_FAIL = 3;
const REVIEW_DIR = '번역 검수';
const ORIGINS = ['용어집', '구글', '저장', '기존', '한국어', '미번역'];
// The target languages in the log (Korean, as the log is for now)
const LANG_NAME = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', ru: '러시아어', de: '독일어', fr: '프랑스어', es: '스페인어', pt: '포르투갈어', pl: '폴란드어', tr: '튀르키예어' };

const modStem = (p) => path.basename(p, path.extname(p));
// Where each kind of file goes: ctx.dirs (service.js), else all in ctx.dataDir.
const dirOf = (ctx, kind) => (ctx.dirs && ctx.dirs[kind]) || (kind === 'review' ? path.join(ctx.dataDir, REVIEW_DIR) : ctx.dataDir);
// The Google cache: one per target language (Korean's keeps KMT's name)
const cachePath = (ctx) => { const t = R.targetOf(ctx.target); return path.join(dirOf(ctx, 'cache'), t === 'ko' ? 'kenshi_translate_cache.json' : `kenshi_translate_cache_${t}.json`); };
// The mod's own translation (main.po) in the target language: locale/ko-KR/…, else a locale folder
// whose name starts with the language code (ja-JP, zh_CN …).
function poPath(modPath, target) {
  const t = R.targetOf(target);
  const dir = path.dirname(path.resolve(modPath));
  if (t === 'ko') return path.join(dir, LOCALE_PO);
  try {
    const loc = fs.readdirSync(path.join(dir, 'locale')).find((n) => n.toLowerCase() === t || n.toLowerCase().startsWith(t + '-') || n.toLowerCase().startsWith(t + '_'));
    if (loc) return path.join(dir, 'locale', loc, 'LC_MESSAGES', 'main.po');
  } catch { /* none */ }
  return '';
}
const recKey = (rec) => `${rec.type}\u0000${rec.id}\u0000${rec.name}\u0000${rec.sid}`;
const stopped = (ctx) => { if (ctx.stop && ctx.stop()) throw new G.StopError(); };
// Long loops give the app a moment now and then (the jobs run in the main process).
const breathe = (i) => (i % 400 === 0 ? new Promise((r) => setImmediate(r)) : null);

function emptyStats() { return { glossary: 0, existing: 0, google: 0, failed: 0, skipped: 0, kept: 0, same: 0 }; }

function logDialogueInfo(info, log) {
  const tc = [...info.typeCounts];
  if (tc.length) {
    const top = tc.sort((a, b) => b[1] - a[1]).slice(0, 8); // stable: the first seen first, like KMT
    log('레코드 타입 분포: ' + top.map(([t, n]) => `${R.typeName(t)}=${n}`).join(', '));
  }
  if (!info.dlgRecords) { log(`이 파일에는 DIALOGUE_LINE(타입 ${fcs.DIALOGUE_LINE_TYPE}) 레코드가 없습니다.`); return; }
  log(`DIALOGUE_LINE 레코드 ${info.dlgRecords}개 / text 계열 필드 ${info.dlgTexts}개`);
  if (!info.dlgTexts) log('[주의] 대사 레코드에서 text 계열 필드를 찾지 못했습니다. 이 레코드가 가진 문자열 키: ' + [...info.dlgKeys].sort(fcs.cmpStr).join(', '));
}

function reviewEntry(sp, src, dst, origin) {
  return { sid: sp.sid || '', type: R.typeName(sp.rec.type), field: sp.raw === null ? R.RECORD_NAME_KEY : sp.raw, src, dst: dst || '', origin, edited: false };
}

// ---- the shared step: read -> pick -> translate ----
// Each string: glossary (case-insensitive too) -> glossary only? stop -> already in the target
// language, e.g. has Hangul (copied for a patch mod when that language is a detected one, else
// left) -> main.po -> Google cache -> Google.
async function loadAndTranslate(ctx, modPath, glossaryPath, settings, { glossaryOnly = false, keepKorean = false } = {}) {
  const log = ctx.log;
  if (!fs.existsSync(modPath)) throw new Error('모드 파일을 찾을 수 없습니다: ' + modPath);
  if (ctx.progress) ctx.progress(0, 0);
  const target = R.targetOf(ctx.target);
  const T = R.TARGETS[target];
  const tName = LANG_NAME[target] || T.native;
  const src = fcs.readModSource(fs, modPath, log);
  logDialogueInfo(src.info, log);
  const targets = R.selectTargets(src.spans, settings, log);
  const uniques = [];
  const seen = new Set();
  for (const sp of targets) {
    const n = sp.text.replace(/\r\n/g, '\n');
    if (!seen.has(n)) { seen.add(n); uniques.push([sp.sid, n]); }
  }
  if (!uniques.length) throw new Error('번역 대상 텍스트를 찾지 못했습니다. (작업 설정을 확인하세요)');
  log(`교체 대상: ${targets.length}곳 / 고유 문자열 ${uniques.length}개`);

  const { glossary, blank } = G.loadGlossary(glossaryPath, log);
  const glossaryCi = new Map();
  for (const [k, v] of glossary) glossaryCi.set(k.toLowerCase(), v);
  const blankCi = new Set([...blank].map((k) => k.toLowerCase()));
  let existing = new Map();
  if (glossaryOnly) {
    if (!glossary.size) throw new Error("'용어집 항목만 번역'이 켜져 있지만 사용할 용어집 항목이 없습니다.\n용어집 경로와 내용(원문 = 번역문)을 확인하세요.");
    log(`[용어집 전용] 용어집에 있는 항목만 번역하고, 나머지는 원문을 유지합니다. (구글 번역 / 기존 번역 재사용 / ${tName} 복사 안 함)`);
  } else {
    const po = poPath(modPath, target);
    if (po && fs.existsSync(po)) {
      try { existing = G.loadPo(po); log(`기존 main.po 번역 ${existing.size}개 재사용 가능`); } catch (e) { log('[경고] 기존 main.po 로드 실패, 무시합니다: ' + e.message); }
    }
  }
  const copyKo = keepKorean && !!T.script && R.selectedLangs(settings).has(T.script);
  const translate = ctx.translate || ((line) => G.translateLine(line, T.google));

  const tcache = G.loadCache(cachePath(ctx));
  let consecFail = 0;
  const cache = new Map();
  const origin = new Map();
  const stats = emptyStats();
  const total = uniques.length;
  let lastSid = {};
  let unsaved = 0;
  let lastSave = Date.now();
  try {
    for (let idx = 1; idx <= total; idx++) {
      await breathe(idx);
      stopped(ctx);
      const [sid, n] = uniques[idx - 1];
      if (sid !== lastSid) { log(`# [${sid || '(String ID 없음)'}]`); lastSid = sid; }
      const short = n.replace(/\n/g, ' ').slice(0, 50);
      const low = n.trim().toLowerCase();
      let gl = null;
      let note = '';
      let isBlank = false;
      if (glossary.has(n)) { gl = glossary.get(n); isBlank = blank.has(n); }
      else if (glossaryCi.has(low)) { gl = glossaryCi.get(low); note = '(대소문자 무시)'; isBlank = blankCi.has(low); }
      else if (fcs.hasEscaped(n)) {
        const shown = fcs.displayText(n);
        const sl = shown.trim().toLowerCase();
        if (glossary.has(shown)) { gl = glossary.get(shown); isBlank = blank.has(shown); }
        else if (glossaryCi.has(sl)) { gl = glossaryCi.get(sl); isBlank = blankCi.has(sl); note = '(대소문자 무시)'; }
      }
      if (gl !== null) {
        origin.set(n, '용어집');
        stats.glossary++;
        if (isBlank) { cache.set(n, n); stats.same++; log(`[${idx}/${total}] 용어집${note}(번역 비어 있음 -> 원문 그대로): ${short}`); }
        else if (R.textsEqual(gl, n)) { cache.set(n, gl); stats.same++; log(`[${idx}/${total}] 용어집${note}(원문과 동일, 그대로 유지): ${short}`); }
        else { cache.set(n, gl); log(`[${idx}/${total}] 용어집${note}: ${short}`); }
      } else if (glossaryOnly) {
        cache.set(n, ''); origin.set(n, '미번역'); stats.skipped++;
        log(`[${idx}/${total}] 건너뜀(용어집에 없음): ${short}`);
      } else if (R.isTargetText(n, target)) {
        // (origin '한국어' = already in the target language: the name review files have used)
        if (copyKo) { cache.set(n, n); origin.set(n, '한국어'); stats.kept++; log(`[${idx}/${total}] ${tName} 그대로 복사: ${short}`); }
        else { cache.set(n, ''); origin.set(n, '미번역'); stats.skipped++; log(`[${idx}/${total}] 건너뜀(${target === 'ko' ? '한글' : tName} 포함, 용어집에 없음): ${short}`); }
      } else if (existing.has(n)) {
        cache.set(n, existing.get(n)); origin.set(n, '기존'); stats.existing++;
        log(`[${idx}/${total}] 기존 번역 재사용: ${short}`);
      } else if (tcache.has(n)) {
        cache.set(n, tcache.get(n)); origin.set(n, '저장'); stats.existing++;
        log(`[${idx}/${total}] 저장된 번역 재사용: ${short}`);
      } else {
        try {
          const tr = await G.googleTranslate(n, ctx.stop, log, translate, ctx.translateDelay);
          cache.set(n, tr); tcache.set(n, tr); origin.set(n, '구글');
          unsaved++;
          if (unsaved >= 20 || Date.now() - lastSave > 15000) { G.saveCache(cachePath(ctx), tcache); unsaved = 0; lastSave = Date.now(); }
          consecFail = 0;
          stats.google++;
          log(`[${idx}/${total}] 구글 번역: ${short} -> ${tr.replace(/\n/g, ' ').slice(0, 50)}`);
        } catch (e) {
          if (e instanceof G.StopError) throw e;
          cache.set(n, ''); origin.set(n, '미번역'); stats.failed++; consecFail++;
          log(`[${idx}/${total}] [실패] ${short} (${e.message})`);
          if (consecFail >= MAX_CONSEC_FAIL) {
            throw new Error(`구글 번역이 연속 ${consecFail}번 실패해서 작업을 중단했습니다. (${e.message})\n\n구글이 요청을 일시적으로 막은 상태일 수 있습니다.\n· 잠시 후 다시 실행하세요. 이미 번역된 문장은 저장되어 있어 이어서 진행됩니다.\n· 네트워크(예: 휴대폰 핫스팟)를 바꿔 보세요.\n· '용어집 항목만 번역'을 켜면 구글을 쓰지 않습니다.`);
          }
        }
      }
      if (ctx.progress) ctx.progress(idx, total);
    }
  } finally {
    if (unsaved) G.saveCache(cachePath(ctx), tcache);
  }
  const review = targets.map((sp) => {
    const n = sp.text.replace(/\r\n/g, '\n');
    return reviewEntry(sp, n, cache.get(n) || '', origin.get(n) || '미번역');
  });
  return { ...src, targets, cache, stats, review, bakPath: modPath + '.bak' };
}

function translatedText(job, sp) {
  let tr = job.cache.get(sp.text.replace(/\r\n/g, '\n')) || '';
  if (tr && sp.text.includes('\r\n')) tr = tr.replace(/\n/g, '\r\n');
  return tr;
}

function ensureNotAllFailed(stats) {
  if (stats.failed && !(stats.glossary || stats.existing || stats.google || stats.kept)) {
    throw new Error(`번역 요청이 모두 실패했습니다. 인터넷 연결을 확인하세요. (실패 ${stats.failed}개)`);
  }
}
function nochangeMessage(mode, stats, same) {
  const lines = [mode === 'inplace' ? '변경할 내용이 없어 모드 파일을 수정하지 않았습니다.' : '번역 결과가 없어 패치 모드를 만들지 않았습니다.'];
  if (same) lines.push(`용어집이 원문과 같거나 비어 있어 그대로 유지한 항목: ${same}곳`);
  if (stats.skipped) lines.push(`건너뜀: ${stats.skipped}개`);
  if (stats.failed) lines.push(`구글 번역 실패: ${stats.failed}개`);
  return lines.join('\n');
}

// The header of a made mod (_KO / _Patch): ctx.headers[kind] = 만든 모드의 속성 (rules.js
// defaultHeader). Nothing to change (or no choices given: KMT's way) -> the original's header as
// it is. 필수 = the original's own (keepDeps) + the original (addOriginal); 참조 = the original's
// own (keepRefs) + the dropped 필수 (moveDeps); the description gets '[한글화 패치] 원본: …' (prefix).
//   v16: version, int, author, description, dependencies, references, int
//   v17: version, block length, [mod version, author, description, dependencies, references, …], int
function madeHeader(ctx, data, info, modPath, kind) {
  const head = data.subarray(0, info.headerEnd);
  const h = ctx.headers && ctx.headers[kind];
  if (!h) return head;
  const original = path.basename(modPath).replace(/\.bak$/i, '');
  const target = R.targetOf(ctx.target);
  const [label, origWord] = kind === 'copypatch' ? (target === 'ko' ? ['항목 복사 패치', '원본:'] : ['Field copy patch', 'Original:']) : R.TARGETS[target].prefix;
  const L = info.layout;
  try {
    const r = new fcs.BinReader(head, 0);
    const ver = r.i32();
    const list = (str) => str.split(',').map((x) => x.trim()).filter(Boolean);
    const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
    let changed = false;
    const fix = (author, desc, deps, refs) => {
      const isOrig = (x) => x.toLowerCase() === original.toLowerCase();
      // h.deps: keep / delete / move (to 참조) · h.refs: keep / delete
      const depsMode = h.deps || (h.keepDeps ? 'keep' : h.moveDeps ? 'move' : 'delete');
      const keepRefs = h.refs ? h.refs !== 'delete' : h.keepRefs !== false;
      const newDeps = uniq([...(depsMode === 'keep' ? list(deps) : []), ...(h.addOriginal ? [original] : [])]);
      const newRefs = uniq([...(keepRefs ? list(refs) : []), ...(depsMode === 'move' ? list(deps) : [])].filter((x) => !newDeps.some((d) => d.toLowerCase() === x.toLowerCase()) && !isOrig(x)));
      const newDesc = h.prefix ? `[${label}] ${origWord} ${original}\r\n\r\n${desc}` : desc;
      const d2 = newDeps.join(',');
      const r2 = newRefs.join(',');
      changed = d2 !== deps || r2 !== refs || newDesc !== desc;
      return [fcs.packStr(author), fcs.packStr(newDesc), fcs.packStr(d2), fcs.packStr(r2)];
    };
    if (ver === 16 && L.pre === 1 && L.nStr === 4 && L.post === 1) {
      const pre = r.i32();
      const [author, desc, deps, refs] = [r.string(), r.string(), r.string(), r.string()];
      const post = r.i32();
      if (r.pos !== head.length) throw new Error('v16 header size');
      const out = Buffer.concat([fcs.i32(ver), fcs.i32(pre), ...fix(author, desc, deps, refs), fcs.i32(post)]);
      return changed ? out : head;
    }
    if (ver === 17 && L.pre === 0 && L.nStr === 1 && L.post === 1) {
      const blockLen = r.i32();
      const start = r.pos;
      const modVer = r.i32();
      const [author, desc, deps, refs] = [r.string(), r.string(), r.string(), r.string()];
      if (r.pos > start + blockLen) throw new Error('v17 header block');
      const tail = head.subarray(r.pos, start + blockLen);
      const post = head.readInt32LE(start + blockLen);
      if (start + blockLen + 4 !== head.length) throw new Error('v17 header size');
      const block = Buffer.concat([fcs.i32(modVer), ...fix(author, desc, deps, refs), tail]);
      return changed ? Buffer.concat([fcs.i32(ver), fcs.i32(block.length), block, fcs.i32(post)]) : head;
    }
    throw new Error(`header version ${ver}`);
  } catch (e) {
    ctx.log(`[안내] 모드 헤더를 알아볼 수 없어 원본 헤더를 그대로 씁니다 (만든 모드의 속성이 적용되지 않음): ${e.message}`);
    return head;
  }
}

// Swap strings in data: repl = [[span, new text]] (in file order)
function swapStrings(data, repl) {
  const parts = [];
  let pos = 0;
  for (const [sp, text] of repl) { parts.push(data.subarray(pos, sp.start), fcs.packStr(text)); pos = sp.end; }
  parts.push(data.subarray(pos));
  return Buffer.concat(parts);
}

function writeOut(outPath, data, log, label) {
  const dir = path.dirname(outPath);
  let oldBackup = '';
  try {
    fs.mkdirSync(dir, { recursive: true });
    oldBackup = backups.backupExisting(outPath);
    if (oldBackup) log(`기존 ${label} 파일을 백업했습니다: ${oldBackup}`);
    atomicWrite(outPath, data);
  } catch (e) {
    throw new Error(`출력 폴더에 저장하지 못했습니다: ${dir}\n(${e.message})`);
  }
  return oldBackup;
}

// ---- 1. the original edited ----
async function buildInplace(ctx, modPath, glossaryPath, settings, opts = {}) {
  const log = ctx.log;
  const job = await loadAndTranslate(ctx, modPath, glossaryPath, settings, { glossaryOnly: opts.glossaryOnly, keepKorean: false });
  const { data, stats } = job;
  log('모드 파일 패치 중...');
  const repl = [];
  let same = 0;
  for (const sp of job.targets) {
    const tr = translatedText(job, sp);
    if (!tr) continue;
    if (R.textsEqual(tr, sp.text)) { same++; continue; }
    repl.push([sp, tr]);
  }
  if (!repl.length) {
    ensureNotAllFailed(stats);
    const msg = nochangeMessage('inplace', stats, same);
    log('[안내] ' + msg.replace(/\n/g, ' / '));
    return { mode: 'inplace', path: modPath, changed: 0, stats, same, nochange: true, message: msg, review: job.review };
  }
  const out = swapStrings(data, repl);
  const check = fcs.parseMod(out, { layout: fcs.layoutOf(job.info), only: true });
  if (check.recCount !== job.recCount || check.spans.length !== job.spans.length) throw new Error('패치 검증 실패: 레코드/필드 수가 달라졌습니다. 저장하지 않습니다.');
  log(`패치 결과 검증 통과 (레코드 ${check.recCount}개)`);
  if (job.srcPath === modPath) {
    if (job.stale && fs.existsSync(job.bakPath)) {
      const old = backups.datedPath(modPath);
      fs.renameSync(job.bakPath, old);
      log('오래된 원본 백업을 날짜별 백업으로 옮겼습니다: ' + old);
    }
    atomicWrite(job.bakPath, data);
    log('원본 백업: ' + job.bakPath);
  } else {
    const prev = backups.saveDated(modPath);
    if (prev) log(`이전 수정 결과를 날짜별 백업으로 보관했습니다: ${prev} (원본 백업 ${path.basename(job.bakPath)} 은 그대로)`);
  }
  atomicWrite(modPath, out);
  log('저장 완료: ' + modPath);
  log(`완료 - 교체 ${repl.length}곳 / 원문과 동일 유지 ${same}곳 / 용어집 ${stats.glossary} / 기존 ${stats.existing} / 구글 ${stats.google} / 건너뜀 ${stats.skipped} / 실패 ${stats.failed}`);
  return { mode: 'inplace', path: modPath, backup: job.bakPath, changed: repl.length, stats, same, nochange: false, review: job.review };
}

// Group per record (file order kept): Map(recKey -> { rec, name, fields: Map(raw -> text), nums })
function groupRecords() {
  const recs = new Map();
  const slot = (rec, withNums) => {
    const k = recKey(rec);
    if (!recs.has(k)) recs.set(k, { rec, name: null, fields: new Map(), nums: withNums ? { bool: new Map(), float: new Map(), int: new Map(), vec3: new Map(), quat: new Map() } : null });
    return recs.get(k);
  };
  return { recs, slot };
}
const setDefault = (map, k, v) => { if (!map.has(k)) map.set(k, v); };

// ---- 2. a separate Korean patch mod ----
async function buildPatchMod(ctx, modPath, glossaryPath, settings, outRoot, opts = {}) {
  const log = ctx.log;
  const job = await loadAndTranslate(ctx, modPath, glossaryPath, settings, { glossaryOnly: opts.glossaryOnly, keepKorean: true });
  const { info, stats } = job;
  const variant = info.variant;
  if (!variant.change) throw new Error("이 파일 형식에는 '수정 레코드' 구조가 없어 별도 패치 모드를 만들 수 없습니다. '원본 모드 직접 수정' 방식을 사용하세요.");
  const { recs, slot } = groupRecords();
  let changed = 0, same = 0;
  for (const sp of job.targets) {
    const tr = translatedText(job, sp);
    if (!tr) continue;
    const e = slot(sp.rec);
    if (sp.raw === null) e.name = tr; else setDefault(e.fields, sp.raw, tr);
    changed++;
    if (R.textsEqual(tr, sp.text)) same++;
  }
  const name = modStem(modPath) + R.patchSuffix(ctx.target);
  if (!recs.size) {
    ensureNotAllFailed(stats);
    const msg = nochangeMessage('patchmod', stats, same);
    log('[안내] ' + msg.replace(/\n/g, ' / '));
    return { mode: 'patchmod', path: '', changed: 0, records: 0, stats, same, nochange: true, message: msg, name: '', original: path.basename(modPath), review: job.review };
  }
  log(`패치 모드 구성 중... (수정 레코드 ${recs.size}개)`);
  const body = [];
  for (const e of recs.values()) {
    let newName = e.name;
    if (newName !== null && R.textsEqual(newName, e.rec.name)) newName = null;
    body.push(fcs.packChangedRecord(variant, e.rec, newName, [...e.fields]));
  }
  const patch = Buffer.concat([madeHeader(ctx, job.data, info, modPath, 'patchmod'), fcs.i32(recs.size), ...body]);
  const check = fcs.parseMod(patch, { layout: fcs.layoutOf(info), only: true });
  if (check.recCount !== recs.size) throw new Error('패치 모드 검증 실패: 레코드 수가 맞지 않습니다. 저장하지 않습니다.');
  log(`패치 모드 구조 검증 통과 (레코드 ${check.recCount}개)`);
  const outPath = path.join(outRoot, name, name + '.mod');
  const oldBackup = writeOut(outPath, patch, log, '패치 모드');
  log('저장 완료: ' + outPath);
  log(`완료 - 수정 레코드 ${recs.size}개 / 문자열 ${changed}곳 (원문과 동일 ${same}곳) / 용어집 ${stats.glossary} / ${LANG_NAME[R.targetOf(ctx.target)]} 복사 ${stats.kept} / 기존 ${stats.existing} / 구글 ${stats.google} / 건너뜀 ${stats.skipped} / 실패 ${stats.failed}`);
  return { mode: 'patchmod', path: outPath, changed, records: recs.size, stats, same, nochange: false, name, original: path.basename(modPath), oldBackup, review: job.review };
}

// ---- 3. a patch file (the chosen fields copied as they are) ----
const KIND_NAMES = { bool: '참/거짓', float: '실수', int: '정수', vec3: '색상/좌표(값 3개)', quat: '회전(값 4개)' };
const g = (x) => { // Python '%g'
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e < -4 || e >= 6) return x.toExponential(5).replace(/\.?0+e/, 'e').replace(/e([+-])(\d)$/, 'e$10$2');
  return String(Number(x.toPrecision(6)));
};

async function buildCopyPatch(ctx, modPath, patchSettings0, outRoot) {
  const log = ctx.log;
  if (!fs.existsSync(modPath)) throw new Error('모드 파일을 찾을 수 없습니다: ' + modPath);
  if (ctx.progress) ctx.progress(0, 0);
  log('모드 파일 읽는 중: ' + modPath);
  const data = fs.readFileSync(modPath);
  const { spans, info } = fcs.parseMod(data, { log, wantNumeric: true });
  logDialogueInfo(info, log);
  const variant = info.variant;
  if (!variant.change) throw new Error("이 파일 형식에는 '수정 레코드' 구조가 없어 패치파일을 만들 수 없습니다.");
  const ps = R.applyRuleFallback(patchSettings0, spans, info.numeric, log);
  const targets = R.selectCopyTargets(spans, ps, log);
  const numTargets = R.selectCopyNumeric(info.numeric, ps, log);
  R.reportUnmatchedRules(ps, spans, info.numeric, log);
  const items = [...targets.map((sp) => [sp.start, 0, sp]), ...numTargets.map((nf) => [nf.start, 1, nf])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!items.length) {
    const msg = '복사할 항목이 없어 패치파일을 만들지 않았습니다.\n패치 설정의 복사 영역 / 복사 제외를 확인하세요. (자세한 이유는 로그의 [안내] 참고)';
    log('[안내] ' + msg.replace(/\n/g, ' '));
    return { mode: 'copypatch', path: '', changed: 0, records: 0, stats: emptyStats(), same: 0, nochange: true, message: msg, name: '', original: path.basename(modPath) };
  }
  const { recs, slot } = groupRecords();
  const total = items.length;
  let lastSid = {};
  for (let n = 1; n <= total; n++) {
    await breathe(n);
    stopped(ctx);
    const [, isNum, obj] = items[n - 1];
    if (obj.sid !== lastSid) { log(`# [${obj.sid || '(String ID 없음)'}]`); lastSid = obj.sid; }
    const e = slot(obj.rec, true);
    if (isNum) {
      setDefault(e.nums[obj.kind], obj.raw, obj.value);
      const shown = obj.kind === 'bool' ? (obj.value ? '참' : '거짓') : obj.kind === 'vec3' || obj.kind === 'quat' ? obj.value.map(g).join(' ') : obj.kind === 'float' ? g(obj.value) : obj.value;
      log(`[${n}/${total}] 복사: ${obj.key} = ${shown} (${KIND_NAMES[obj.kind]})`);
    } else {
      let label;
      if (obj.raw === null) { e.name = obj.text; label = 'name'; }
      else { setDefault(e.fields, obj.raw, obj.text); label = obj.key; }
      log(`[${n}/${total}] 복사: ${label} = ${obj.text.replace(/\r\n/g, ' ').replace(/\n/g, ' ').slice(0, 50)}`);
    }
    if (ctx.progress) ctx.progress(n, total);
  }
  log(`패치파일 구성 중... (복사 레코드 ${recs.size}개 / 항목 ${total}곳)`);
  const body = [];
  for (const e of recs.values()) {
    const nums = Object.fromEntries(Object.entries(e.nums).map(([k, m]) => [k, [...m]]));
    body.push(fcs.packChangedRecord(variant, e.rec, e.name, [...e.fields], nums));
  }
  const patch = Buffer.concat([madeHeader(ctx, data, info, modPath, 'copypatch'), fcs.i32(recs.size), ...body]);
  const check = fcs.parseMod(patch, { wantNumeric: true, layout: fcs.layoutOf(info), only: true });
  if (check.recCount !== recs.size) throw new Error('패치파일 검증 실패: 레코드 수가 맞지 않습니다. 저장하지 않습니다.');
  const f32hex = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b.toString('hex'); };
  const numKey = (nf) => `${nf.sid}\u0000${nf.kind}\u0000${nf.raw}\u0000${nf.kind === 'float' ? f32hex(nf.value) : nf.kind === 'vec3' || nf.kind === 'quat' ? nf.value.map(f32hex).join('') : nf.value}`;
  const actual = new Set(check.spans.map((s) => `${s.sid}\u0000${s.raw}\u0000${s.text}`));
  const actualNum = new Set(check.info.numeric.map(numKey));
  const missing = targets.filter((sp) => !actual.has(`${sp.sid}\u0000${sp.raw}\u0000${sp.text}`)).length + numTargets.filter((nf) => !actualNum.has(numKey(nf))).length;
  if (missing) throw new Error(`패치파일 검증 실패: 복사한 값 ${missing}곳이 결과에 없습니다. 저장하지 않습니다.`);
  log(`패치파일 구조 검증 통과 (레코드 ${check.recCount}개)`);
  const name = modStem(modPath) + COPY_PATCH_SUFFIX;
  const outPath = path.join(outRoot, name, name + '.mod');
  const oldBackup = writeOut(outPath, patch, log, '패치');
  log('저장 완료: ' + outPath);
  log(`완료 - 복사 레코드 ${recs.size}개 / 항목 ${total}곳`);
  return { mode: 'copypatch', path: outPath, changed: total, records: recs.size, stats: emptyStats(), same: 0, nochange: false, name, original: path.basename(modPath), oldBackup };
}

// ---- extract: the strings to translate, as a 'source =' file ----
function describeRec(rec) {
  const name = (rec.name || '').replace(/[\r\n]/g, ' ').trim();
  return name ? `${rec.sid} (${name})` : rec.sid;
}
const textKeyOrder = (key) => { const m = /^text ?(\d*)$/.exec(key); return m && m[1] ? Number(m[1]) : -1; };
const cmpTuple = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = fcs.cmpStr(a[i], b[i]); if (d) return d; } return a.length - b.length; };

function extractTerms(ctx, modPath, settings) {
  const log = ctx.log;
  if (!fs.existsSync(modPath)) throw new Error('모드 파일을 찾을 수 없습니다: ' + modPath);
  const src = fcs.readModSource(fs, modPath, log);
  logDialogueInfo(src.info, log);
  const targets = R.selectTargets(src.spans, settings, log);
  const index = new fcs.DialogueIndex(src.info.dlgRecs);
  const general = new Map();
  const dialog = new Map();
  const seen = new Set();
  let dup = 0, skipped = 0, seq = 0, dlgCount = 0;
  for (const sp of targets) {
    const n = sp.text.replace(/\r\n/g, '\n').trim();
    if (seen.has(n)) { dup++; continue; }
    // ('=' in it: written 'source =|=', glossary.js; only '=|=' itself can't be written)
    if (G.glossaryLine(fcs.displayText(n)) === null) { skipped++; log("[경고] '=|=' 포함 문장은 용어집 형식으로 표기할 수 없어 제외: " + n.replace(/\n/g, ' ').slice(0, 50)); continue; }
    seen.add(n);
    seq++;
    if (sp.fid === 'dialogue.text') {
      dlgCount++;
      const { dialogue, pkgs } = index.context(sp.sid);
      const pkgKey = pkgs.map((p) => p.sid);
      const gkey = JSON.stringify([pkgKey, dialogue ? dialogue.sid : '']);
      if (!dialog.has(gkey)) dialog.set(gkey, { pkgKey, pkgs, dlg: dialogue, first: seq, lines: new Map() });
      const grp = dialog.get(gkey);
      if (!grp.lines.has(sp.sid)) grp.lines.set(sp.sid, { seq, texts: [] });
      grp.lines.get(sp.sid).texts.push([sp.key, n]);
    } else {
      const k = sp.sid || '(String ID 없음)';
      if (!general.has(k)) general.set(k, []);
      general.get(k).push(n);
    }
  }
  const count = [...general.values()].reduce((s, v) => s + v.length, 0) + dlgCount;
  if (!count) throw new Error('번역 대상 텍스트를 찾지 못했습니다. (작업 설정을 확인하세요)');
  const outPath = path.join(dirOf(ctx, 'extract'), `${modStem(modPath)}_glossary_${backups.stamp('yyMMdd_HHmmss')}.txt`);
  const w = [];
  const line = (t) => G.glossaryLine(fcs.displayText(t));
  for (const [sid, items] of general) { w.push(`# [${sid}]`); for (const t of items) w.push(line(t)); }
  if (dialog.size) {
    w.push('', '# ======== DIALOGUE_LINE (대사)  PACKAGE > DIALOGUE > LINE ========');
    let prev = null;
    const groups = [...dialog.values()].sort((a, b) => cmpTuple(a.pkgKey, b.pkgKey) || a.first - b.first);
    for (const grp of groups) {
      const pk = JSON.stringify(grp.pkgKey);
      if (pk !== prev) {
        w.push('');
        if (grp.pkgs.length) for (const p of grp.pkgs) w.push('# [DIALOGUE_PACKAGE] ' + describeRec(p));
        else w.push('# [DIALOGUE_PACKAGE] (연결 정보 없음)');
        prev = pk;
      }
      w.push(grp.dlg ? '#   [DIALOGUE] ' + describeRec(grp.dlg) : '#   [DIALOGUE] (연결 정보 없음)');
      const lines = [...grp.lines].sort((a, b) => (index.order.has(a[0]) ? index.order.get(a[0]) : 1e9) - (index.order.has(b[0]) ? index.order.get(b[0]) : 1e9) || a[1].seq - b[1].seq);
      for (const [lineSid, l] of lines) {
        w.push('#     [DIALOGUE_LINE] ' + (lineSid || '(String ID 없음)'));
        for (const [, t] of [...l.texts].sort((a, b) => textKeyOrder(a[0]) - textKeyOrder(b[0]))) w.push(line(t));
      }
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, '﻿' + w.join('\n') + '\n', 'utf8');
  log(`추출 완료: ${count}개 (일반 String ID ${general.size}개 / 대사 ${dlgCount}개, 중복 ${dup}개, 제외 ${skipped}개)`);
  log('저장: ' + outPath);
  return { path: outPath, count, ids: general.size, dialogue: dlgCount, skipped };
}

// ---- review files ----
const escVal = (v) => (v || '').replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
function unescVal(v) {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\' && i + 1 < v.length) {
      const c = v[i + 1];
      out += { n: '\n', r: '\r', '\\': '\\' }[c] ?? '\\' + c;
      i++;
    } else out += v[i];
  }
  return out;
}
const REVIEW_KEYS = ['sid', 'type', 'field', 'origin', 'edited', 'src', 'dst'];
const reviewDir = (ctx) => dirOf(ctx, 'review');

function writeReviewFile(file, meta, entries) {
  const lines = ['# Kenshi Mod Translator 번역 검수 파일 - 프로그램이 읽는 파일입니다. 형식을 바꾸지 마세요.', '# field 의 @name 은 레코드 이름(FCS 의 Base - name), 그 외는 FCS 의 필드 이름입니다.'];
  for (const k of ['mod', 'out', 'mode', 'created', 'target']) if (k !== 'target' || meta.target) lines.push(`@${k} = ${escVal(String(meta[k] || ''))}`);
  entries.forEach((e, i) => {
    lines.push('', `[${i + 1}]`);
    for (const k of REVIEW_KEYS) lines.push(`${k} = ${escVal(k === 'edited' ? (e.edited ? '1' : '0') : e[k] || '')}`);
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, fcs.encodeStr(lines.join('\r\n') + '\r\n'));
}

function readReviewFile(file, metaOnly = false) {
  let text = fcs.decodeStr(fs.readFileSync(file));
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const meta = {};
  const entries = [];
  let cur = null;
  for (let line of text.split('\n')) {
    line = line.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      const i = line.indexOf(' = ');
      const k = i >= 0 ? line.slice(1, i) : line.slice(1);
      meta[k.trim()] = unescVal(i >= 0 ? line.slice(i + 3) : '');
      continue;
    }
    if (line.startsWith('[') && line.trimEnd().endsWith(']')) {
      if (metaOnly) break;
      cur = { sid: '', type: '', field: '', origin: '', edited: false, src: '', dst: '' };
      entries.push(cur);
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(' = ');
    let k, v;
    if (i >= 0) { k = line.slice(0, i); v = line.slice(i + 3); }
    else { k = line.replace(/[ =]+$/, '').trimEnd(); v = ''; }
    k = k.trim();
    if (k === 'edited') cur.edited = v.trim() === '1';
    else if (REVIEW_KEYS.includes(k)) cur[k] = unescVal(v);
  }
  return { meta, entries };
}

function listReviewFiles(ctx) {
  let names = [];
  try { names = fs.readdirSync(reviewDir(ctx)).filter((n) => n.toLowerCase().endsWith('.txt')); } catch { return []; }
  return names.map((n) => path.join(reviewDir(ctx), n)).filter((p) => fs.statSync(p).isFile()).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

// Every review file, newest first, without reading them: [{ path, name, mod, stamp, at }] (mod and
// stamp = the mod's name and the job's time from the file name, 'yyMMdd HHmmss'; at = modified, ms).
// Newest = the job's time; a file without one in its name goes by when it was modified.
function reviewFiles(ctx) {
  let names = [];
  try { names = fs.readdirSync(reviewDir(ctx)).filter((n) => n.toLowerCase().endsWith('.txt')); } catch { return []; }
  const out = [];
  for (const name of names) {
    const p = path.join(reviewDir(ctx), name);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    const at = name.lastIndexOf('_번역검수_');
    const m = /_번역검수_(\d{6})_(\d{4}(?:\d\d)?)(?:_\d+)?\.txt$/i.exec(name);
    out.push({ path: p, name, mod: at > 0 ? name.slice(0, at) : name.replace(/\.txt$/i, ''), stamp: m ? `${m[1]} ${m[2]}` : '', at: st.mtimeMs, size: st.size });
  }
  const key = (f) => (f.stamp ? f.stamp.replace(' ', '').padEnd(12, '0') : '');
  return out.sort((a, b) => key(b).localeCompare(key(a)) || b.at - a.at);
}

// What a list row shows: the file's @ lines (its first few KB) and how many places it has,
// kept in '.index.json' in the review folder while the file is the same (size and time).
function reviewInfo(ctx, paths) {
  const indexFile = path.join(reviewDir(ctx), '.index.json');
  let index = {};
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')) || {}; } catch { /* first time */ }
  let changed = false;
  const out = [];
  for (const p of paths) {
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    const key = path.basename(p);
    let it = index[key];
    if (!it || it.size !== st.size || it.mtime !== st.mtimeMs) {
      let meta = {};
      let n = 0;
      try {
        const r = readReviewFile(p);
        meta = r.meta;
        n = r.entries.length;
      } catch { /* unreadable */ }
      it = { size: st.size, mtime: st.mtimeMs, meta, n };
      index[key] = it;
      changed = true;
    }
    out.push({ path: p, meta: it.meta, n: it.n });
  }
  if (changed) {
    // (files gone from the folder leave the index)
    try {
      const have = new Set(fs.readdirSync(reviewDir(ctx)));
      for (const k of Object.keys(index)) if (!have.has(k)) delete index[k];
      atomicWrite(indexFile, JSON.stringify(index));
    } catch { /* the list still shows */ }
  }
  return out;
}

function stampedPath(folder, stem) {
  const st = backups.stamp('yyMMdd_HHmmss');
  let p = path.join(folder, `${stem}_${st}.txt`);
  for (let n = 2; fs.existsSync(p); n++) p = path.join(folder, `${stem}_${st}_${n}.txt`);
  return p;
}

function saveJobReview(ctx, modPath, outRoot, mode, entries) {
  if (!entries || !entries.length) return '';
  const p = stampedPath(reviewDir(ctx), `${modStem(modPath)}_번역검수`);
  const target = R.targetOf(ctx.target);
  writeReviewFile(p, { mod: path.resolve(modPath), out: outRoot || '', mode, created: backups.stamp('yyyy-MM-dd HH:mm:ss'), target: target === 'ko' ? '' : target }, entries);
  ctx.log(`[안내] 번역 검수 파일 저장: ${p} (${entries.length}곳)`);
  return p;
}

// Google-translated sentences in glossary form ('<mod>_No glossary_<time>.txt').
function exportNoGlossary(ctx, modPath, entries) {
  const groups = new Map();
  const seen = new Set();
  let skipped = 0;
  for (const e of entries) {
    if (!['구글', '저장'].includes(e.origin) || !e.dst.trim()) continue;
    const src = fcs.displayText(e.src).replace(/\r\n/g, '\n');
    if (seen.has(src)) continue;
    seen.add(src);
    if (G.glossaryLine(src, fcs.displayText(e.dst)) === null) { skipped++; continue; }
    const k = e.sid || '(String ID 없음)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([src, fcs.displayText(e.dst)]);
  }
  const count = [...groups.values()].reduce((s, v) => s + v.length, 0);
  if (!count) { ctx.log('[안내] 구글 번역으로 처리한 문장이 없어 No glossary 파일은 만들지 않았습니다.'); return { path: '', count: 0 }; }
  fs.mkdirSync(dirOf(ctx, 'noGloss'), { recursive: true });
  const p = stampedPath(dirOf(ctx, 'noGloss'), `${modStem(modPath)}_No glossary`);
  const w = [`# 용어집에 없어 구글 번역으로 처리한 문장 (${path.basename(modPath)})`, '# 번역문을 고친 뒤 glossary.txt 에 붙여 넣으면 다음 작업부터 용어집으로 적용됩니다.'];
  for (const [sid, items] of groups) {
    w.push(`# [${sid}]`);
    for (const [s, d] of items) w.push(G.glossaryLine(s, d.replace(/\r\n/g, '\n')));
  }
  fs.writeFileSync(p, '﻿' + w.join('\n') + '\n', 'utf8');
  ctx.log(`[안내] 구글 번역 용어를 용어집 형식으로 저장: ${p} (${count}개${skipped ? `, '=|=' 포함 ${skipped}개 제외` : ''})`);
  return { path: p, count };
}

const fieldLabel = (f) => (f === R.RECORD_NAME_KEY ? 'Base - name' : f);
const spanKey = (sp) => `${sp.sid || ''}\u0000${sp.raw === null ? R.RECORD_NAME_KEY : sp.raw}\u0000${sp.text.replace(/\r\n/g, '\n')}`;

function matchEntries(spans, entries, log) {
  const index = new Map();
  spans.forEach((sp, i) => { const k = spanKey(sp); if (!index.has(k)) index.set(k, []); index.get(k).push(i); });
  const repl = new Map();
  let missing = 0, empty = 0;
  for (const e of entries) {
    if (!e.dst.trim()) { empty++; continue; }
    const idxs = index.get(`${e.sid}\u0000${e.field}\u0000${e.src.replace(/\r\n/g, '\n')}`);
    if (!idxs) {
      missing++;
      if (missing <= 20) log(`[경고] 모드에서 찾지 못한 항목: [${e.sid}] ${fieldLabel(e.field)} / ${e.src.replace(/\n/g, ' ').slice(0, 50)}`);
      continue;
    }
    for (const i of idxs) {
      let t = e.dst.replace(/\r\n/g, '\n');
      if (spans[i].text.includes('\r\n')) t = t.replace(/\n/g, '\r\n');
      repl.set(i, t);
    }
  }
  if (missing > 20) log(`[경고] ... 찾지 못한 항목이 모두 ${missing}개입니다.`);
  return { repl, missing, empty };
}

// Put the picked review entries into the mod (inplace) or the _KO patch mod (patchmod; _EN … by
// the language the review file was made for).
function applyReview(ctx, meta, entries, mode, makeBackup, outRoot) {
  ctx = { ...ctx, target: R.targetOf(meta.target || 'ko') };
  const log = ctx.log;
  const modPath = meta.mod || '';
  if (!modPath || !fs.existsSync(modPath)) throw new Error('검수 파일에 저장된 원본 모드 파일을 찾을 수 없습니다:\n' + modPath);
  const src = fcs.readModSource(fs, modPath, log);
  const { repl, missing, empty } = matchEntries(src.spans, entries, log);
  if (!repl.size) throw new Error(`모드에 넣을 항목이 없습니다. (찾지 못함 ${missing} / 번역문 비어 있음 ${empty})`);
  if (mode === 'inplace') {
    let curData = src.data, curSpans = src.spans;
    if (src.srcPath !== modPath) {
      curData = fs.readFileSync(modPath);
      curSpans = fcs.parseMod(curData, { layout: fcs.layoutOf(src.info) }).spans;
      if (curSpans.length !== src.spans.length) throw new Error('지금 모드 파일과 원본 백업의 구조가 달라 넣을 수 없습니다.');
    }
    const list = [];
    let same = 0;
    for (const i of [...repl.keys()].sort((a, b) => curSpans[a].start - curSpans[b].start)) {
      if (curSpans[i].text === repl.get(i)) { same++; continue; }
      list.push([curSpans[i], repl.get(i)]);
    }
    if (!list.length) {
      log('[안내] 고른 항목이 이미 모두 같은 번역으로 들어 있어 모드 파일을 바꾸지 않았습니다.');
      return { path: modPath, changed: 0, same, missing, backup: '' };
    }
    const out = swapStrings(curData, list);
    if (fcs.parseMod(out, { layout: fcs.layoutOf(src.info), only: true }).recCount !== src.recCount) throw new Error('검증 실패: 레코드 수가 달라졌습니다. 저장하지 않습니다.');
    let backup = '';
    const bakPath = modPath + '.bak';
    if (src.srcPath === modPath) {
      if (src.stale && fs.existsSync(bakPath)) { const old = backups.datedPath(modPath); fs.renameSync(bakPath, old); log('오래된 원본 백업을 날짜별 백업으로 옮겼습니다: ' + old); }
      atomicWrite(bakPath, src.data);
      backup = bakPath;
      log('원본 백업: ' + bakPath);
    } else if (makeBackup) {
      backup = backups.saveDated(modPath);
      log('지금 모드 파일을 날짜별 백업으로 보관했습니다: ' + backup);
    }
    atomicWrite(modPath, out);
    log(`[완료] 원본 모드에 ${list.length}곳을 넣었습니다: ${modPath} (이미 같음 ${same} / 찾지 못함 ${missing})`);
    return { path: modPath, changed: list.length, same, missing, backup };
  }
  const variant = src.info.variant;
  if (!variant.change) throw new Error("이 파일 형식에는 '수정 레코드' 구조가 없어 별도 패치 모드를 만들 수 없습니다.");
  const name = modStem(modPath) + R.patchSuffix(ctx.target);
  const root = (outRoot || meta.out || '').trim() || ctx.dataDir;
  const outPath = path.join(root, name, name + '.mod');
  const order = new Map(src.info.recSids.map((sid, n) => [sid, n]));
  const srcRecs = new Map(src.spans.map((sp) => [sp.rec.sid, sp.rec]));
  const recs = new Map();
  const slot = (rec) => { if (!recs.has(rec.sid)) recs.set(rec.sid, { rec, name: null, fields: new Map() }); return recs.get(rec.sid); };
  if (fs.existsSync(outPath)) {
    let pspans;
    try { pspans = fcs.parseMod(fs.readFileSync(outPath), { layout: fcs.layoutOf(src.info) }).spans; } catch (e) { throw new Error(`기존 패치 모드를 읽지 못했습니다: ${outPath}\n(${e.message})`); }
    for (const sp of pspans) {
      const base = srcRecs.get(sp.sid) || sp.rec;
      const e = slot(base);
      if (sp.raw === null) { if (!R.textsEqual(sp.text, base.name)) e.name = sp.text; }
      else e.fields.set(sp.raw, sp.text);
    }
    log(`기존 패치 모드의 내용을 유지합니다: ${outPath} (문자열 ${pspans.length}곳)`);
  }
  for (const [i, t] of repl) {
    const sp = src.spans[i];
    const e = slot(sp.rec);
    if (sp.raw === null) e.name = t; else e.fields.set(sp.raw, t);
  }
  const body = [];
  for (const sid of [...recs.keys()].sort((a, b) => (order.has(a) ? order.get(a) : order.size) - (order.has(b) ? order.get(b) : order.size))) {
    const e = recs.get(sid);
    const newName = e.name && !R.textsEqual(e.name, e.rec.name) ? e.name : null;
    if (newName === null && !e.fields.size) continue;
    body.push(fcs.packChangedRecord(variant, e.rec, newName, [...e.fields]));
  }
  const patch = Buffer.concat([madeHeader(ctx, src.data, src.info, modPath, 'patchmod'), fcs.i32(body.length), ...body]);
  if (fcs.parseMod(patch, { layout: fcs.layoutOf(src.info), only: true }).recCount !== body.length) throw new Error('패치 모드 검증 실패: 레코드 수가 맞지 않습니다. 저장하지 않습니다.');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const backup = makeBackup ? backups.backupExisting(outPath) : '';
  if (backup) log('기존 패치 모드 파일을 백업했습니다: ' + backup);
  atomicWrite(outPath, patch);
  log(`[완료] 패치 모드에 ${repl.size}곳을 넣었습니다: ${outPath} (레코드 ${body.length}개 / 찾지 못함 ${missing})`);
  return { path: outPath, changed: repl.size, same: 0, missing, backup, name };
}

module.exports = {
  PATCH_SUFFIX, COPY_PATCH_SUFFIX, ORIGINS, emptyStats,
  loadAndTranslate, buildInplace, buildPatchMod, buildCopyPatch, extractTerms,
  writeReviewFile, readReviewFile, listReviewFiles, reviewFiles, reviewInfo, saveJobReview, exportNoGlossary, applyReview, fieldLabel, reviewDir,
};
