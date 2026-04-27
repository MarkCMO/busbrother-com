// Audit sitemap URLs vs built files in dist/
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const SITEMAPS = fs.readdirSync(DIST).filter(f => /^sitemap-.*\.xml$/.test(f));
const urls = new Set();

for (const f of SITEMAPS) {
  const xml = fs.readFileSync(path.join(DIST, f), 'utf8');
  const matches = xml.match(/<loc>https:\/\/busbrother\.com[^<]+<\/loc>/g) || [];
  for (const m of matches) {
    const u = m.replace(/<loc>https:\/\/busbrother\.com/, '').replace(/<\/loc>/, '');
    urls.add(u);
  }
}

const missing = [];
for (const url of urls) {
  let clean = url.replace(/\/$/, '');
  if (!clean) { clean = '/'; }
  let fp = clean === '/' ? path.join(DIST, 'index.html') : path.join(DIST, clean, 'index.html');
  let alt = path.join(DIST, clean + '.html');
  if (!fs.existsSync(fp) && !fs.existsSync(alt)) {
    missing.push(url);
  }
}

console.log(`Total URLs: ${urls.size}`);
console.log(`Missing: ${missing.length}`);
if (missing.length) {
  fs.writeFileSync(path.join(__dirname, '..', 'missing-urls.txt'), missing.join('\n'));
  console.log('First 50 missing:');
  missing.slice(0, 50).forEach(u => console.log('  ' + u));
  // Group by prefix to see patterns
  const buckets = {};
  for (const u of missing) {
    const parts = u.split('/').filter(Boolean);
    const key = parts[0] || '/';
    buckets[key] = (buckets[key] || 0) + 1;
  }
  console.log('\nGrouped by top-level path:');
  Object.entries(buckets).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  /${k}/ : ${v}`));
}
