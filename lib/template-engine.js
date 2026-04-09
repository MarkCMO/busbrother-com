const fs = require('fs');
const path = require('path');

const PARTIALS_DIR = path.join(__dirname, '..', 'templates', 'partials');
const partialsCache = {};

function loadPartial(name) {
  if (!partialsCache[name]) {
    const fp = path.join(PARTIALS_DIR, name + '.html');
    partialsCache[name] = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
  }
  return partialsCache[name];
}

function render(template, ctx) {
  // Auto-compute canonicalUrl with trailing slash (except homepage)
  if (ctx.canonicalPath && !ctx.canonicalUrl) {
    ctx.canonicalUrl = ctx.canonicalPath === '/' ? '/' : ctx.canonicalPath + '/';
  }
  let html = template;

  // Resolve partials: {{> name}}
  html = html.replace(/\{\{>\s*(\w[\w-]*)\s*\}\}/g, (_, name) => loadPartial(name));
  // Allow nested partials (one level deep)
  html = html.replace(/\{\{>\s*(\w[\w-]*)\s*\}\}/g, (_, name) => loadPartial(name));

  // Conditionals: {{#if key}}...{{/if}} and {{#if key}}...{{else}}...{{/if}}
  html = html.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
    const val = resolveKey(ctx, key);
    const parts = body.split('{{else}}');
    if (val && (!Array.isArray(val) || val.length > 0)) return parts[0];
    return parts[1] || '';
  });

  // Loops: {{#each key}}...{{/each}}
  html = html.replace(/\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
    const arr = resolveKey(ctx, key);
    if (!Array.isArray(arr)) return '';
    return arr.map((item, i) => {
      const itemCtx = typeof item === 'object' ? { ...ctx, ...item, _index: i } : { ...ctx, _item: item, _index: i };
      return renderVars(body, itemCtx);
    }).join('');
  });

  // Variables
  html = renderVars(html, ctx);

  return html;
}

function renderVars(html, ctx) {
  return html.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const val = resolveKey(ctx, key);
    return val !== undefined && val !== null ? String(val) : '';
  });
}

function resolveKey(ctx, key) {
  const parts = key.split('.');
  let val = ctx;
  for (const p of parts) {
    if (val == null) return undefined;
    val = val[p];
  }
  return val;
}

function loadTemplate(name) {
  const fp = path.join(__dirname, '..', 'templates', 'pages', name + '.html');
  return fs.readFileSync(fp, 'utf8');
}

module.exports = { render, loadTemplate, loadPartial };
