// Which strings of a mod are worked on: the base fields, the user's own field / exclude rules
// and the languages to detect. Ported from Kenshi Mod Translator (KMT).
const { getCloseMatches } = require('./difflib');
const { BUILDING_TYPE } = require('./fcs');
const { say, LANG_EN } = require('./lang');

const TYPE_NAMES = {
  0: 'BUILDING', 1: 'CHARACTER', 2: 'WEAPON', 3: 'ARMOUR', 4: 'ITEM',
  5: 'ANIMAL_ANIMATION', 6: 'ATTACHMENT', 7: 'RACE', 9: 'NATURE', 10: 'FACTION',
  13: 'TOWN', 16: 'LOCATIONAL_DAMAGE', 17: 'COMBAT_TECHNIQUE', 18: 'DIALOGUE',
  19: 'DIALOGUE_LINE', 21: 'RESEARCH', 22: 'AI_TASK', 24: 'ANIMATION', 25: 'STATS',
  26: 'PERSONALITY', 27: 'CONSTANTS', 28: 'BIOMES', 29: 'BUILDING_PART',
  30: 'INSTANCE_COLLECTION', 31: 'DIALOG_ACTION', 43: 'REPEATABLE_BUILDING_PART_SLOT',
  44: 'MATERIAL_SPEC', 45: 'MATERIAL_SPECS_COLLECTION', 46: 'CONTAINER',
  47: 'MATERIAL_SPECS_CLOTHING', 49: 'VENDOR_LIST', 50: 'MATERIAL_SPECS_WEAPON',
  51: 'WEAPON_MANUFACTURER', 52: 'SQUAD_TEMPLATE', 53: 'ROAD', 55: 'COLOR_DATA',
  59: 'FOLIAGE_LAYER', 60: 'FOLIAGE_MESH', 61: 'GRASS', 62: 'BUILDING_FUNCTIONALITY',
  63: 'DAY_SCHEDULE', 64: 'NEW_GAME_STARTOFF', 68: 'WILDLIFE_BIRDS', 69: 'MAP_FEATURES',
  70: 'DIPLOMATIC_ASSAULTS', 71: 'SINGLE_DIPLOMATIC_ASSAULT', 72: 'AI_PACKAGE',
  73: 'DIALOGUE_PACKAGE', 74: 'GUN_DATA', 76: 'ANIMAL_CHARACTER',
  77: 'UNIQUE_SQUAD_TEMPLATE', 78: 'FACTION_TEMPLATE', 80: 'WEATHER', 81: 'SEASON',
  82: 'EFFECT', 83: 'ITEM_PLACEMENT_GROUP', 84: 'WORD_SWAPS', 86: 'NEST_ITEM',
  87: 'CHARACTER_PHYSICS_ATTACHMENT', 88: 'LIGHT', 89: 'HEAD', 92: 'FOLIAGE_BUILDING',
  93: 'FACTION_CAMPAIGN', 95: 'BIOME_GROUP', 96: 'EFFECT_FOG_VOLUME', 97: 'FARM_DATA',
  98: 'FARM_PART', 99: 'ENVIRONMENT_RESOURCES', 100: 'RACE_GROUP', 101: 'ARTIFACTS',
  102: 'MAP_ITEM', 103: 'BUILDINGS_SWAP', 104: 'ITEMS_CULTURE', 105: 'ANIMATION_EVENT',
  107: 'CROSSBOW',
};
// in the same order as Python's dict
const TYPE_ORDER = Object.keys(TYPE_NAMES).map(Number).sort((a, b) => a - b);
const TYPE_BY_NAME = new Map(TYPE_ORDER.map((k) => [TYPE_NAMES[k].toLowerCase(), k]));
const typeName = (t) => TYPE_NAMES[t] || String(t);

// The base fields: [group title, [[key, label, short, long]]]
const FIELD_GROUPS = [
  ['1. Base (기본 정보)', [
    ['base.name', 'name', '화면에 노출되는 대상의 이름', '게임 내에서 실제로 표시되는 대상의 이름(화면상 노출되는 명칭)입니다.\n※ DIALOGUE / DIALOGUE_LINE / DIALOGUE_PACKAGE 레코드의 이름은 편집기 내부 표기라 제외됩니다.'],
  ]],
  ['2. General (일반 설정)', [
    ['general.category', 'category', 'FCS 내부 관리용 분류 카테고리', 'FCS 내 내부 관리용 분류 카테고리입니다. 게임 플레이에는 직접적인 영향을 주지 않으며, FCS 편집기 목록에서 항목을 정렬하고 찾는 용도로 쓰입니다.'],
    ['general.description', 'description', '툴팁 / 설명 창에 출력되는 텍스트', '게임 내 마우스 오버 툴팁이나 설명 창에 출력되는 텍스트입니다.\n※ 건물(BUILDING)이 아닌 레코드의 description 이 이 항목에 해당합니다.'],
  ]],
  ['3. Type (유형 및 건물 분류)', [
    ['type.building category', 'building category', '건설 메뉴의 대분류 카테고리', '건설 메뉴(Build Menu) 상에서 해당 건물이 속할 대분류 카테고리를 지정합니다. (예: Buildings, Crafting, Walls, Furniture 등)'],
    ['type.building group', 'building group', '건설 메뉴의 중분류 그룹', '동일한 그룹에 속한 건물들을 하나로 묶어주는 중분류입니다. 건설 메뉴 내에서 관련 아이템들이 하위 그룹으로 묶이도록 처리합니다.'],
    ['type.description', 'description', '건물 유형에 대한 추가 설명', '해당 건물 유형(Type)에 대한 추가적인 설명 정보입니다. (General 의 description 과 동일하게 툴팁/설명창용으로 활용됨)\n※ 건물(BUILDING) 레코드의 description 이 이 항목에 해당합니다.'],
  ]],
  ['4. Town Residents (도시 주민 / 거주 건물 설정)', [
    ['town.building name', 'building name', '건물 GUI 패널에 표시되는 건물 명칭', '게임 내 건물 GUI 패널에 표시될 건물의 명칭을 설정합니다. 비워둘 경우 아래의 interior layout(내부 레이아웃) 이름이 기본값으로 사용됩니다.'],
  ]],
  ['5. DIALOGUE_LINE (대화 라인)', [
    ['dialogue.text', 'text  (text, text0 ~ text4)', 'NPC / 캐릭터가 출력하는 실제 대사 문장', '대화 시스템(Dialogue Package/Event) 실행 시 NPC나 캐릭터가 말풍선 혹은 대화창으로 출력하는 실제 대사 문장입니다. text, text0, text1, text2 ... 형태의 필드를 모두 추출합니다.'],
  ]],
];

