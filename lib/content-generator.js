const crypto = require('crypto');

// Deterministic selection based on page slug
function seededIndex(slug, arrayLen, salt = '') {
  const hash = crypto.createHash('md5').update(slug + salt).digest();
  return hash.readUInt32BE(0) % arrayLen;
}

function pick(slug, arr, salt = '') {
  if (!arr || arr.length === 0) return '';
  return arr[seededIndex(slug, arr.length, salt)];
}

function pickN(slug, arr, n, salt = '') {
  if (!arr || arr.length === 0) return [];
  const result = [];
  const used = new Set();
  for (let i = 0; i < Math.min(n, arr.length); i++) {
    let idx = seededIndex(slug, arr.length, salt + i);
    let attempts = 0;
    while (used.has(idx) && attempts < arr.length) {
      idx = (idx + 1) % arr.length;
      attempts++;
    }
    used.add(idx);
    result.push(arr[idx]);
  }
  return result;
}

function fillTokens(template, ctx) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => ctx[key] || '');
}

module.exports = { pick, pickN, fillTokens, seededIndex };
