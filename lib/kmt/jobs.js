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
const { say, langName } = require('./lang');

const PATCH_SUFFIX = '_KO';
const COPY_PATCH_SUFFIX = '_Patch';
const LOCALE_PO = path.join('locale', 'ko-KR', 'LC_MESSAGES', 'main.po');
const MAX_CONSEC_FAIL = 3;
const REVIEW_DIR = '번역 검수';
const ORIGINS = ['용어집', '구글', '저장', '기존', '한국어', '미번역'];
// The target languages in the log (Korean, as the log is for now)

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
    log(say('레코드 타입 분포: ', 'Record types: ') + top.map(([t, n]) => `${R.typeName(t)}=${n}`).join(', '));
  }
  if (!info.dlgRecords) { log(say(`이 파일에는 DIALOGUE_LINE(타입 ${fcs.DIALOGUE_LINE_TYPE}) 레코드가 없습니다.`, `This file has no DIALOGUE_LINE (type ${fcs.DIALOGUE_LINE_TYPE}) records.`)); return; }
  log(say(`DIALOGUE_LINE 레코드 ${info.dlgRecords}개 / text 계열 필드 ${info.dlgTexts}개`, `DIALOGUE_LINE records: ${info.dlgRecords} / text fields: ${info.dlgTexts}`));
  if (!info.dlgTexts) log(say('[주의] 대사 레코드에서 text 계열 필드를 찾지 못했습니다. 이 레코드가 가진 문자열 키: ', '[Caution] No text fields were found in the dialogue records. The string keys they have: ') + [...info.dlgKeys].sort(fcs.cmpStr).join(', '));
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
  if (!fs.existsSync(modPath)) throw new Error(say('모드 파일을 찾을 수 없습니다: ', 'Mod file not found: ') + modPath);
  if (ctx.progress) ctx.progress(0, 0);
  const target = R.targetOf(ctx.target);
  const T = R.TARGETS[target];
  const tName = langName(target) || T.native;
  const src = fcs.readModSource(fs, modPath, log);
  logDialogueInfo(src.info, log);
  const targets = R.selectTargets(src.spans, settings, log);
  const uniques = [];
  const seen = new Set();
  for (const sp of targets) {
    const n = sp.text.replace(/\r\n/g, '\n');
    if (!seen.has(n)) { seen.add(n); uniques.push([sp.sid, n]); }
  }
  if (!uniques.length) throw new Error(say('번역 대상 텍스트를 찾지 못했습니다. (작업 설정을 확인하세요)', 'No text to translate was found. (Check the work settings)'));
  log(say(`교체 대상: ${targets.length}곳 / 고유 문자열 ${uniques.length}개`, `To replace: ${targets.length} places / ${uniques.length} unique texts`));

  const { glossary, blank } = G.loadGlossary(glossaryPath, log);
  const glossaryCi = new Map();
  for (const [k, v] of glossary) glossaryCi.set(k.toLowerCase(), v);
  const blankCi = new Set([...blank].map((k) => k.toLowerCase()));
  let existing = new Map();
  if (glossaryOnly) {
    if (!glossary.size) throw new Error(say("'용어집 항목만 번역'이 켜져 있지만 사용할 용어집 항목이 없습니다.\n용어집 경로와 내용(원문 = 번역문)을 확인하세요.", "'Glossary entries only' is on, but there are no glossary entries to use.\nCheck the glossary's path and lines (original = translation)."));
    log(say(`[용어집 전용] 용어집에 있는 항목만 번역하고, 나머지는 원문을 유지합니다. (구글 번역 / 기존 번역 재사용 / ${tName} 복사 안 함)`, `[Glossary only] Only glossary entries are translated; the rest stays as it is. (No Google, no reuse of earlier translations, no ${tName} copied)`));
  } else {
    const po = poPath(modPath, target);
    if (po && fs.existsSync(po)) {
      try { existing = G.loadPo(po); log(say(`기존 main.po 번역 ${existing.size}개 재사용 가능`, `${existing.size} translations from the existing main.po can be reused`)); } catch (e) { log(say('[경고] 기존 main.po 로드 실패, 무시합니다: ', '[Warning] The existing main.po could not be loaded; skipped: ') + e.message); }
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
      if (sid !== lastSid) { log(`# [${sid || say('(String ID 없음)', '(no String ID)')}]`); lastSid = sid; }
      const short = n.replace(/\n/g, ' ').slice(0, 50);
      const low = n.trim().toLowerCase();
      let gl = null;
      let note = '';
      let isBlank = false;
      if (glossary.has(n)) { gl = glossary.get(n); isBlank = blank.has(n); }
      else if (glossaryCi.has(low)) { gl = glossaryCi.get(low); note = say('(대소문자 무시)', ' (case ignored)'); isBlank = blankCi.has(low); }
      else if (fcs.hasEscaped(n)) {
        const shown = fcs.displayText(n);
        const sl = shown.trim().toLowerCase();
        if (glossary.has(shown)) { gl = glossary.get(shown); isBlank = blank.has(shown); }
        else if (glossaryCi.has(sl)) { gl = glossaryCi.get(sl); isBlank = blankCi.has(sl); note = say('(대소문자 무시)', ' (case ignored)'); }
      }
      if (gl !== null) {
        origin.set(n, '용어집');
        stats.glossary++;
        if (isBlank) { cache.set(n, n); stats.same++; log(say(`[${idx}/${total}] 용어집${note}(번역 비어 있음 -> 원문 그대로): ${short}`, `[${idx}/${total}] Glossary${note} (empty translation -> kept as it is): ${short}`)); }
        else if (R.textsEqual(gl, n)) { cache.set(n, gl); stats.same++; log(say(`[${idx}/${total}] 용어집${note}(원문과 동일, 그대로 유지): ${short}`, `[${idx}/${total}] Glossary${note} (same as the original, kept): ${short}`)); }
        else { cache.set(n, gl); log(say(`[${idx}/${total}] 용어집${note}: ${short}`, `[${idx}/${total}] Glossary${note}: ${short}`)); }
      } else if (glossaryOnly) {
        cache.set(n, ''); origin.set(n, '미번역'); stats.skipped++;
        log(say(`[${idx}/${total}] 건너뜀(용어집에 없음): ${short}`, `[${idx}/${total}] Skipped (not in the glossary): ${short}`));
      } else if (R.isTargetText(n, target)) {
        // (origin '한국어' = already in the target language: the name review files have used)
        if (copyKo) { cache.set(n, n); origin.set(n, '한국어'); stats.kept++; log(say(`[${idx}/${total}] ${tName} 그대로 복사: ${short}`, `[${idx}/${total}] ${tName} copied as it is: ${short}`)); }
        else { cache.set(n, ''); origin.set(n, '미번역'); stats.skipped++; log(say(`[${idx}/${total}] 건너뜀(${target === 'ko' ? '한글' : tName} 포함, 용어집에 없음): ${short}`, `[${idx}/${total}] Skipped (has ${tName}, not in the glossary): ${short}`)); }
      } else if (existing.has(n)) {
        cache.set(n, existing.get(n)); origin.set(n, '기존'); stats.existing++;
        log(say(`[${idx}/${total}] 기존 번역 재사용: ${short}`, `[${idx}/${total}] Earlier translation reused: ${short}`));
      } else if (tcache.has(n)) {
        cache.set(n, tcache.get(n)); origin.set(n, '저장'); stats.existing++;
        log(say(`[${idx}/${total}] 저장된 번역 재사용: ${short}`, `[${idx}/${total}] Saved translation reused: ${short}`));
      } else {
        try {
          const tr = await G.googleTranslate(n, ctx.stop, log, translate, ctx.translateDelay);
          cache.set(n, tr); tcache.set(n, tr); origin.set(n, '구글');
          unsaved++;
          if (unsaved >= 20 || Date.now() - lastSave > 15000) { G.saveCache(cachePath(ctx), tcache); unsaved = 0; lastSave = Date.now(); }
          consecFail = 0;
          stats.google++;
          log(`[${idx}/${total}] ${say('구글 번역', 'Google')}: ${short} -> ${tr.replace(/\n/g, ' ').slice(0, 50)}`);
        } catch (e) {
          if (e instanceof G.StopError) throw e;
          cache.set(n, ''); origin.set(n, '미번역'); stats.failed++; consecFail++;
          log(`[${idx}/${total}] ${say('[실패]', '[Failed]')} ${short} (${e.message})`);
          if (consecFail >= MAX_CONSEC_FAIL) {
            throw new Error(say(`구글 번역이 연속 ${consecFail}번 실패해서 작업을 중단했습니다. (${e.message})\n\n구글이 요청을 일시적으로 막은 상태일 수 있습니다.\n· 잠시 후 다시 실행하세요. 이미 번역된 문장은 저장되어 있어 이어서 진행됩니다.\n· 네트워크(예: 휴대폰 핫스팟)를 바꿔 보세요.\n· '용어집 항목만 번역'을 켜면 구글을 쓰지 않습니다.`,
              `Google translation failed ${consecFail} times in a row, so the work stopped. (${e.message})\n\nGoogle may be blocking requests for a while.\n· Run it again later. Texts already translated are saved, so it carries on from there.\n· Try another network (e.g. a phone hotspot).\n· With 'Glossary entries only' on, Google isn't used.`));
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
    throw new Error(say(`번역 요청이 모두 실패했습니다. 인터넷 연결을 확인하세요. (실패 ${stats.failed}개)`, `Every translation request failed. Check the internet connection. (${stats.failed} failed)`));
  }
}
function nochangeMessage(mode, stats, same) {
  const lines = [mode === 'inplace' ? say('변경할 내용이 없어 모드 파일을 수정하지 않았습니다.', 'Nothing to change, so the mod file was not changed.') : say('번역 결과가 없어 패치 모드를 만들지 않았습니다.', 'No translations, so no patch mod was made.')];
  if (same) lines.push(say(`용어집이 원문과 같거나 비어 있어 그대로 유지한 항목: ${same}곳`, `Kept as they are (the glossary has the same text or none): ${same}`));
  if (stats.skipped) lines.push(say(`건너뜀: ${stats.skipped}개`, `Skipped: ${stats.skipped}`));
  if (stats.failed) lines.push(say(`구글 번역 실패: ${stats.failed}개`, `Google failed: ${stats.failed}`));
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
    ctx.log(say(`[안내] 모드 헤더를 알아볼 수 없어 원본 헤더를 그대로 씁니다 (만든 모드의 속성이 적용되지 않음): ${e.message}`, `[Note] The mod header could not be read, so the original header is kept (the made mod's properties are not applied): ${e.message}`));
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
    if (oldBackup) log(say(`기존 ${label} 파일을 백업했습니다: ${oldBackup}`, `Backed up the earlier ${label} file: ${oldBackup}`));
    atomicWrite(outPath, data);
  } catch (e) {
    throw new Error(say(`출력 폴더에 저장하지 못했습니다: ${dir}\n(${e.message})`, `Could not save to the output folder: ${dir}\n(${e.message})`));
  }
  return oldBackup;
}

// ---- 1. the original edited ----
async function buildInplace(ctx, modPath, glossaryPath, settings, opts = {}) {
  const log = ctx.log;
  const job = await loadAndTranslate(ctx, modPath, glossaryPath, settings, { glossaryOnly: opts.glossaryOnly, keepKorean: false });
  const { data, stats } = job;
  log(say('모드 파일 패치 중...', 'Patching the mod file...'));
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
    log(say('[안내] ', '[Note] ') + msg.replace(/\n/g, ' / '));
    return { mode: 'inplace', path: modPath, changed: 0, stats, same, nochange: true, message: msg, review: job.review };
  }
  const out = swapStrings(data, repl);
  const check = fcs.parseMod(out, { layout: fcs.layoutOf(job.info), only: true });
  if (check.recCount !== job.recCount || check.spans.length !== job.spans.length) throw new Error(say('패치 검증 실패: 레코드/필드 수가 달라졌습니다. 저장하지 않습니다.', 'Patch check failed: the number of records / fields changed. Not saved.'));
  log(say(`패치 결과 검증 통과 (레코드 ${check.recCount}개)`, `Patch check passed (${check.recCount} records)`));
  if (job.srcPath === modPath) {
    if (job.stale && fs.existsSync(job.bakPath)) {
      const old = backups.datedPath(modPath);
      fs.renameSync(job.bakPath, old);
      log(say('오래된 원본 백업을 날짜별 백업으로 옮겼습니다: ', 'Moved the old original backup to the dated backups: ') + old);
    }
    atomicWrite(job.bakPath, data);
    log(say('원본 백업: ', 'Original backup: ') + job.bakPath);
  } else {
    const prev = backups.saveDated(modPath);
    if (prev) log(say(`이전 수정 결과를 날짜별 백업으로 보관했습니다: ${prev} (원본 백업 ${path.basename(job.bakPath)} 은 그대로)`, `Kept the earlier result as a dated backup: ${prev} (the original backup ${path.basename(job.bakPath)} stays)`));
  }
  atomicWrite(modPath, out);
  log(say('저장 완료: ', 'Saved: ') + modPath);
  log(say(`완료 - 교체 ${repl.length}곳 / 원문과 동일 유지 ${same}곳 / 용어집 ${stats.glossary} / 기존 ${stats.existing} / 구글 ${stats.google} / 건너뜀 ${stats.skipped} / 실패 ${stats.failed}`,
    `Done - replaced ${repl.length} / kept (same as the original) ${same} / glossary ${stats.glossary} / earlier ${stats.existing} / Google ${stats.google} / skipped ${stats.skipped} / failed ${stats.failed}`));
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
  if (!variant.change) throw new Error(say("이 파일 형식에는 '수정 레코드' 구조가 없어 별도 패치 모드를 만들 수 없습니다. '원본 모드 직접 수정' 방식을 사용하세요.", "This file format has no 'changed records' part, so a separate patch mod can't be made. Translate the original instead."));
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
    log(say('[안내] ', '[Note] ') + msg.replace(/\n/g, ' / '));
    return { mode: 'patchmod', path: '', changed: 0, records: 0, stats, same, nochange: true, message: msg, name: '', original: path.basename(modPath), review: job.review };
  }
  log(say(`패치 모드 구성 중... (수정 레코드 ${recs.size}개)`, `Building the patch mod... (${recs.size} changed records)`));
  const body = [];
  for (const e of recs.values()) {
    let newName = e.name;
    if (newName !== null && R.textsEqual(newName, e.rec.name)) newName = null;
    body.push(fcs.packChangedRecord(variant, e.rec, newName, [...e.fields]));
  }
  const patch = Buffer.concat([madeHeader(ctx, job.data, info, modPath, 'patchmod'), fcs.i32(recs.size), ...body]);
  const check = fcs.parseMod(patch, { layout: fcs.layoutOf(info), only: true });
  if (check.recCount !== recs.size) throw new Error(say('패치 모드 검증 실패: 레코드 수가 맞지 않습니다. 저장하지 않습니다.', "Patch mod check failed: the record count doesn't match. Not saved."));
  log(say(`패치 모드 구조 검증 통과 (레코드 ${check.recCount}개)`, `Patch mod check passed (${check.recCount} records)`));
  const outPath = path.join(outRoot, name, name + '.mod');
  const oldBackup = writeOut(outPath, patch, log, say('패치 모드', 'patch mod'));
  log(say('저장 완료: ', 'Saved: ') + outPath);
  log(say(`완료 - 수정 레코드 ${recs.size}개 / 문자열 ${changed}곳 (원문과 동일 ${same}곳) / 용어집 ${stats.glossary} / ${langName(R.targetOf(ctx.target))} 복사 ${stats.kept} / 기존 ${stats.existing} / 구글 ${stats.google} / 건너뜀 ${stats.skipped} / 실패 ${stats.failed}`,
    `Done - ${recs.size} changed records / ${changed} texts (${same} same as the original) / glossary ${stats.glossary} / ${langName(R.targetOf(ctx.target))} copied ${stats.kept} / earlier ${stats.existing} / Google ${stats.google} / skipped ${stats.skipped} / failed ${stats.failed}`));
  return { mode: 'patchmod', path: outPath, changed, records: recs.size, stats, same, nochange: false, name, original: path.basename(modPath), oldBackup, review: job.review };
}