// Excluded source mods: [lower-case name, label, short, long]
const EXCLUDE_DEFS = [
  ['rebirth.mod', 'rebirth.mod', '구 버전 기반 모드/데이터 파일', 'Kenshi의 초기 개발 단계에서 사용되던 구 버전 기반 모드/데이터 파일입니다. 현재는 기본 엔진 데이터의 일부로 로드됩니다.'],
  ['gamedata.base', 'gamedata.base', '게임 전체의 뼈대가 되는 기본 데이터', 'Kenshi 게임 전체의 뼈대가 되는 최상위 기본 데이터 베이스 파일입니다. 모든 기본 아이템, 종족, 건물, 대화, 스탯 등의 원본(Vanilla) 정의가 담겨 있습니다.'],
  ['newwworld.mod', 'Newwworld.mod', '맵(월드) 및 지역 구조 데이터', 'Kenshi의 맵(월드) 및 지역 구조를 구성하는 핵심 월드 데이터 파일입니다. 지형, 도시/마을 위치, 바이옴 등을 담당합니다.'],
  ['dialogue.mod', 'Dialogue.mod', '기본 대화(Dialogue) 모음', '게임 내 모든 세력, NPC, 동료들의 기본 대화(Dialogue) 모음 파일입니다.'],
];

// Languages to detect: [key, name, one letter, tip]
const LANG_DEFS = [
  ['ko', '한국어', '한', '한글이 들어 있는 문장을 감지 대상에 포함합니다.\n· 별도 한국어 패치 모드 생성: 감지된 한글 문장을 모두 처리합니다. 용어집에 있으면 용어집 번역으로 바꾸고, 없으면 기존 한국어를 그대로 복사해 패치에 넣습니다.\n· 원본 모드 직접 수정: 용어집에 있는 한글 문장만 교체합니다.\n※ 한글이 하나라도 들어 있는 문장은 구글 번역을 하지 않습니다. 기본값은 해제입니다.'],
  ['en', '영어', '영', '알파벳(라틴 문자)이 들어 있는 문장을 감지합니다.\n※ 글자 체계 기준이라 라틴 문자를 쓰는 다른 언어(프랑스어, 독일어 등)도 함께 감지됩니다.'],
  ['zh', '중국어', '중', '한자가 들어 있고 히라가나/가타카나가 없는 문장을 중국어로 감지합니다.\n※ 한자만 있는 문장은 중국어와 일본어를 글자만으로 구분할 수 없어 \'중국어\'로 봅니다.'],
  ['ja', '일본어', '일', '히라가나/가타카나가 들어 있는 문장을 일본어로 감지합니다.\n※ 한자만 있는 문장은 \'중국어\'가 해제되어 있을 때에만 일본어로 간주합니다.'],
  ['ru', '러시아어', '러', '키릴 문자가 들어 있는 문장을 감지합니다.'],
];
const ALL_LANGS = new Set(LANG_DEFS.map((d) => d[0]));
const DEFAULT_LANGS = new Set(['en', 'zh', 'ja', 'ru']);

// Languages to translate into: code -> { google (its tl=), native name, script (the LANG_DEFS key
// its own text is told by, or null for Latin languages other than English), the made mod's
// description prefix [label, 'original:'] }. The made patch mod is <mod>_<CODE>.
const TARGETS = {
  ko: { google: 'ko', native: '한국어', script: 'ko', prefix: ['한글화 패치', '원본:'] },
  en: { google: 'en', native: 'English', script: 'en', prefix: ['English translation', 'Original:'] },
  ja: { google: 'ja', native: '日本語', script: 'ja', prefix: ['日本語化パッチ', '元のMOD:'] },
  zh: { google: 'zh-CN', native: '中文', script: 'zh', prefix: ['汉化补丁', '原模组:'] },
  ru: { google: 'ru', native: 'Русский', script: 'ru', prefix: ['Русификатор', 'Оригинал:'] },
  de: { google: 'de', native: 'Deutsch', script: null, prefix: ['Deutsche Übersetzung', 'Original:'] },
  fr: { google: 'fr', native: 'Français', script: null, prefix: ['Traduction française', 'Original :'] },
  es: { google: 'es', native: 'Español', script: null, prefix: ['Traducción al español', 'Original:'] },
  pt: { google: 'pt', native: 'Português', script: null, prefix: ['Tradução em português', 'Original:'] },
  pl: { google: 'pl', native: 'Polski', script: null, prefix: ['Polskie tłumaczenie', 'Oryginał:'] },
  tr: { google: 'tr', native: 'Türkçe', script: null, prefix: ['Türkçe çeviri', 'Orijinal:'] },
};
const targetOf = (t) => (TARGETS[t] ? t : 'ko');
const patchSuffix = (t) => '_' + targetOf(t).toUpperCase();
// A language code (the manager's 'ko' / 'en' / 'pt-BR' …) -> a target, or '' when there is none.
const targetFromLang = (lang) => { const k = String(lang || '').toLowerCase().split(/[-_]/)[0]; return TARGETS[k] ? k : ''; };
// Every script but the target's own (for Korean: KMT's default).
function defaultLangsFor(t) {
  const own = TARGETS[targetOf(t)].script;
  return Object.fromEntries(LANG_DEFS.map(([k]) => [k, k !== own]));
}
// The target changed from a to b: b's own script is no longer looked for, a's is (a ko <-> ja swap
// and back leaves the choice as it was).
function swapLangs(langs, a, b) {
  const sa = TARGETS[targetOf(a)].script, sb = TARGETS[targetOf(b)].script;
  if (sa === sb) return langs;
  if (sa && sa in langs) langs[sa] = true;
  if (sb && sb in langs) langs[sb] = false;
  return langs;
}

