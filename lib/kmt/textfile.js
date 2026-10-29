// Text files the translator reads and writes: UTF-8 (with or without BOM) or CP949, like KMT.
const fs = require('fs');
const { say } = require('./lang');

// Python's str.splitlines() line breaks
const LINE_BREAKS = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
const splitLines = (text) => {
  const lines = text.split(LINE_BREAKS);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
};

const utf8 = new TextDecoder('utf-8', { fatal: true });
let cp949Dec = null;
const cp949 = () => cp949Dec || (cp949Dec = new TextDecoder('euc-kr', { fatal: true }));

// bytes -> { text, enc } trying UTF-8 (BOM dropped) then CP949; throws when neither fits
function decodeText(raw) {
  try {
    let text = utf8.decode(raw);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { text, enc: 'utf-8-sig' };
  } catch { /* not UTF-8 */ }
  try {
    return { text: cp949().decode(raw), enc: 'cp949' };
  } catch { /* not CP949 either */ }
  throw new Error(say('파일 인코딩을 읽을 수 없습니다 (UTF-8 또는 CP949 필요)', "The file's encoding can't be read (UTF-8 or CP949 needed)"));
}

function readTextLines(file) {
  return splitLines(decodeText(fs.readFileSync(file)).text);
}

// CP949 encoding table, built once from the decoder.
let cp949Map = null;
function cp949Table() {
  if (cp949Map) return cp949Map;
  cp949Map = new Map();
  const dec = new TextDecoder('euc-kr');
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x41; trail <= 0xfe; trail++) {
      const ch = dec.decode(Uint8Array.of(lead, trail));
      if (ch.length === 1 && ch !== '�' && !cp949Map.has(ch)) cp949Map.set(ch, (lead << 8) | trail);
    }
  }
  return cp949Map;
}
// text -> CP949 bytes, or null when a character has no CP949 code
function encodeCp949(text) {
  const table = cp949Table();
  const out = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) { out.push(c); continue; }
    const code = table.get(ch);
    if (code === undefined) return null;
    out.push(code >> 8, code & 0xff);
  }
  return Buffer.from(out);
}

function encodeText(text, enc) {
  if (enc === 'cp949') {
    const b = encodeCp949(text);
    if (b) return b;
  }
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

// Write to a temp file, then swap it in (a cut-off write never leaves a half-written file).
function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* left behind */ }
  }
}

module.exports = { splitLines, decodeText, readTextLines, encodeText, atomicWrite };
