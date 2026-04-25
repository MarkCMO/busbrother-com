const fs = require('fs');
const path = require('path');

const DOMAIN = 'https://busbrother.com';

function generateSitemapIndex(sitemaps, distDir) {
  const entries = sitemaps.map(s =>
    `  <sitemap>\n    <loc>${DOMAIN}/${s}</loc>\n    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n  </sitemap>`
  ).join('\n');
  const llmEntry = `  <sitemap>\n    <loc>${DOMAIN}/llm-sitemap.xml</loc>\n    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n  </sitemap>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n${llmEntry}\n</sitemapindex>`;
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

function generateLlmSitemap(distDir, aiPages) {
  const today = new Date().toISOString().split('T')[0];
  const entries = aiPages.map(p =>
    `  <url>\n    <loc>${DOMAIN}${p.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.freq || 'weekly'}</changefreq>\n    <priority>${p.priority || '0.9'}</priority>\n    <ai:contentType>${p.contentType || 'authoritative-content'}</ai:contentType>\n    <ai:topics>${p.topics || 'charter bus, group transportation, Florida'}</ai:topics>\n  </url>`
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:ai="http://www.aiwebprotocol.org/schemas/ai/1.0">\n${entries}\n</urlset>`;
  fs.writeFileSync(path.join(distDir, 'llm-sitemap.xml'), xml);
}

function generateRobots(distDir) {
  const txt = `# ============================================================
# ROBOTS.TXT - BusBrother.com | Charter Bus & Group Transportation
# Last Updated: ${new Date().toISOString().split('T')[0]}
# ============================================================

# --- ALLOW ALL MAJOR SEARCH ENGINES ---
User-agent: Googlebot
Allow: /
Crawl-delay: 1

User-agent: Bingbot
Allow: /
Crawl-delay: 1

User-agent: Slurp
Allow: /

User-agent: DuckDuckBot
Allow: /

User-agent: Baiduspider
Allow: /

User-agent: YandexBot
Allow: /

# --- ALLOW ALL AI / LLM CRAWLERS (CRITICAL FOR LLM CITATIONS) ---
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Gemini-Bot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: YouBot
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: Meta-ExternalAgent
Allow: /

User-agent: Meta-ExternalFetcher
Allow: /

User-agent: FacebookBot
Allow: /

User-agent: Applebot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: DiffBot
Allow: /

User-agent: Bytespider
Allow: /

User-agent: PetalBot
Allow: /

User-agent: Timpibot
Allow: /

User-agent: PiplBot
Allow: /

User-agent: ImagesiftBot
Allow: /

# --- BLOCK COMPETITOR SEO AUDIT TOOLS ---
User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: SemrushBot-SA
Disallow: /

User-agent: MJ12bot
Disallow: /

User-agent: DotBot
Disallow: /

User-agent: BLEXBot
Disallow: /

User-agent: rogerbot
Disallow: /

User-agent: dataforseo-bot
Disallow: /

User-agent: SerpstatBot
Disallow: /

User-agent: spbot
Disallow: /

# --- DEFAULT RULES (ALL OTHER BOTS) ---
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /jobs/
Disallow: /api/
Disallow: /.netlify/
Disallow: /*.json$

# --- SITEMAP DECLARATIONS ---
Sitemap: ${DOMAIN}/sitemap.xml
Sitemap: ${DOMAIN}/llm-sitemap.xml

# --- AI CONTENT DECLARATION ---
# AI-friendly content available at:
# ${DOMAIN}/llm.txt
# ${DOMAIN}/ai.txt
# ${DOMAIN}/.well-known/llm.txt
# ${DOMAIN}/humans.txt

# ============================================================
# END ROBOTS.TXT
# ============================================================
`;
  fs.writeFileSync(path.join(distDir, 'robots.txt'), txt);
}

module.exports = { generateSitemapIndex, generateSubSitemap, generateLlmSitemap, generateRobots };