const HANGUL_RE = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const LATIN_RE = /[A-Za-zÀ-ɏ]/;
const CYRILLIC_RE = /[Ѐ-ӿ]/;
const KANA_RE = /[぀-ヿ]/;
const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/;

const EXCLUDE_EXT = ['.mod', '.base', '.png', '.dds', '.tga', '.jpg', '.jpeg', '.bmp', '.mesh',
  '.model', '.xml', '.ogg', '.wav', '.mp3', '.lua', '.txt', '.tex', '.skeleton',
  '.material', '.particle', '.fbx', '.ini', '.cfg', '.json', '.csv', '.dll', '.exe',
  '.layout', '.imageset', '.font', '.zip'];

const RECORD_NAME_KEY = '@name'; // the record's own name (FCS 'Base - name') in the user's rules

// 만든 모드의 속성 (its header): the original's 필수 모드 kept / deleted / moved to 참조, its 참조 모드
// kept / deleted, the original added as 필수, and '[한글화 패치] 원본: …' at the top of the description.
const defaultHeader = () => ({ deps: 'delete', refs: 'keep', addOriginal: true, prefix: true });
// From what was saved (v1.2.92 kept checkboxes: keepDeps / moveDeps / keepRefs; left at their
// defaults they take the new defaults).
function mergeHeader(s, h) {
  if (!h || typeof h !== 'object') return s;
  if (['keep', 'delete', 'move'].includes(h.deps)) s.deps = h.deps;
  else if (typeof h.keepDeps === 'boolean' && !(h.keepDeps && h.keepRefs !== false && h.addOriginal !== false && !h.moveDeps && h.prefix !== false)) {
    s.deps = h.keepDeps ? 'keep' : h.moveDeps ? 'move' : 'delete';
    s.refs = h.keepRefs === false ? 'delete' : 'keep';
  }
  if (['keep', 'delete'].includes(h.refs)) s.refs = h.refs;
  if (typeof h.addOriginal === 'boolean') s.addOriginal = h.addOriginal;
  if (typeof h.prefix === 'boolean') s.prefix = h.prefix;
  return s;
}

function defaultSettings() {
  const fields = {};
  for (const [, items] of FIELD_GROUPS) for (const [k] of items) fields[k] = true;
  const exclude = {};
  for (const [k] of EXCLUDE_DEFS) exclude[k] = true;
  return {
    fields, exclude,
    custom: { fields_on: true, fields: [], exclude_on: true, exclude: [] },
    langs: Object.fromEntries(LANG_DEFS.map(([k]) => [k, DEFAULT_LANGS.has(k)])),
    header: defaultHeader(),
  };
}
function defaultPatchSettings() {
  const s = defaultSettings();
  delete s.langs;
  return s;
}
function cleanLines(v) {
  if (typeof v === 'string') v = v.split(/\r\n|\r|\n/);
  return (v || []).map((x) => String(x).trim()).filter(Boolean);
}
// Saved settings over the defaults (unknown keys dropped, new items keep their default).
function mergeSettings(s, data) {
  if (!data || typeof data !== 'object') return s;
  for (const grp of ['fields', 'exclude', 'langs']) {
    if (!s[grp]) continue;
    for (const [k, v] of Object.entries(data[grp] || {})) if (k in s[grp]) s[grp][k] = !!v;
  }
  const c = data.custom || {};
  s.custom.fields_on = c.fields_on === undefined ? true : !!c.fields_on;
  s.custom.exclude_on = c.exclude_on === undefined ? true : !!c.exclude_on;
  s.custom.fields = cleanLines(c.fields);
  s.custom.exclude = cleanLines(c.exclude);
  if (s.header) mergeHeader(s.header, data.header);
  return s;
}

function selectedLangs(settings) {
  const langs = settings && settings.langs;
  if (!langs) return new Set(DEFAULT_LANGS);
  return new Set(Object.keys(langs).filter((k) => langs[k]));
}
function langNames(langs) { return LANG_DEFS.filter(([k]) => langs.has(k)).map((d) => say(d[1], LANG_EN[d[0]] || d[0])).join(', ') || say('없음', 'none'); }

function langMatch(text, langs) {
  if (langs.has('ko') && HANGUL_RE.test(text)) return true;
  if (langs.has('en') && LATIN_RE.test(text)) return true;
  if (langs.has('ru') && CYRILLIC_RE.test(text)) return true;
  if (KANA_RE.test(text)) { if (langs.has('ja')) return true; }
  else if (HAN_RE.test(text)) { if (langs.has('zh') || langs.has('ja')) return true; }
  return false;
}
const hasHangul = (t) => HANGUL_RE.test(t || '');
// Text already in the target language, told by its letters (Hangul / Cyrillic / kana / Han without
// kana). Latin languages can't be told apart this way: never (they go to Google, which keeps them).
function isTargetText(t, target) {
  t = t || '';
  switch (TARGETS[targetOf(target)].script) {
    case 'ko': return HANGUL_RE.test(t);
    case 'ru': return CYRILLIC_RE.test(t);
    case 'ja': return KANA_RE.test(t);
    case 'zh': return HAN_RE.test(t) && !KANA_RE.test(t);
    default: return false;
  }
}
const norm = (t) => (t || '').replace(/\r\n/g, '\n').trim();
const textsEqual = (a, b) => norm(a) === norm(b);

