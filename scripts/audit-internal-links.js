// Find broken internal links in dist/
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir)) {
    const fp = path.join(dir, e);
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp, files);
    else if (e.endsWith('.html')) files.push(fp);
  }
  return files;
}

function pageExists(url) {
  // Strip query/hash
  let p = url.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) return true; // external
  if (p.includes('://')) return true;
  let clean = p.replace(/\/$/, '') || '/';
  if (clean === '/') return fs.existsSync(path.join(DIST, 'index.html'));
  // Check static asset
  if (/\.(png|jpg|jpeg|svg|webp|gif|ico|css|js|xml|txt|webmanifest|pdf)$/i.test(clean)) {
    return fs.existsSync(path.join(DIST, clean));
  }
  return fs.existsSync(path.join(DIST, clean, 'index.html')) || fs.existsSync(path.join(DIST, clean + '.html'));
}

const files = walk(DIST);
const broken = {}; // url -> count of pages linking to it

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const matches = html.match(/href="(\/[^"#]*)"/g) || [];
  const seen = new Set();
  for (const m of matches) {
    const url = m.match(/href="([^"]+)"/)[1];
    if (seen.has(url)) continue;
    seen.add(url);
    if (!pageExists(url)) {
      broken[url] = (broken[url] || 0) + 1;
    }
  }
}

const sorted = Object.entries(broken).sort((a, b) => b[1] - a[1]);
console.log(`Files scanned: ${files.length}`);
console.log(`Unique broken URLs: ${sorted.length}`);
console.log('Top 50 broken URLs (count = # pages linking to them):');
sorted.slice(0, 50).forEach(([u, c]) => console.log(`  ${c}  ${u}`));

if (sorted.length) {
  fs.writeFileSync(path.join(__dirname, '..', 'broken-links.txt'),
    sorted.map(([u, c]) => `${c}\t${u}`).join('\n'));
}
