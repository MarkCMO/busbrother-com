// One-shot favicon generator: SVG -> multi-size PNGs + webmanifest
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const STATIC = path.join(__dirname, '..', 'static');
const SVG = fs.readFileSync(path.join(STATIC, 'favicon.svg'));

const sizes = [
  { name: 'favicon-16.png', size: 16 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 }
];

(async () => {
  for (const s of sizes) {
    await sharp(SVG).resize(s.size, s.size).png().toFile(path.join(STATIC, s.name));
    console.log('✓', s.name);
  }
  const manifest = {
    name: 'BusBrother',
    short_name: 'BusBrother',
    description: 'Charter Bus & Group Transportation - Central Florida',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a1628',
    theme_color: '#0a1628',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }
    ]
  };
  fs.writeFileSync(path.join(STATIC, 'site.webmanifest'), JSON.stringify(manifest, null, 2));
  console.log('✓ site.webmanifest');
})();