const W = '[\\p{L}\\p{N}_]'; // Python's \w
const NUM_ONLY = /^[-+]?\p{Nd}+(\.\p{Nd}+)?$/u;
const PATH_LIKE = new RegExp(`^[${W.slice(1, -1)}\\-.]*[/\\\\][${W.slice(1, -1)}\\-./\\\\]*\\.${W}{1,5}$`, 'u');
const INTERNAL_ID = new RegExp(`^[A-Za-z0-9_\\-]+-[0-9]+-${W}+\\.${W}+$`, 'u');

// Is this text worth translating? (has letters of a chosen language; not a number, file name, path or id)
function isTranslatable(text, langs = DEFAULT_LANGS) {
  if (text == null) return false;
  const t = text.trim();
  if (!t) return false;
  if (!langMatch(t, langs)) return false;
  if (NUM_ONLY.test(t)) return false;
  const low = t.toLowerCase();
  if (EXCLUDE_EXT.some((e) => low.endsWith(e))) return false;
  if (PATH_LIKE.test(t)) return false;
  if (INTERNAL_ID.test(t)) return false;
  return true;
}

// '57328-rebirth.mod' -> 'rebirth.mod'
function sourceModOf(sid) {
  const s = (sid || '').trim().toLowerCase();
  const i = s.indexOf('-');
  return i >= 0 ? s.slice(i + 1) : s;
}
function parseTypeToken(tok) {
  const t = (tok || '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  const k = TYPE_BY_NAME.get(t.toLowerCase().replace(/ /g, '_').replace(/-/g, '_'));
  return k === undefined ? null : k;
}

// FCS 'Section - field' separator (a space on at least one side: 'building-group' stays whole)
const SECTION_SEP_RE = /\s-\s|\s-(?=\S)|(?<=\S)-\s|\s[–—]\s/;
function splitOnce(s, re) {
  const m = re.exec(s);
  return m ? [s.slice(0, m.index), s.slice(m.index + m[0].length)] : [s];
}
const lstripChars = (s, chars) => { let i = 0; while (i < s.length && chars.includes(s[i])) i++; return s.slice(i); };
const BULLETS = '•·▪● ';
const TYPE_NAMES_UPPER = [...TYPE_BY_NAME.keys()].map((n) => n.toUpperCase());

// The user's field rules: 'field' / 'Section - field' / 'TYPE:field' / 'name', and (beyond KMT)
// a whole record kind, record or source mod, alone or with a field:
//   ITEM · type:ITEM          every field of that kind (with its name)
//   43392-foo.mod · id:…      every field of that record (String ID)  ·  43392-foo.mod:description
//   foo.mod · mod:foo.mod     every field of the records that mod made ·  foo.mod:ITEM:description
// Returns { rules: [[type|null, normalized key, scope|null]], warns }; scope = 'id:<sid>' / 'mod:<file>'
// (lower case); key '*' = every value field, ALL_KEY = those and the name.
const ALL_KEY = '@all';
const SID_RE = /^\d+-.+\.(mod|base)$/i;
const MODFILE_RE = /\.(mod|base)$/i;
function scopeOk(scope, sid) {
  if (!scope) return true;
  const v = scope.slice(scope.indexOf(':') + 1);
  return scope.startsWith('id:') ? (sid || '').trim().toLowerCase() === v : sourceModOf(sid) === v;
}
// 'ITEM' alone (upper case), a String ID or a mod file at the front: [scope, type, the rest] or null
function scopeHead(line) {
  let m = /^(id|mod|type)\s*:\s*(.+)$/i.exec(line);
  if (m) {
    const kind = m[1].toLowerCase();
    if (kind === 'type') {
      const rest = m[2].trim();
      // 'type:item' (any case): the kind alone
      if (!rest.includes(':') && parseTypeToken(rest) !== null) return [null, parseTypeToken(rest), ''];
      return [null, null, rest];
    }
    const i = m[2].indexOf(':');
    const head = (i < 0 ? m[2] : m[2].slice(0, i)).trim();
    return [`${kind}:${head.toLowerCase()}`, null, i < 0 ? '' : m[2].slice(i + 1).trim()];
  }
  const i = line.indexOf(':');
  const head = (i < 0 ? line : line.slice(0, i)).trim();
  const rest = i < 0 ? '' : line.slice(i + 1).trim();
  if (SID_RE.test(head)) return [`id:${head.toLowerCase()}`, null, rest];
  if (MODFILE_RE.test(head)) return [`mod:${head.toLowerCase()}`, null, rest];
  if (i < 0 && line === line.toUpperCase() && TYPE_BY_NAME.has(line.replace(/ /g, '_').toLowerCase())) return [null, parseTypeToken(line), ''];
  return null;
}

function parseFieldRules(lines) {
  const { normalizeKey } = require('./fcs');
  const rules = [];
  const warns = [];
  for (const raw0 of lines || []) {
    let line = (raw0 || '').trim();
    if (!line || line.startsWith('#')) continue;
    line = lstripChars(line, BULLETS).trim();
    if (line.startsWith('-') && !line.startsWith('--')) line = line.slice(1).trim();
    if (!line) continue;
    let rtype = null;
    let key = line;
    let bad = false;
    let scope = null;
    let whole = false; // a kind / record / mod alone: all its fields
    const sh = scopeHead(line);
    if (sh) {
      [scope, rtype, key] = sh;
      if (!key) whole = true;
    }
    const headKind = (head) => {
      const h = head.trim();
      if (h.toLowerCase() === 'base') return ['base', null];
      const t = parseTypeToken(h);
      if (t !== null) return ['type', t];
      const close = getCloseMatches(h.toUpperCase().replace(/ /g, '_'), TYPE_NAMES_UPPER, 1, 0.85);
      return close.length ? ['typo', close[0]] : ['section', null];
    };
    for (const splitter of whole ? [] : ['colon', 'dash']) {
      let head, rest;
      if (splitter === 'colon') {
        const i = key.indexOf(':');
        if (i < 0) continue;
        head = key.slice(0, i); rest = key.slice(i + 1);
      } else {
        const parts = splitOnce(key, SECTION_SEP_RE);
        if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) continue;
        [head, rest] = parts;
      }
      const [kind, val] = headKind(head);
      if (kind === 'typo') { warns.push(say(`레코드 타입 '${head.trim()}' 은(는) 없는 이름입니다 (혹시 ${val} ?): ${line}`, `There is no record type '${head.trim()}' (${val}?): ${line}`)); bad = true; break; }
      if (kind === 'type') rtype = val;
      key = rest.trim();
      // 'type:ITEM' / 'mod:foo.mod:ITEM': the kind alone
      if (kind === 'type' && !key) { whole = true; break; }
    }
    if (bad) continue;
    if (!whole && rtype === null && key === key.toUpperCase() && TYPE_BY_NAME.has(key.replace(/ /g, '_').toLowerCase()) && /^[A-Z_ ]+$/.test(key)) {
      rtype = parseTypeToken(key); // 'type:ITEM' (the prefix taken off above)
      whole = true;
    }
    if (whole) { rules.push([rtype, ALL_KEY, scope]); continue; }
    let nkey = normalizeKey(key);
    if (!nkey) { warns.push(say('필드 이름이 비어 있습니다: ', 'The field name is empty: ') + line); continue; }
    if (nkey === 'name') nkey = RECORD_NAME_KEY;
    rules.push([rtype, nkey, scope]);
  }
  return { rules, warns };
}

