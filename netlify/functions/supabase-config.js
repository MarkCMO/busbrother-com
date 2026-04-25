/**
 * Shared Supabase config for BusBrother Netlify functions
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

async function supabaseQuery(path, method = 'GET', body = null) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : undefined
  };
  Object.keys(headers).forEach(k => headers[k] === undefined && delete headers[k]);

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  let data = [];
  try { const text = await res.text(); if (text) data = JSON.parse(text); } catch(e) {}
  return { ok: res.ok, status: res.status, data };
}

function ok(data) { return { statusCode: 200, headers: CORS, body: JSON.stringify(data) }; }
function err(msg, code = 400) { return { statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) }; }
function options() { return { statusCode: 204, headers: CORS, body: '' }; }

module.exports = { SUPABASE_URL, SUPABASE_KEY, CORS, supabaseQuery, ok, err, options };