// ---- 3. a patch file (the chosen fields copied as they are) ----
const KIND_NAMES = { bool: '참/거짓', float: '실수', int: '정수', vec3: '색상/좌표(값 3개)', quat: '회전(값 4개)' };
const KIND_NAMES_EN = { bool: 'true / false', float: 'decimal', int: 'integer', vec3: 'colour / position (3 values)', quat: 'rotation (4 values)' };
const g = (x) => { // Python '%g'
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e < -4 || e >= 6) return x.toExponential(5).replace(/\.?0+e/, 'e').replace(/e([+-])(\d)$/, 'e$10$2');
  return String(Number(x.toPrecision(6)));
};

async function buildCopyPatch(ctx, modPath, patchSettings0, outRoot) {
  const log = ctx.log;
  if (!fs.existsSync(modPath)) throw new Error(say('모드 파일을 찾을 수 없습니다: ', 'Mod file not found: ') + modPath);
  if (ctx.progress) ctx.progress(0, 0);
  log(say('모드 파일 읽는 중: ', 'Reading the mod file: ') + modPath);
  const data = fs.readFileSync(modPath);
  const { spans, info } = fcs.parseMod(data, { log, wantNumeric: true });
  logDialogueInfo(info, log);
  const variant = info.variant;
  if (!variant.change) throw new Error(say("이 파일 형식에는 '수정 레코드' 구조가 없어 패치파일을 만들 수 없습니다.", "This file format has no 'changed records' part, so a patch file can't be made."));
  const ps = R.applyRuleFallback(patchSettings0, spans, info.numeric, log);
  const targets = R.selectCopyTargets(spans, ps, log);
  const numTargets = R.selectCopyNumeric(info.numeric, ps, log);
  R.reportUnmatchedRules(ps, spans, info.numeric, log);
  const items = [...targets.map((sp) => [sp.start, 0, sp]), ...numTargets.map((nf) => [nf.start, 1, nf])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!items.length) {
    const msg = say('복사할 항목이 없어 패치파일을 만들지 않았습니다.\n패치 설정의 복사 영역 / 복사 제외를 확인하세요. (자세한 이유는 로그의 [안내] 참고)', "Nothing to copy, so no patch file was made.\nCheck the copy fields / copy exclusions in the patch settings. (The log's [Note] lines say why)");
    log(say('[안내] ', '[Note] ') + msg.replace(/\n/g, ' '));
    return { mode: 'copypatch', path: '', changed: 0, records: 0, stats: emptyStats(), same: 0, nochange: true, message: msg, name: '', original: path.basename(modPath) };
  }
  const { recs, slot } = groupRecords();
  const total = items.length;
  let lastSid = {};
  for (let n = 1; n <= total; n++) {
    await breathe(n);
    stopped(ctx);
    const [, isNum, obj] = items[n - 1];
    if (obj.sid !== lastSid) { log(`# [${obj.sid || say('(String ID 없음)', '(no String ID)')}]`); lastSid = obj.sid; }
    const e = slot(obj.rec, true);
    if (isNum) {
      setDefault(e.nums[obj.kind], obj.raw, obj.value);
      const shown = obj.kind === 'bool' ? (obj.value ? say('참', 'true') : say('거짓', 'false')) : obj.kind === 'vec3' || obj.kind === 'quat' ? obj.value.map(g).join(' ') : obj.kind === 'float' ? g(obj.value) : obj.value;
      log(`[${n}/${total}] ${say('복사', 'Copied')}: ${obj.key} = ${shown} (${say(KIND_NAMES[obj.kind], KIND_NAMES_EN[obj.kind])})`);
    } else {
      let label;
      if (obj.raw === null) { e.name = obj.text; label = 'name'; }
      else { setDefault(e.fields, obj.raw, obj.text); label = obj.key; }
      log(`[${n}/${total}] ${say('복사', 'Copied')}: ${label} = ${obj.text.replace(/\r\n/g, ' ').replace(/\n/g, ' ').slice(0, 50)}`);
    }
    if (ctx.progress) ctx.progress(n, total);
  }
  log(say(`패치파일 구성 중... (복사 레코드 ${recs.size}개 / 항목 ${total}곳)`, `Building the patch file... (${recs.size} records / ${total} fields copied)`));
  const body = [];
  for (const e of recs.values()) {
    const nums = Object.fromEntries(Object.entries(e.nums).map(([k, m]) => [k, [...m]]));
    body.push(fcs.packChangedRecord(variant, e.rec, e.name, [...e.fields], nums));
  }
  const patch = Buffer.concat([madeHeader(ctx, data, info, modPath, 'copypatch'), fcs.i32(recs.size), ...body]);
  const check = fcs.parseMod(patch, { wantNumeric: true, layout: fcs.layoutOf(info), only: true });
  if (check.recCount !== recs.size) throw new Error(say('패치파일 검증 실패: 레코드 수가 맞지 않습니다. 저장하지 않습니다.', "Patch file check failed: the record count doesn't match. Not saved."));
  const f32hex = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b.toString('hex'); };
  const numKey = (nf) => `${nf.sid}\u0000${nf.kind}\u0000${nf.raw}\u0000${nf.kind === 'float' ? f32hex(nf.value) : nf.kind === 'vec3' || nf.kind === 'quat' ? nf.value.map(f32hex).join('') : nf.value}`;
  const actual = new Set(check.spans.map((s) => `${s.sid}\u0000${s.raw}\u0000${s.text}`));
  const actualNum = new Set(check.info.numeric.map(numKey));
  const missing = targets.filter((sp) => !actual.has(`${sp.sid}\u0000${sp.raw}\u0000${sp.text}`)).length + numTargets.filter((nf) => !actualNum.has(numKey(nf))).length;
  if (missing) throw new Error(say(`패치파일 검증 실패: 복사한 값 ${missing}곳이 결과에 없습니다. 저장하지 않습니다.`, `Patch file check failed: ${missing} copied values are missing from the result. Not saved.`));
  log(say(`패치파일 구조 검증 통과 (레코드 ${check.recCount}개)`, `Patch file check passed (${check.recCount} records)`));
  const name = modStem(modPath) + COPY_PATCH_SUFFIX;
  const outPath = path.join(outRoot, name, name + '.mod');
  const oldBackup = writeOut(outPath, patch, log, say('패치', 'patch'));
  log(say('저장 완료: ', 'Saved: ') + outPath);
  log(say(`완료 - 복사 레코드 ${recs.size}개 / 항목 ${total}곳`, `Done - ${recs.size} records / ${total} fields copied`));
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
  if (!fs.existsSync(modPath)) throw new Error(say('모드 파일을 찾을 수 없습니다: ', 'Mod file not found: ') + modPath);
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
    if (G.glossaryLine(fcs.displayText(n)) === null) { skipped++; log(say("[경고] '=|=' 포함 문장은 용어집 형식으로 표기할 수 없어 제외: ", "[Warning] A text with '=|=' can't be written as a glossary line; left out: ") + n.replace(/\n/g, ' ').slice(0, 50)); continue; }
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
      const k = sp.sid || say('(String ID 없음)', '(no String ID)');
      if (!general.has(k)) general.set(k, []);
      general.get(k).push(n);
    }
  }
  const count = [...general.values()].reduce((s, v) => s + v.length, 0) + dlgCount;
  if (!count) throw new Error(say('번역 대상 텍스트를 찾지 못했습니다. (작업 설정을 확인하세요)', 'No text to translate was found. (Check the work settings)'));
  const outPath = path.join(dirOf(ctx, 'extract'), `${modStem(modPath)}_glossary_${backups.stamp('yyMMdd_HHmmss')}.txt`);
  const w = [];
  const line = (t) => G.glossaryLine(fcs.displayText(t));
  for (const [sid, items] of general) { w.push(`# [${sid}]`); for (const t of items) w.push(line(t)); }
  if (dialog.size) {
    w.push('', say('# ======== DIALOGUE_LINE (대사)  PACKAGE > DIALOGUE > LINE ========', '# ======== DIALOGUE_LINE (lines)  PACKAGE > DIALOGUE > LINE ========'));
    let prev = null;
    const groups = [...dialog.values()].sort((a, b) => cmpTuple(a.pkgKey, b.pkgKey) || a.first - b.first);
    for (const grp of groups) {
      const pk = JSON.stringify(grp.pkgKey);
      if (pk !== prev) {
        w.push('');
        if (grp.pkgs.length) for (const p of grp.pkgs) w.push('# [DIALOGUE_PACKAGE] ' + describeRec(p));
        else w.push(say('# [DIALOGUE_PACKAGE] (연결 정보 없음)', '# [DIALOGUE_PACKAGE] (not linked)'));
        prev = pk;
      }
      w.push(grp.dlg ? '#   [DIALOGUE] ' + describeRec(grp.dlg) : say('#   [DIALOGUE] (연결 정보 없음)', '#   [DIALOGUE] (not linked)'));
      const lines = [...grp.lines].sort((a, b) => (index.order.has(a[0]) ? index.order.get(a[0]) : 1e9) - (index.order.has(b[0]) ? index.order.get(b[0]) : 1e9) || a[1].seq - b[1].seq);
      for (const [lineSid, l] of lines) {
        w.push('#     [DIALOGUE_LINE] ' + (lineSid || say('(String ID 없음)', '(no String ID)')));
        for (const [, t] of [...l.texts].sort((a, b) => textKeyOrder(a[0]) - textKeyOrder(b[0]))) w.push(line(t));
      }
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, '﻿' + w.join('\n') + '\n', 'utf8');
  log(say(`추출 완료: ${count}개 (일반 String ID ${general.size}개 / 대사 ${dlgCount}개, 중복 ${dup}개, 제외 ${skipped}개)`, `Extracted: ${count} (${general.size} String IDs / ${dlgCount} dialogue lines, ${dup} duplicates, ${skipped} left out)`));
  log(say('저장: ', 'Saved to: ') + outPath);
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
  const lines = say(['# Kenshi Mod Translator 번역 검수 파일 - 프로그램이 읽는 파일입니다. 형식을 바꾸지 마세요.', '# field 의 @name 은 레코드 이름(FCS 의 Base - name), 그 외는 FCS 의 필드 이름입니다.'],
    ["# Kenshi Mod Translator review file - the program reads this file. Don't change its format.", "# In field, @name is the record's name (FCS: Base - name); anything else is an FCS field name."]);
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
  ctx.log(say(`[안내] 번역 검수 파일 저장: ${p} (${entries.length}곳)`, `[Note] Review file saved: ${p} (${entries.length})`));
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
    const k = e.sid || say('(String ID 없음)', '(no String ID)');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([src, fcs.displayText(e.dst)]);
  }
  const count = [...groups.values()].reduce((s, v) => s + v.length, 0);
  if (!count) { ctx.log(say('[안내] 구글 번역으로 처리한 문장이 없어 No glossary 파일은 만들지 않았습니다.', '[Note] Nothing was translated by Google, so no "No glossary" file was made.')); return { path: '', count: 0 }; }
  fs.mkdirSync(dirOf(ctx, 'noGloss'), { recursive: true });
  const p = stampedPath(dirOf(ctx, 'noGloss'), `${modStem(modPath)}_No glossary`);
  const w = say([`# 용어집에 없어 구글 번역으로 처리한 문장 (${path.basename(modPath)})`, '# 번역문을 고친 뒤 glossary.txt 에 붙여 넣으면 다음 작업부터 용어집으로 적용됩니다.'],
    [`# Texts not in the glossary, translated by Google (${path.basename(modPath)})`, '# Fix the translations, then paste them into glossary.txt: from the next run they count as glossary entries.']);
  for (const [sid, items] of groups) {
    w.push(`# [${sid}]`);
    for (const [s, d] of items) w.push(G.glossaryLine(s, d.replace(/\r\n/g, '\n')));
  }
  fs.writeFileSync(p, '﻿' + w.join('\n') + '\n', 'utf8');
  ctx.log(say(`[안내] 구글 번역 용어를 용어집 형식으로 저장: ${p} (${count}개${skipped ? `, '=|=' 포함 ${skipped}개 제외` : ''})`, `[Note] Google's translations saved as glossary lines: ${p} (${count}${skipped ? `, ${skipped} with '=|=' left out` : ''})`));
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
      if (missing <= 20) log(`${say('[경고] 모드에서 찾지 못한 항목', '[Warning] Not found in the mod')}: [${e.sid}] ${fieldLabel(e.field)} / ${e.src.replace(/\n/g, ' ').slice(0, 50)}`);
      continue;
    }
    for (const i of idxs) {
      let t = e.dst.replace(/\r\n/g, '\n');
      if (spans[i].text.includes('\r\n')) t = t.replace(/\n/g, '\r\n');
      repl.set(i, t);
    }
  }
  if (missing > 20) log(say(`[경고] ... 찾지 못한 항목이 모두 ${missing}개입니다.`, `[Warning] ... ${missing} not found in all.`));
  return { repl, missing, empty };
}

