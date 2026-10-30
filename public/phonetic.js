// Phonetic matching for Telugu + English names.
// Both Telugu script and English (Latin) text are reduced to the same simple "sound key",
// so "Srinivasa Rao", "Sreenivas Rao" and "శ్రీనివాసరావు" all compare equal.
(function (root) {
  const CONS = {
    'క': 'k', 'ఖ': 'k', 'గ': 'g', 'ఘ': 'g', 'ఙ': 'n',
    'చ': 'c', 'ఛ': 'c', 'జ': 'j', 'ఝ': 'j', 'ఞ': 'n',
    'ట': 't', 'ఠ': 't', 'డ': 'd', 'ఢ': 'd', 'ణ': 'n',
    'త': 't', 'థ': 't', 'ద': 'd', 'ధ': 'd', 'న': 'n',
    'ప': 'p', 'ఫ': 'p', 'బ': 'b', 'భ': 'b', 'మ': 'm',
    'య': 'y', 'ర': 'r', 'ఱ': 'r', 'ల': 'l', 'ళ': 'l', 'వ': 'v',
    'శ': 's', 'ష': 's', 'స': 's', 'హ': 'h', 'ౘ': 'c', 'ౙ': 'j'
  };
  const VOW = {
    'అ': 'a', 'ఆ': 'a', 'ఇ': 'i', 'ఈ': 'i', 'ఉ': 'u', 'ఊ': 'u', 'ఋ': 'ri', 'ౠ': 'ri',
    'ఎ': 'e', 'ఏ': 'e', 'ఐ': 'ai', 'ఒ': 'o', 'ఓ': 'o', 'ఔ': 'au'
  };
  const MATRA = {
    'ా': 'a', 'ి': 'i', 'ీ': 'i', 'ు': 'u', 'ూ': 'u', 'ృ': 'ri', 'ౄ': 'ri',
    'ె': 'e', 'ే': 'e', 'ై': 'ai', 'ొ': 'o', 'ో': 'o', 'ౌ': 'au'
  };
  const VIRAMA = '్', ANUSVARA = 'ం', ARDHA = 'ఁ', VISARGA = 'ః';

  function teluguToLatin(s) {
    let out = '';
    const ch = Array.from(s.normalize('NFC'));
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (CONS[c]) {
        out += CONS[c];
        const n = ch[i + 1];
        if (n === VIRAMA) { i++; }
        else if (MATRA[n]) { out += MATRA[n]; i++; }
        else out += 'a';
      } else if (VOW[c]) out += VOW[c];
      else if (c === ANUSVARA || c === ARDHA) {
        // ం sounds like m before p/b/m and at the end, n elsewhere
        let j = i + 1; while (ch[j] === '‌' || ch[j] === '‍') j++;
        const nx = CONS[ch[j]];
        out += (!nx || 'pbm'.includes(nx)) ? 'm' : 'n';
      } else if (c === VISARGA || c === '‌' || c === '‍' || MATRA[c] || c === VIRAMA) {
        // ignore stray marks
      } else out += c.toLowerCase();
    }
    return out;
  }

  function englishRules(s) {
    // s: lowercase latin text, words separated by spaces
    return s
      .replace(/ksh/g, 'ks').replace(/x/g, 'ks')
      .replace(/ch/g, 'C').replace(/c/g, 'k').replace(/C/g, 'c')
      .replace(/sh/g, 's').replace(/kh/g, 'k').replace(/gh/g, 'g')
      .replace(/th/g, 't').replace(/dh/g, 'd').replace(/ph/g, 'p').replace(/f/g, 'p')
      .replace(/bh/g, 'b').replace(/jh/g, 'j').replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k')
      .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a')
      .replace(/aiah\b/g, 'aya').replace(/iah\b/g, 'ya').replace(/ayyah\b/g, 'aya')
      .replace(/rao\b/g, 'ravu').replace(/ah\b/g, 'a')
      .replace(/([^aeiou ])y\b/g, '$1i').replace(/ey\b/g, 'i');
  }

  function common(s) {
    return s
      .replace(/h/g, '')                // aspiration & హ are unreliable in spellings
      .replace(/ayi/g, 'ai').replace(/aiy/g, 'ay')   // సాయి = sai
      .replace(/([a-z])\1+/g, '$1')     // collapse doubles: reddy->redi, ayya->aya
      .replace(/m(?=[^aeiou ])/g, 'n')  // ం before a consonant: Bellamkonda = Bellankonda
      .replace(/[^a-z ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  const TE = /[ఀ-౿]/;
  function key(text) {
    if (!text) return '';
    text = String(text);
    if (TE.test(text)) {
      // Telugu text may contain some English (e.g. house names) - only convert the Telugu part
      const parts = text.split(/([\u0C00-\u0C7F\u200c\u200d]+)/);
      return common(parts.map(p => TE.test(p) ? teluguToLatin(p)
        : englishRules(p.toLowerCase().replace(/[^a-z ]/g, ' '))).join(''));
    }
    return common(englishRules(text.toLowerCase().replace(/[^a-z ]/g, ' ')));
  }

  // edit distance of pattern p to the best-matching substring of text t (Sellers algorithm)
  function substrDist(p, t) {
    const m = p.length, n = t.length;
    if (!m) return { d: 0, end: 0 };
    let prev = new Array(m + 1), cur = new Array(m + 1);
    for (let i = 0; i <= m; i++) prev[i] = i;
    let best = prev[m], bestEnd = 0;
    for (let j = 1; j <= n; j++) {
      cur[0] = 0;
      const tc = t.charCodeAt(j - 1);
      for (let i = 1; i <= m; i++) {
        const cost = p.charCodeAt(i - 1) === tc ? 0 : 1;
        cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + cost);
      }
      if (cur[m] < best) { best = cur[m]; bestEnd = j; }
      const tmp = prev; prev = cur; cur = tmp;
    }
    return { d: best, end: bestEnd };
  }

  function allowed(len) { return len <= 3 ? 0 : len <= 6 ? 1 : 2; }

  function queryTokens(q) {
    return key(q).split(' ').filter(Boolean).map(t => (t.length > 4 ? t.replace(/a$/, '') : t));
  }

  // score one query token against a target {flat, spaced}; returns 0..1.2 or -1 for no match
  function tokenScore(qt, tgt) {
    if (!tgt.flat) return -1;
    const r = substrDist(qt, tgt.flat);
    if (r.d > allowed(qt.length)) return -1;
    let s = 1 - r.d / (qt.length + 1);
    if ((' ' + tgt.spaced).includes(' ' + qt)) s += 0.15;      // starts a word exactly
    else if (tgt.flat.includes(qt)) s += 0.07;                    // exact somewhere
    return s;
  }

  function makeTarget(text) {
    const spaced = key(text);
    return { spaced, flat: spaced.replace(/ /g, '') };
  }

  root.Phonetic = { key, teluguToLatin, substrDist, queryTokens, tokenScore, makeTarget };
  if (typeof module !== 'undefined') module.exports = root.Phonetic;
})(typeof window !== 'undefined' ? window : globalThis);
