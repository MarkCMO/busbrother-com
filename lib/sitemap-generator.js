const fs = require('fs');
const path = require('path');

const DOMAIN = 'https://busbrother.com';

function generateSitemapIndex(sitemaps, distDir) {
  const entries = sitemaps.map(s =>
    `  <sitemap>\n    <loc>${DOMAIN}/${s}</loc>\n    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n  </sitemap>`
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`;
  fs.writeFileSync(path.join(distDir, 'sitemap.xml'), xml);
}

function generateSubSitemap(name, urls, distDir) {
  const today = new Date().toISOString().split('T')[0];
  const entries = urls.map(u =>
    `  <url>\n    <loc>${DOMAIN}${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.freq || 'weekly'}</changefreq>\n    <priority>${u.priority || '0.5'}</priority>\n  </url>`
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
  const filename = `sitemap-${name}.xml`;
  fs.writeFileSync(path.join(distDir, filename), xml);
  return filename;
}

function generateRobots(distDir) {
  const txt = `User-agent: *\nAllow: /\n\nSitemap: ${DOMAIN}/sitemap.xml\n`;
  fs.writeFileSync(path.join(distDir, 'robots.txt'), txt);
}

module.exports = { generateSitemapIndex, generateSubSitemap, generateRobots };
