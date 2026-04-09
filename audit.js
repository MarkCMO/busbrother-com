const fs = require('fs');
const path = require('path');

const dist = './dist';
let errors = [];
let pageCount = 0;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp);
    else if (e.name === 'index.html') {
      pageCount++;
      const html = fs.readFileSync(fp, 'utf8');
      const rel = '/' + path.relative(dist, path.dirname(fp)).replace(/\\/g, '/');

      // Check canonical exists
      const canon = html.match(/rel="canonical" href="([^"]*)"/);
      if (!canon) { errors.push(rel + ': MISSING CANONICAL'); return; }
      const cu = canon[1];

      // Check canonical has trailing slash and no double slashes
      if (!cu.endsWith('/')) errors.push(rel + ': CANONICAL MISSING TRAILING SLASH: ' + cu);
      if (cu.replace('https://', '').includes('//')) errors.push(rel + ': DOUBLE SLASH in canonical: ' + cu);

      // Check canonical matches page URL
      const normRel = rel === '/.' ? '' : rel;
      const expected = 'https://busbrother.com' + normRel + '/';
      if (cu !== expected) {
        errors.push(rel + ': CANONICAL MISMATCH - got ' + cu + ' expected ' + expected);
      }

      // Check title exists and is non-empty
      const title = html.match(/<title>([^<]*)<\/title>/);
      if (!title || !title[1].trim()) errors.push(rel + ': MISSING TITLE');

      // Check meta description exists
      const desc = html.match(/name="description" content="([^"]*)"/);
      if (!desc || !desc[1].trim()) errors.push(rel + ': MISSING META DESCRIPTION');

      // Check for noindex
      if (html.includes('noindex')) errors.push(rel + ': HAS NOINDEX TAG');

      // Check for soft 404 (too short)
      if (html.length < 500) errors.push(rel + ': PAGE TOO SHORT (' + html.length + ' bytes) - SOFT 404 RISK');
    }
  }
}

walk(dist);

// Check sitemap URLs match real pages
const sitemapFiles = fs.readdirSync(dist).filter(f => f.startsWith('sitemap-') && f.endsWith('.xml'));
let sitemapUrls = 0;
let missingPages = [];
for (const sf of sitemapFiles) {
  const xml = fs.readFileSync(path.join(dist, sf), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  for (const m of locs) {
    sitemapUrls++;
    const url = m[1].replace('https://busbrother.com', '');
    if (url === '/') continue;
    const cleanUrl = url.replace(/\/$/, '');
    const pagePath = path.join(dist, cleanUrl, 'index.html');
    if (!fs.existsSync(pagePath)) {
      missingPages.push(url);
    }
  }
}
if (missingPages.length > 0) {
  errors.push('SITEMAP: ' + missingPages.length + ' URLs with no matching page');
  missingPages.slice(0, 10).forEach(u => errors.push('  MISSING: ' + u));
}

// Check robots.txt
const robots = fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8');
if (robots.match(/Disallow:\s+\/[^\n]/)) errors.push('ROBOTS.TXT: Contains path Disallow rules that may block pages');

// Check for redirect loops in netlify.toml
const toml = fs.readFileSync('./netlify.toml', 'utf8');
const fromTos = [...toml.matchAll(/from\s*=\s*"([^"]*)"\s*\n\s*to\s*=\s*"([^"]*)"/g)];
for (const [, from, to] of fromTos) {
  if (from === to) errors.push('REDIRECT LOOP: ' + from + ' -> ' + to);
}

console.log('=== SEO AUDIT RESULTS ===');
console.log('Pages scanned: ' + pageCount);
console.log('Sitemap URLs: ' + sitemapUrls);
console.log('Errors found: ' + errors.length);
if (errors.length > 0) {
  console.log('\nERRORS:');
  errors.slice(0, 30).forEach(e => console.log('  - ' + e));
  if (errors.length > 30) console.log('  ... and ' + (errors.length - 30) + ' more');
} else {
  console.log('\n*** ZERO ERRORS - ALL PAGES CLEAN ***');
}
