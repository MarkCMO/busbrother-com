// functions/api/lead.js
//
// PORTABLE universal lead-capture endpoint.
//
// Drop this file into any Cloudflare Pages project at /functions/api/lead.js
// to give every form on the site a working POST target. Forms should submit
// urlencoded or JSON to /api/lead with at minimum an 'email' field.
//
// Required env vars (per CF Pages project):
//   RESEND_API_KEY    - Resend API key (mark uses one shared key)
//   NOTIFY_EMAIL      - Where lead notifications go (comma-separated)
//                       defaults to mark@markcmo.com,marklgabriellijr@gmail.com
//   LEAD_FROM         - Sender label, e.g. "Site Leads <mark@markcmo.com>"
//                       Must use a domain Mark has verified in Resend.
//                       Defaults to MarkCMO Leads <mark@markcmo.com>.
//   SITE_NAME         - Human-readable site name, e.g. "ButcherBud"
//                       Used in the email subject + branding.
//
// CORS: dynamic — echoes the request Origin header so any domain pointed at
// this project works. Falls back to '*' if no origin sent.
//
// Auto-deploys with Cloudflare Pages — no extra build step needed.

const DEFAULT_TO = 'mark@markcmo.com,marklgabriellijr@gmail.com';
const DEFAULT_FROM = 'Site Leads <mark@markcmo.com>';
const DEFAULT_SITE = 'site';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(status, body, request, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
      ...extra,
    },
  });
}

function humanize(key) {
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'POST only' }, request);
  }

  // Parse body (urlencoded / JSON / multipart / best-effort fallback)
  let fields = {};
  const ctype = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (ctype.includes('application/json')) {
      const j = await request.json();
      fields = (typeof j === 'object' && j) ? j : {};
    } else if (ctype.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(await request.text());
      for (const [k, v] of params) fields[k] = v;
    } else if (ctype.includes('multipart/form-data')) {
      const fd = await request.formData();
      for (const [k, v] of fd) fields[k] = typeof v === 'string' ? v : '[file]';
    } else {
      const text = await request.text();
      try {
        const params = new URLSearchParams(text);
        for (const [k, v] of params) fields[k] = v;
      } catch {
        try { fields = JSON.parse(text); } catch {}
      }
    }
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid body: ' + e.message }, request);
  }

  // Honeypot — silent 200 to bots
  if ((fields['bot-field'] && String(fields['bot-field']).trim()) ||
      (fields.website && String(fields.website).trim()) ||
      (fields.website_extra && String(fields.website_extra).trim())) {
    return jsonResponse(200, { ok: true }, request);
  }

  const email = String(fields.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return jsonResponse(400, { error: 'Valid email required' }, request);
  }

  const submitterName = [
    fields.first_name || fields.firstName || fields['first-name'] || fields.name || '',
    fields.last_name || fields.lastName || fields['last-name'] || '',
  ].map(s => String(s).trim()).filter(Boolean).join(' ').trim() || '(no name)';

  const inquiryType = String(fields.inquiry_type || fields.inquiryType ||
    fields['form-name'] || fields.subject || fields.topic || fields.service ||
    'contact').trim();

  const company = String(fields.company || '').trim();
  const siteName = String(env.SITE_NAME || DEFAULT_SITE);
  const subject = `[${siteName} lead] ${submitterName}${company ? ' @ ' + company : ''} · ${inquiryType}`;

  const SKIP = new Set(['bot-field', 'website', 'website_extra', 'captcha_answer', 'form-name', '_success']);
  const filtered = Object.entries(fields).filter(([k, v]) => !SKIP.has(k) && v && String(v).trim());

  const rows = filtered.map(([k, v]) => `<tr>
      <td style="padding:8px 16px 8px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap;vertical-align:top;">${esc(humanize(k))}</td>
      <td style="padding:8px 0;color:#fff;font-size:14px;line-height:1.6;">${esc(v).replace(/\n/g, '<br>')}</td>
    </tr>`).join('');

  const referer = request.headers.get('referer') || request.headers.get('referrer') || '(unknown)';
  const ua = request.headers.get('user-agent') || '(unknown)';
  const cfRay = request.headers.get('cf-ray') || '(no ray)';
  const cfCountry = request.headers.get('cf-ipcountry') || '?';
  const ip = request.headers.get('cf-connecting-ip') || '(unknown)';

  const html = `<!DOCTYPE html><html><body style="background:#0a0a0a;margin:0;padding:0;font-family:Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
      <div style="margin-bottom:20px;">
        <span style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#C9A84C;font-weight:700;">New Lead · ${esc(siteName)}</span>
        <h1 style="font-size:22px;font-weight:700;color:#fff;margin:8px 0 4px;">${esc(submitterName)}</h1>
        <div style="font-size:13px;color:#888;">${esc(email)}${company ? ' · ' + esc(company) : ''}</div>
        <div style="font-size:12px;color:#666;margin-top:6px;">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET · ${esc(inquiryType)}</div>
      </div>
      <div style="background:#141414;border:1px solid #2a2a2a;border-radius:6px;padding:20px;margin-bottom:16px;">
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      </div>
      <div style="font-size:11px;color:#555;line-height:1.7;border-top:1px solid #222;padding-top:12px;">
        Page: <a href="${esc(referer)}" style="color:#888;">${esc(referer)}</a><br>
        IP: ${esc(ip)} · Country: ${esc(cfCountry)} · CF-Ray: ${esc(cfRay)}<br>
        UA: <span style="color:#555;">${esc(ua.slice(0, 100))}</span>
      </div>
    </div>
  </body></html>`;

  const text = [
    `New lead from ${siteName}`,
    ``,
    `From: ${submitterName} <${email}>`,
    company ? `Company: ${company}` : null,
    `Inquiry: ${inquiryType}`,
    `Page: ${referer}`,
    ``,
    ...filtered.map(([k, v]) => `${humanize(k)}: ${v}`),
    ``,
    `IP: ${ip} · Country: ${cfCountry}`,
  ].filter(Boolean).join('\n');

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('lead: RESEND_API_KEY missing — submission queued but not emailed');
    console.log('LEAD_FALLBACK', JSON.stringify({ site: siteName, email, fields, referer, ts: Date.now() }));
    return jsonResponse(200, { ok: true, warning: 'queued_no_smtp' }, request);
  }

  const from = env.LEAD_FROM || DEFAULT_FROM;
  const to = (env.NOTIFY_EMAIL || DEFAULT_TO).split(',').map(s => s.trim()).filter(Boolean);

  try {
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, reply_to: email, subject, html, text }),
    });
    if (!sendRes.ok) {
      const errBody = await sendRes.text().catch(() => '');
      console.error('lead: Resend failed', sendRes.status, errBody);
      return jsonResponse(502, { error: 'Email delivery failed', detail: 'resend_' + sendRes.status }, request);
    }
  } catch (e) {
    console.error('lead: Resend exception', e.message);
    return jsonResponse(502, { error: 'Email delivery failed', detail: e.message }, request);
  }

  // Best-effort Supabase persistence
  if (env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY)) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
    const table = env.SUPABASE_LEADS_TABLE || 'leads';
    try {
      await fetch(env.SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          email,
          name: submitterName,
          company: company || null,
          inquiry_type: inquiryType,
          message: fields.message || null,
          page_url: referer,
          ip,
          country: cfCountry,
          raw_payload: fields,
          source_site: siteName,
          created_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.warn('lead: Supabase write failed', e.message);
    }
  }

  return jsonResponse(200, { ok: true }, request);
}
