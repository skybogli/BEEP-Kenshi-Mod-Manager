// Free Google Translate endpoints (the ones the Chrome translate extension uses).
// No API key; Google may rate-limit them, so the second endpoint is a fallback.

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0 Safari/537.36';
const CHUNK = 3000;

function post(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

// Split long text at line breaks so each piece stays under CHUNK characters.
function chunk(text) {
  const parts = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > CHUNK) {
      parts.push(cur);
      cur = '';
    }
    if (line.length > CHUNK) {
      for (let i = 0; i < line.length; i += CHUNK) parts.push(line.slice(i, i + CHUNK));
      continue;
    }
    cur = cur ? cur + '\n' + line : line;
  }
  if (cur) parts.push(cur);
  return parts;
}

// clients5: accepts many q params; returns [[text, lang], ...] with sl=auto, [text, ...] otherwise.
async function viaClients5(pieces, sl, tl) {
  const qs = new URLSearchParams({ client: 'dict-chrome-ex', sl, tl });
  const body = pieces.map((p) => 'q=' + encodeURIComponent(p)).join('&');
  const res = await post('clients5.google.com', '/translate_a/t?' + qs, body);
  return pieces.map((_, i) => {
    const item = res[i];
    return Array.isArray(item) ? { text: item[0], detected: item[1] || null } : { text: item, detected: null };
  });
}

// translate_a/single: one text per request.
async function viaSingle(pieces, sl, tl) {
  const out = [];
  for (const p of pieces) {
    const qs = new URLSearchParams({ client: 'gtx', sl, tl, dt: 't' });
    const res = await post('translate.googleapis.com', '/translate_a/single?' + qs, 'q=' + encodeURIComponent(p));
    out.push({ text: (res[0] || []).map((s) => s[0] || '').join(''), detected: res[2] || null });
  }
  return out;
}

// Translate several texts at once. Returns [{ text, detected }] in the same order,
// or throws when both endpoints fail.
async function translateTexts(texts, sl = 'auto', tl = 'ko') {
  const pieces = [];
  const owner = [];
  texts.forEach((t, i) => {
    for (const p of chunk(String(t || ''))) {
      pieces.push(p);
      owner.push(i);
    }
  });
  if (!pieces.length) return texts.map(() => ({ text: '', detected: null }));

  // Send in batches so one request body stays reasonably small.
  const results = [];
  for (let i = 0; i < pieces.length;) {
    let size = 0;
    let j = i;
    while (j < pieces.length && (j === i || size + pieces[j].length <= CHUNK * 3)) size += pieces[j++].length;
    const batch = pieces.slice(i, j);
    let res;
    try {
      res = await viaClients5(batch, sl, tl);
    } catch {
      res = await viaSingle(batch, sl, tl);
    }
    results.push(...res);
    i = j;
  }

  return texts.map((_, i) => {
    const mine = results.filter((_r, k) => owner[k] === i);
    return { text: mine.map((r) => r.text).join('\n'), detected: mine.find((r) => r.detected)?.detected || null };
  });
}

module.exports = { translateTexts };