// Put the picked review entries into the mod (inplace) or the _KO patch mod (patchmod; _EN … by
// the language the review file was made for).
function applyReview(ctx, meta, entries, mode, makeBackup, outRoot) {
  ctx = { ...ctx, target: R.targetOf(meta.target || 'ko') };
  const log = ctx.log;
  const modPath = meta.mod || '';
  if (!modPath || !fs.existsSync(modPath)) throw new Error(say('검수 파일에 저장된 원본 모드 파일을 찾을 수 없습니다:\n', 'The original mod file named in the review file was not found:\n') + modPath);
  const src = fcs.readModSource(fs, modPath, log);
  const { repl, missing, empty } = matchEntries(src.spans, entries, log);
  if (!repl.size) throw new Error(say(`모드에 넣을 항목이 없습니다. (찾지 못함 ${missing} / 번역문 비어 있음 ${empty})`, `Nothing to put into the mod. (not found ${missing} / empty translation ${empty})`));
  if (mode === 'inplace') {
    let curData = src.data, curSpans = src.spans;
    if (src.srcPath !== modPath) {
      curData = fs.readFileSync(modPath);
      curSpans = fcs.parseMod(curData, { layout: fcs.layoutOf(src.info) }).spans;
      if (curSpans.length !== src.spans.length) throw new Error(say('지금 모드 파일과 원본 백업의 구조가 달라 넣을 수 없습니다.', "The mod file and its original backup differ in structure, so it can't be put in."));
    }
    const list = [];
    let same = 0;
    for (const i of [...repl.keys()].sort((a, b) => curSpans[a].start - curSpans[b].start)) {
      if (curSpans[i].text === repl.get(i)) { same++; continue; }
      list.push([curSpans[i], repl.get(i)]);
    }
    if (!list.length) {
      log(say('[안내] 고른 항목이 이미 모두 같은 번역으로 들어 있어 모드 파일을 바꾸지 않았습니다.', '[Note] The chosen entries already have the same translations; the mod file was not changed.'));
      return { path: modPath, changed: 0, same, missing, backup: '' };
    }
    const out = swapStrings(curData, list);
    if (fcs.parseMod(out, { layout: fcs.layoutOf(src.info), only: true }).recCount !== src.recCount) throw new Error(say('검증 실패: 레코드 수가 달라졌습니다. 저장하지 않습니다.', 'Check failed: the record count changed. Not saved.'));
    let backup = '';
    const bakPath = modPath + '.bak';
    if (src.srcPath === modPath) {
      if (src.stale && fs.existsSync(bakPath)) { const old = backups.datedPath(modPath); fs.renameSync(bakPath, old); log(say('오래된 원본 백업을 날짜별 백업으로 옮겼습니다: ', 'Moved the old original backup to the dated backups: ') + old); }
      atomicWrite(bakPath, src.data);
      backup = bakPath;
      log(say('원본 백업: ', 'Original backup: ') + bakPath);
    } else if (makeBackup) {
      backup = backups.saveDated(modPath);
      log(say('지금 모드 파일을 날짜별 백업으로 보관했습니다: ', 'Kept the current mod file as a dated backup: ') + backup);
    }
    atomicWrite(modPath, out);
    log(say(`[완료] 원본 모드에 ${list.length}곳을 넣었습니다: ${modPath} (이미 같음 ${same} / 찾지 못함 ${missing})`, `[Done] Put ${list.length} into the original mod: ${modPath} (already the same ${same} / not found ${missing})`));
    return { path: modPath, changed: list.length, same, missing, backup };
  }
  const variant = src.info.variant;
  if (!variant.change) throw new Error(say("이 파일 형식에는 '수정 레코드' 구조가 없어 별도 패치 모드를 만들 수 없습니다.", "This file format has no 'changed records' part, so a separate patch mod can't be made."));
  const name = modStem(modPath) + R.patchSuffix(ctx.target);
  const root = (outRoot || meta.out || '').trim() || ctx.dataDir;
  const outPath = path.join(root, name, name + '.mod');
  const order = new Map(src.info.recSids.map((sid, n) => [sid, n]));
  const srcRecs = new Map(src.spans.map((sp) => [sp.rec.sid, sp.rec]));
  const recs = new Map();
  const slot = (rec) => { if (!recs.has(rec.sid)) recs.set(rec.sid, { rec, name: null, fields: new Map() }); return recs.get(rec.sid); };
  if (fs.existsSync(outPath)) {
    let pspans;
    try { pspans = fcs.parseMod(fs.readFileSync(outPath), { layout: fcs.layoutOf(src.info) }).spans; } catch (e) { throw new Error(say(`기존 패치 모드를 읽지 못했습니다: ${outPath}\n(${e.message})`, `Could not read the existing patch mod: ${outPath}\n(${e.message})`)); }
    for (const sp of pspans) {
      const base = srcRecs.get(sp.sid) || sp.rec;
      const e = slot(base);
      if (sp.raw === null) { if (!R.textsEqual(sp.text, base.name)) e.name = sp.text; }
      else e.fields.set(sp.raw, sp.text);
    }
    log(say(`기존 패치 모드의 내용을 유지합니다: ${outPath} (문자열 ${pspans.length}곳)`, `Keeping what the existing patch mod has: ${outPath} (${pspans.length} texts)`));
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
  if (fcs.parseMod(patch, { layout: fcs.layoutOf(src.info), only: true }).recCount !== body.length) throw new Error(say('패치 모드 검증 실패: 레코드 수가 맞지 않습니다. 저장하지 않습니다.', "Patch mod check failed: the record count doesn't match. Not saved."));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const backup = makeBackup ? backups.backupExisting(outPath) : '';
  if (backup) log(say('기존 패치 모드 파일을 백업했습니다: ', 'Backed up the existing patch mod file: ') + backup);
  atomicWrite(outPath, patch);
  log(say(`[완료] 패치 모드에 ${repl.size}곳을 넣었습니다: ${outPath} (레코드 ${body.length}개 / 찾지 못함 ${missing})`, `[Done] Put ${repl.size} into the patch mod: ${outPath} (${body.length} records / not found ${missing})`));
  return { path: outPath, changed: repl.size, same: 0, missing, backup, name };
}

module.exports = {
  PATCH_SUFFIX, COPY_PATCH_SUFFIX, ORIGINS, emptyStats,
  loadAndTranslate, buildInplace, buildPatchMod, buildCopyPatch, extractTerms,
  writeReviewFile, readReviewFile, listReviewFiles, reviewFiles, reviewInfo, saveJobReview, exportNoGlossary, applyReview, fieldLabel, reviewDir,
};
