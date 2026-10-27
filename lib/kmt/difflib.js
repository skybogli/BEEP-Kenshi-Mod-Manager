// The part of Python's difflib that KMT uses: get_close_matches (for "did you mean ...?" hints).
// Same scoring as SequenceMatcher.ratio() without junk handling (the strings are short names).

function matchingBlocks(a, b) {
  const b2j = new Map();
  for (let j = 0; j < b.length; j++) {
    if (!b2j.has(b[j])) b2j.set(b[j], []);
    b2j.get(b[j]).push(j);
  }
  const longest = (alo, ahi, blo, bhi) => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        next.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = next;
    }
    return [besti, bestj, bestsize];
  };
  const queue = [[0, a.length, 0, b.length]];
  const blocks = [];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      blocks.push([i, j, k]);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return blocks;
}

function ratio(a, b) {
  const matches = matchingBlocks(a, b).reduce((s, x) => s + x[2], 0);
  const len = a.length + b.length;
  return len ? (2 * matches) / len : 1;
}

function quickRatio(a, b) {
  const avail = new Map();
  for (const c of b) avail.set(c, (avail.get(c) || 0) + 1);
  let matches = 0;
  for (const c of a) {
    const n = avail.get(c) || 0;
    if (n > 0) { matches++; avail.set(c, n - 1); }
  }
  const len = a.length + b.length;
  return len ? (2 * matches) / len : 1;
}

function getCloseMatches(word, possibilities, n = 3, cutoff = 0.6) {
  const result = [];
  for (const x of possibilities) {
    // SequenceMatcher(None, x, word): a = x, b = word
    const lenRatio = (2 * Math.min(x.length, word.length)) / ((x.length + word.length) || 1);
    if (lenRatio >= cutoff && quickRatio(x, word) >= cutoff) {
      const r = ratio(x, word);
      if (r >= cutoff) result.push([r, x]);
    }
  }
  result.sort((p, q) => q[0] - p[0] || (q[1] > p[1] ? 1 : q[1] < p[1] ? -1 : 0));
  return result.slice(0, n).map((p) => p[1]);
}

module.exports = { getCloseMatches, ratio };