const CUSTOM_PREFIX_RE = /^(mod|id|type|field|text|contains)\s*:\s*(.*)$/i;

function emptyEx() { return { mods: new Set(), ids: new Set(), types: new Set(), fields: new Map(), texts: new Set(), contains: new Set() }; }
const addField = (map, [rtype, nkey, scope]) => map.set(`${rtype}\u0000${nkey}\u0000${scope}`, [rtype, nkey, scope || null]);

// The user's exclude rules (mod: id: type: field: text: contains: or guessed).
function parseExcludeRules(lines) {
  const rules = emptyEx();
  const warns = [];
  for (const raw0 of lines || []) {
    let line = (raw0 || '').trim();
    if (!line || line.startsWith('#')) continue;
    line = lstripChars(line, BULLETS).trim();
    if (!line) continue;
    const m = CUSTOM_PREFIX_RE.exec(line);
    let kind = m ? m[1].toLowerCase() : null;
    let val = m ? m[2].trim() : line;
    if (!val) { warns.push(say('값이 비어 있습니다: ', 'The value is empty: ') + line); continue; }
    // 'id:43392-foo.mod:description', 'mod:foo.mod:ITEM:name', 'type:ITEM:description': a field rule
    if ((kind === 'id' || kind === 'mod') && val.includes(':')) { val = `${kind}:${val}`; kind = 'field'; }
    else if (kind === 'type' && val.includes(':')) kind = 'field';
    if (kind === null && val.includes(':') && (SID_RE.test(val.slice(0, val.indexOf(':')).trim()) || MODFILE_RE.test(val.slice(0, val.indexOf(':')).trim()))) kind = 'field';
    if (kind === null) {
      if (/^\d+-/.test(val)) kind = 'id';
      else if (val.toLowerCase().endsWith('.mod') || val.toLowerCase().endsWith('.base')) kind = 'mod';
      else if (val === val.toUpperCase() && TYPE_BY_NAME.has(val.replace(/ /g, '_').toLowerCase())) kind = 'type';
      else {
        let head = null;
        if (val.includes(':')) head = val.split(':', 1)[0];
        else {
          const parts = splitOnce(val, SECTION_SEP_RE);
          if (parts.length === 2 && parts[0].trim() && parts[1].trim()) head = parts[0];
        }
        kind = head !== null && (head.trim().toLowerCase() === 'base' || parseTypeToken(head) !== null) ? 'field' : 'text';
      }
    }
    if (kind === 'text' && val.includes('=')) {
      val = val.slice(0, val.indexOf('=')).trim();
      if (!val) { warns.push(say('값이 비어 있습니다: ', 'The value is empty: ') + line); continue; }
    }
    if (kind === 'mod') rules.mods.add(val.toLowerCase());
    else if (kind === 'id') rules.ids.add(val.toLowerCase());
    else if (kind === 'type') {
      const t = parseTypeToken(val);
      if (t === null) {
        const close = getCloseMatches(val.toUpperCase().replace(/ /g, '_'), TYPE_NAMES_UPPER, 1, 0.7);
        warns.push(say(`알 수 없는 레코드 타입${close.length ? ` (혹시 ${close[0]} ?)` : ''}: ${line}`, `Unknown record type${close.length ? ` (${close[0]}?)` : ''}: ${line}`));
        continue;
      }
      rules.types.add(t);
    } else if (kind === 'field') {
      const fr = parseFieldRules([val]);
      if (fr.warns.length || !fr.rules.length) { warns.push(...(fr.warns.length ? fr.warns : [say('필드 이름이 비어 있습니다: ', 'The field name is empty: ') + line])); continue; }
      for (const r of fr.rules) addField(rules.fields, r);
    } else if (kind === 'text') rules.texts.add(val.replace(/\\n/g, '\n').trim().toLowerCase());
    else rules.contains.add(val.replace(/\\n/g, '\n').toLowerCase());
  }
  return { rules, warns };
}

function validateCustom(custom) {
  return [...parseFieldRules((custom || {}).fields).warns, ...parseExcludeRules((custom || {}).exclude).warns];
}

