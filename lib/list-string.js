// A mod list file as one string to paste anywhere: 'BEEP1:' + Base85(zlib(the file's bytes)).
// zlib is Node's own (the format of Python's zlib.compress); Base85 is the alphabet and the
// padding of Python's base64.b85encode / b85decode (RFC 1924 letters), so either side reads
// the other's strings. The bytes come back exactly as they went in. Each manager has its own
// prefix (Kenshi BEEP1:, ARK DODO1:, Factorio BITER1:); a string of another one is named, not read.
const zlib = require('zlib');

const PREFIX = 'BEEP1:';
// every manager's prefix -> its game (the same table in all three)
const GAMES = { 'BEEP1:': 'Kenshi', 'DODO1:': 'ARK', 'BITER1:': 'Factorio' };
const B85 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';
const B85_AT = new Map([...B85].map((c, i) => [c, i]));

class ListStringError extends Error { constructor(code, game = '') { super(code); this.code = code; this.game = game; } }

// As Python's b85encode(data) (pad=False): 4 bytes -> 5 letters, the last group cut short.
function b85encode(buf) {
  const pad = (4 - (buf.length % 4)) % 4;
  const b = pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf;
  let out = '';
  for (let i = 0; i < b.length; i += 4) {
    let v = b.readUInt32BE(i);
    const c = new Array(5);
    for (let j = 4; j >= 0; j--) { c[j] = B85[v % 85]; v = Math.floor(v / 85); }
    out += c.join('');
  }
  return pad ? out.slice(0, out.length - pad) : out;
}

// As Python's b85decode: the last group filled with '~'; a letter outside the alphabet or a
// group over 32 bits is an error ('chars').
function b85decode(str) {
  const pad = (5 - (str.length % 5)) % 5;
  const s = str + '~'.repeat(pad);
  const out = Buffer.alloc((s.length / 5) * 4);
  for (let i = 0, o = 0; i < s.length; i += 5, o += 4) {
    let v = 0;
    for (let j = 0; j < 5; j++) {
      const d = B85_AT.get(s[i + j]);
      if (d === undefined) throw new ListStringError('chars');
      v = v * 85 + d;
    }
    if (v > 0xffffffff) throw new ListStringError('chars');
    out.writeUInt32BE(v, o);
  }
  return pad ? out.subarray(0, out.length - pad) : out;
}

// What was pasted: a code block's ``` around it and any spaces / line breaks inside go.
function clean(text) {
  let s = String(text || '').replace(/^﻿/, '').trim();
  s = s.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
  return s.replace(/\s+/g, '');
}
// another manager's string -> its game ('' when it isn't one)
const otherGame = (s) => Object.entries(GAMES).find(([p]) => p !== PREFIX && s.startsWith(p))?.[1] || '';
// this app's string, or another manager's (so that one is named instead of read as a list)
const looksLike = (text) => { const s = clean(text); return s.startsWith(PREFIX) || !!otherGame(s); };

function encode(bytes) {
  return PREFIX + b85encode(zlib.deflateSync(Buffer.from(bytes), { level: 9 }));
}

// -> the file's bytes; ListStringError code 'other' (with its game) / 'prefix' / 'chars' / 'zlib'
function decode(text) {
  const s = clean(text);
  if (!s.startsWith(PREFIX)) { const g = otherGame(s); throw new ListStringError(g ? 'other' : 'prefix', g); }
  const data = b85decode(s.slice(PREFIX.length));
  try { return zlib.inflateSync(data); } catch { throw new ListStringError('zlib'); }
}

module.exports = { PREFIX, encode, decode, looksLike, clean, b85encode, b85decode, ListStringError };
