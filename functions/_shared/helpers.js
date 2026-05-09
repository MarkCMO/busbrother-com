// Shared helpers for Cloudflare Pages Functions (BusBrother)
// All Pages Functions receive { request, env, params, waitUntil } context.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, ...headers } });

export const errResponse = (msg, status = 400) =>
  json({ error: msg }, status);

export const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=utf-8' } });

export const optionsResponse = () => new Response(null, { status: 204, headers: CORS });

export async function supabase(env, path, method = 'GET', body = null) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, status: 500, data: null, error: 'Supabase not configured' };
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
  if (method === 'POST' || method === 'PATCH') headers['Prefer'] = 'return=representation';
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${url}/rest/v1/${path}`, opts);
  let data = null;
  try { const text = await res.text(); if (text) data = JSON.parse(text); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

export async function sendEmail(env, { to, subject, html: body, replyTo }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const from = env.BUSBROTHER_FROM_EMAIL || 'BusBrother <onboarding@resend.dev>';
  const payload = { from, to: Array.isArray(to) ? to : [to], subject, html: body };
  if (replyTo) payload.reply_to = replyTo;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { ok: res.ok, status: res.status };
}

export function generateToken(len = 24) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) token += chars[bytes[i] % chars.length];
  return token;
}

export function adminOk(url, env) {
  const secret = url.searchParams.get('secret');
  return secret && env.BUSBROTHER_ADMIN_SECRET && secret === env.BUSBROTHER_ADMIN_SECRET;
}

export const SERVICE_LABELS = {
  cruise: 'Cruise Port Shuttle', ksc: 'Kennedy Space Center', airport: 'Airport Transfer',
  rocket: 'Rocket Launch Viewing', corporate: 'Corporate Charter', wedding: 'Wedding/Event',
  school: 'School Group', themepark: 'Theme Parks', hotel: 'Hotel Shuttle', sports: 'Sports Event'
};

export function adminPage(title, message, color = 'green') {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title} | BusBrother</title>
<style>body{margin:0;padding:0;background:#060e1c;color:#f8f6f0;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.box{text-align:center;max-width:500px;padding:3rem;}h1{font-size:2rem;letter-spacing:3px;margin-bottom:1rem;}h1 span{color:#f5a623;}
.msg{color:#8a9ab5;font-size:1.1rem;line-height:1.6;margin-bottom:2rem;}
.btn{display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;}</style>
</head><body><div class="box">
<h1>BUS<span>BROTHER</span></h1>
<div style="font-size:4rem;margin:1rem 0;">${color === 'green' ? '&#10003;' : '&#10007;'}</div>
<p class="msg">${message}</p>
<a href="https://busbrother.com/admin/jobs/" class="btn">Open Dashboard</a>
</div></body></html>`;
}