// settings -> { fieldRules, ex, warns }
function buildRules(settings) {
  const custom = settings.custom || {};
  let fieldRules = [];
  const warns = [];
  if (custom.fields_on !== false) {
    const r = parseFieldRules(custom.fields);
    fieldRules = r.rules;
    warns.push(...r.warns);
    if (settings._rulesOverride) fieldRules = settings._rulesOverride;
  }
  const ex = emptyEx();
  for (const [k, v] of Object.entries(settings.exclude || {})) if (v) ex.mods.add(k);
  if (custom.exclude_on !== false) {
    const r = parseExcludeRules(custom.exclude);
    warns.push(...r.warns);
    for (const k of ['mods', 'ids', 'types', 'texts', 'contains']) for (const x of r.rules[k]) ex[k].add(x);
    for (const [k, v] of r.rules.fields) ex.fields.set(k, v);
  }
  return { fieldRules, ex, warns };
}

function customFieldMatch(sp, fieldRules) {
  for (const [rtype, nkey, scope] of fieldRules) {
    if (rtype !== null && sp.rec.type !== rtype) continue;
    if (scope && !scopeOk(scope, sp.sid)) continue;
    if (nkey === ALL_KEY) return true;
    if (sp.raw === null) { if (nkey === RECORD_NAME_KEY) return true; }
    else if (nkey === '*' || sp.key === nkey) return true;
  }
  return false;
}

const EXCLUDE_REASON_NAMES = { mod: '출처 모드', id: 'String ID', type: '레코드 타입', field: '필드', text: '원문 일치', contains: '원문 포함' };
const EXCLUDE_REASON_NAMES_EN = { mod: 'source mod', id: 'String ID', type: 'record type', field: 'field', text: 'same text', contains: 'text contains' };

function exclusionReason(sp, ex) {
  if (ex.mods.has(sourceModOf(sp.sid))) return 'mod';
  if (ex.ids.has((sp.sid || '').trim().toLowerCase())) return 'id';
  if (ex.types.has(sp.rec.type)) return 'type';
  if (ex.fields.size) {
    const fkey = sp.raw === null ? RECORD_NAME_KEY : sp.key;
    for (const [rtype, nkey, scope] of ex.fields.values()) {
      if ((rtype === null || rtype === sp.rec.type) && scopeOk(scope, sp.sid) && (nkey === ALL_KEY || (nkey === '*' && sp.raw !== null) || nkey === fkey)) return 'field';
    }
  }
  const low = sp.text.replace(/\r\n/g, '\n').trim().toLowerCase();
  if (ex.texts.has(low)) return 'text';
  for (const c of ex.contains) if (low.includes(c)) return 'contains';
  return null;
}

function collectKeyTypes(spans, numerics) {
  const kt = new Map();
  const add = (k, t) => { if (!kt.has(k)) kt.set(k, new Set()); kt.get(k).add(t); };
  for (const sp of spans || []) add(sp.raw === null ? RECORD_NAME_KEY : sp.key, sp.rec.type);
  for (const nf of numerics || []) add(nf.key, nf.rec.type);
  return kt;
}
const shownKey = (k) => (k === RECORD_NAME_KEY ? 'name' : k);
const sortedTypes = (types) => [...types].sort((a, b) => a - b).map(typeName).join(', ');

// 'TYPE:field' whose type has no such field but other types do: drop the type limit.
function applyRuleFallback(settings, spans, numerics, log) {
  const custom = (settings || {}).custom || {};
  if (custom.fields_on === false) return settings;
  const { rules } = parseFieldRules(custom.fields);
  const kt = collectKeyTypes(spans, numerics);
  let changed = false;
  const out = rules.map(([rtype, nkey, scope]) => {
    const types = kt.get(nkey);
    if (rtype !== null && nkey !== '*' && nkey !== ALL_KEY && types && !types.has(rtype)) {
      if (log) log(say(`[안내] '${typeName(rtype)}:${shownKey(nkey)}' - ${typeName(rtype)} 레코드에는 이 필드가 없어 타입 제한을 풀고 [${sortedTypes(types)}] 에서 찾습니다.`, `[Note] '${typeName(rtype)}:${shownKey(nkey)}' - ${typeName(rtype)} records have no such field, so the type is dropped and it is looked for in [${sortedTypes(types)}].`));
      changed = true;
      return [null, nkey, scope];
    }
    return [rtype, nkey, scope];
  });
  return changed ? { ...settings, _rulesOverride: out } : settings;
}

function logExcluded(log, label, settings, offFields, exIds, exCounts) {
  const n = Object.values(exCounts).reduce((a, b) => a + b, 0);
  const detail = Object.entries(exCounts).map(([k, v]) => say(`${EXCLUDE_REASON_NAMES[k]} ${v}곳`, `${EXCLUDE_REASON_NAMES_EN[k]} ${v}`)).join(', ');
  log(say(`영역 해제로 제외: ${offFields}곳 / ${label} 규칙으로 제외: ${exIds.size}개 레코드(${n}곳)${detail ? ` [${detail}]` : ''}`, `Left out (fields off): ${offFields} / by the ${label} rules: ${exIds.size} records (${n})${detail ? ` [${detail}]` : ''}`));
}
const onCount = (o) => Object.values(o).filter(Boolean).length;
const onExcludes = (settings) => EXCLUDE_DEFS.filter(([k]) => settings.exclude[k]).map((d) => d[1]).join(', ') || say('없음', 'none');

// The strings to translate (file order).
function selectTargets(spans, settings0, log) {
  const fields = settings0.fields;
  const langs = selectedLangs(settings0);
  const settings = applyRuleFallback(settings0, spans, null, log);
  const { fieldRules, ex, warns } = buildRules(settings);
  const targets = [];
  let offFields = 0, langOff = 0, customHits = 0;
  const exCounts = {};
  const exIds = new Set();
  for (const sp of spans) {
    const builtinOn = sp.fid !== 'custom' && !!fields[sp.fid];
    const customOn = !builtinOn && fieldRules.length > 0 && customFieldMatch(sp, fieldRules);
    if (!(builtinOn || customOn)) {
      if (sp.fid !== 'custom' && isTranslatable(sp.text, langs)) offFields++;
      continue;
    }
    if (!isTranslatable(sp.text, langs)) {
      if (isTranslatable(sp.text, ALL_LANGS)) langOff++;
      continue;
    }
    const reason = exclusionReason(sp, ex);
    if (reason) { exCounts[reason] = (exCounts[reason] || 0) + 1; exIds.add(sp.sid); continue; }
    if (customOn) customHits++;
    targets.push(sp);
  }
  if (log) {
    for (const w of warns) log(say('[경고] 사용자 지정 입력을 인식하지 못해 무시합니다: ', "[Warning] A custom line wasn't understood and is skipped: ") + w);
    log(say(`작업 설정: 번역 영역 ${onCount(fields)}/${Object.keys(fields).length}, 제외 String ID [${onExcludes(settings)}]`, `Work settings: translation fields ${onCount(fields)}/${Object.keys(fields).length}, excluded String IDs [${onExcludes(settings)}]`));
    log(say(`감지 언어: ${langNames(langs)} / 언어 선택으로 제외: ${langOff}곳`, `Languages: ${langNames(langs)} / left out by language: ${langOff}`));
    if (fieldRules.length || customHits) log(say(`사용자 지정 번역 영역: 규칙 ${fieldRules.length}개 / 추가 대상 ${customHits}곳`, `Custom translation fields: ${fieldRules.length} rules / ${customHits} more places`));
    logExcluded(log, say('번역 제외', 'translation exclusion'), settings, offFields, exIds, exCounts);
  }
  return targets.sort((a, b) => a.start - b.start);
}

// The strings to copy into a _Patch (no translating, no language filter).
function selectCopyTargets(spans, settings, log) {
  const fields = settings.fields;
  const { fieldRules, ex, warns } = buildRules(settings);
  const targets = [];
  let offFields = 0, customHits = 0;
  const exCounts = {};
  const exIds = new Set();
  for (const sp of spans) {
    const hasValue = !!(sp.text && sp.text.trim());
    const builtinOn = sp.fid !== 'custom' && !!fields[sp.fid];
    const customOn = !builtinOn && fieldRules.length > 0 && customFieldMatch(sp, fieldRules);
    if (!(builtinOn || customOn)) { if (sp.fid !== 'custom' && hasValue) offFields++; continue; }
    if (!hasValue) continue;
    const reason = exclusionReason(sp, ex);
    if (reason) { exCounts[reason] = (exCounts[reason] || 0) + 1; exIds.add(sp.sid); continue; }
    if (customOn) customHits++;
    targets.push(sp);
  }
  if (log) {
    for (const w of warns) log(say('[경고] 사용자 지정 입력을 인식하지 못해 무시합니다: ', "[Warning] A custom line wasn't understood and is skipped: ") + w);
    log(say(`패치 설정: 복사 영역 ${onCount(fields)}/${Object.keys(fields).length}, 복사 제외 String ID [${onExcludes(settings)}]`, `Patch settings: copy fields ${onCount(fields)}/${Object.keys(fields).length}, excluded String IDs [${onExcludes(settings)}]`));
    if (fieldRules.length || customHits) log(say(`사용자 지정 복사 영역: 규칙 ${fieldRules.length}개 / 추가 대상 ${customHits}곳`, `Custom copy fields: ${fieldRules.length} rules / ${customHits} more places`));
    logExcluded(log, say('복사 제외', 'copy exclusion'), settings, offFields, exIds, exCounts);
  }
  return targets.sort((a, b) => a.start - b.start);
}

// Python's str(value) for a number field (used by the text: / contains: exclude rules)
function pyStr(kind, v) {
  const f = (x) => {
    if (Number.isInteger(x)) return x.toFixed(1);
    if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
    let s = String(x);
    if (/e/.test(s)) s = s.replace(/e([+-])(\d)$/, 'e$10$2');
    return s;
  };
  if (kind === 'float') return f(v);
  if (kind === 'vec3' || kind === 'quat') return `(${v.map(f).join(', ')})`;
  return String(v);
}

// Number / true-false fields matched by the user's own copy rules.
function selectCopyNumeric(numerics, settings, log) {
  const { fieldRules, ex } = buildRules(settings);
  if (!fieldRules.length || !numerics || !numerics.length) return [];
  const out = [];
  let excluded = 0;
  for (const nf of numerics) {
    if (!fieldRules.some(([rtype, nkey, scope]) => (nkey === '*' || nkey === ALL_KEY || nf.key === nkey) && (rtype === null || nf.rec.type === rtype) && scopeOk(scope, nf.sid))) continue;
    const pseudo = { start: nf.start, end: nf.start, text: pyStr(nf.kind, nf.value), fid: 'custom', sid: nf.sid, key: nf.key, raw: nf.raw, rec: nf.rec };
    if (exclusionReason(pseudo, ex)) { excluded++; continue; }
    out.push(nf);
  }
  if (log) log(say(`사용자 지정 복사 영역(숫자/참거짓 필드): 대상 ${out.length}곳 / 복사 제외 규칙으로 제외 ${excluded}곳`, `Custom copy fields (number / true-false fields): ${out.length} places / ${excluded} left out by the copy exclusions`));
  return out.sort((a, b) => a.start - b.start);
}

// Copy rules with no matching field in this mod: say why.
function reportUnmatchedRules(settings, spans, numerics, log) {
  const { fieldRules } = buildRules(settings);
  if (!fieldRules.length) return;
  const allKt = collectKeyTypes(spans, numerics);
  for (const [rtype, nkey, scope] of fieldRules) {
    const where = scope ? `${scope.startsWith('id:') ? 'String ID' : say('모드', 'mod')} ${scope.slice(scope.indexOf(':') + 1)}` : '';
    let kt = allKt;
    if (scope) {
      kt = collectKeyTypes((spans || []).filter((sp) => scopeOk(scope, sp.sid)), (numerics || []).filter((nf) => scopeOk(scope, nf.sid)));
      if (!kt.size) { log(say(`[안내] 규칙의 ${where} 에 해당하는 레코드가 이 모드에 없습니다.`, `[Note] This mod has no records for the rule's ${where}.`)); continue; }
    }
    let types = kt.get(nkey) || new Set();
    if (nkey === '*' || nkey === ALL_KEY) { types = new Set(); for (const s of kt.values()) for (const t of s) types.add(t); }
    if (types.size && (rtype === null || types.has(rtype))) continue;
    const label = (where ? `${where} → ` : '') + (nkey === ALL_KEY ? (rtype === null ? say('(전체)', '(all)') : typeName(rtype)) : rtype === null ? shownKey(nkey) : `${typeName(rtype)}:${shownKey(nkey)}`);
    if (types.size) {
      log(say(`[안내] 규칙 '${label}' 에 맞는 필드가 없습니다. 이 모드에서 '${shownKey(nkey)}' 은(는) [${sortedTypes(types)}] 레코드에 있습니다. ':' 앞에는 FCS 화면의 섹션 이름이 아니라 레코드 타입을 써야 하며, 타입 없이 '${shownKey(nkey)}' 만 쓰면 모든 레코드에 적용됩니다.`,
        `[Note] No fields match the rule '${label}'. In this mod '${shownKey(nkey)}' is in [${sortedTypes(types)}] records. Before ':' write a record type, not a section name of the FCS screen; '${shownKey(nkey)}' alone applies to every record.`));
    } else {
      const { cmpStr } = require('./fcs');
      const cands = [...kt.keys()].map(shownKey).sort(cmpStr);
      const close = getCloseMatches(shownKey(nkey), cands, 5, 0.6);
      if (close.length) log(say(`[안내] 규칙 '${label}' 에 맞는 필드가 없습니다. 비슷한 필드 이름: ${close.join(', ')}`, `[Note] No fields match the rule '${label}'. Similar field names: ${close.join(', ')}`));
      else log(say(`[안내] 규칙 '${label}' 에 맞는 필드가 이 모드에 없습니다. 이 모드의 필드 이름(일부): ${cands.slice(0, 40).join(', ')}`, `[Note] This mod has no fields for the rule '${label}'. Some of its field names: ${cands.slice(0, 40).join(', ')}`));
    }
  }
}

function hasAnyField(settings) {
  if (Object.values(settings.fields).some(Boolean)) return true;
  const c = settings.custom || {};
  return c.fields_on !== false && parseFieldRules(c.fields).rules.length > 0;
}

function summary(s, patch) {
  const fOn = onCount(s.fields), fAll = Object.keys(s.fields).length;
  const eOn = onCount(s.exclude), eAll = Object.keys(s.exclude).length;
  let text = patch ? `복사 영역 ${fOn}/${fAll} 적용 · 복사 제외 ${eOn}/${eAll} 적용` : `번역 영역 ${fOn}/${fAll} 적용 · 번역 제외 ${eOn}/${eAll} 적용`;
  const c = s.custom || {};
  const nf = c.fields_on !== false ? parseFieldRules(c.fields).rules.length : 0;
  const exr = c.exclude_on !== false ? parseExcludeRules(c.exclude).rules : null;
  const ne = exr ? exr.mods.size + exr.ids.size + exr.types.size + exr.fields.size + exr.texts.size + exr.contains.size : 0;
  if (nf || ne) text += ` · 사용자 지정 영역 ${nf} / 제외 ${ne}`;
  if (!patch) {
    const langs = selectedLangs(s);
    text += ' · 감지 언어 ' + (LANG_DEFS.filter(([k]) => langs.has(k)).map((d) => d[2]).join('·') || '없음');
  }
  return text;
}

// The same counts for the translator window, which writes them in its own language.
function summaryData(s, patch) {
  const c = s.custom || {};
  const exr = c.exclude_on !== false ? parseExcludeRules(c.exclude).rules : null;
  const langs = patch ? [] : (() => { const l = selectedLangs(s); return LANG_DEFS.filter(([k]) => l.has(k)).map((d) => d[0]); })();
  return {
    fOn: onCount(s.fields), fAll: Object.keys(s.fields).length,
    eOn: onCount(s.exclude), eAll: Object.keys(s.exclude).length,
    nf: c.fields_on !== false ? parseFieldRules(c.fields).rules.length : 0,
    ne: exr ? exr.mods.size + exr.ids.size + exr.types.size + exr.fields.size + exr.texts.size + exr.contains.size : 0,
    langs,
  };
}

module.exports = {
  TYPE_NAMES, typeName, FIELD_GROUPS, EXCLUDE_DEFS, LANG_DEFS, ALL_LANGS, DEFAULT_LANGS, RECORD_NAME_KEY, EXCLUDE_REASON_NAMES,
  defaultSettings, defaultPatchSettings, mergeSettings, cleanLines, selectedLangs, langNames, langMatch, hasHangul, textsEqual,
  TARGETS, targetOf, patchSuffix, targetFromLang, defaultLangsFor, swapLangs, isTargetText,
  isTranslatable, sourceModOf, parseTypeToken, parseFieldRules, parseExcludeRules, validateCustom, buildRules,
  customFieldMatch, exclusionReason, applyRuleFallback, selectTargets, selectCopyTargets, selectCopyNumeric,
  reportUnmatchedRules, hasAnyField, summary, summaryData, BUILDING_TYPE,
};
