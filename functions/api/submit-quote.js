// POST /api/submit-quote
// Replaces Netlify Forms. Accepts the same field names that book.html / sidebar-quote.html post.
// Creates a job in Supabase (status=pending), emails Mark with approve/reject buttons.

import { json, errResponse, optionsResponse, supabase, sendEmail, generateToken, SERVICE_LABELS } from '../_shared/helpers.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return errResponse('Method not allowed', 405);

  // Accept either application/json or application/x-www-form-urlencoded (HTML form default)
  let data = {};
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      data = await request.json();
    } else {
      const form = await request.formData();
      for (const [k, v] of form.entries()) data[k] = v;
    }
  } catch (e) {
    return errResponse('Invalid request body');
  }

  const formName = data['form-name'] || 'quote';
  const isQuoteForm = ['quote-sidebar', 'quote-full'].includes(formName);
  const submittedAt = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  // Honeypot check
  if (data['bot-field']) return json({ success: true });

  let leadType = 'Quote Request';
  if (formName === 'contact') leadType = 'Contact Message';
  if (formName === 'lead-magnet') leadType = 'Lead Magnet Download';
  if (formName === 'lead-magnet-cruise') leadType = 'Cruise Checklist Download';

  // Build field rows for email (skip form-name + bot-field)
  const fields = Object.entries(data)
    .filter(([k]) => !['form-name', 'bot-field'].includes(k))
    .map(([k, v]) => {
      if (!v) return '';
      const label = k.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const safeVal = String(v).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<tr><td style="padding:10px 16px;font-weight:600;color:#f5a623;text-transform:uppercase;font-size:12px;letter-spacing:1px;border-bottom:1px solid #1e3052;width:160px;vertical-align:top;">${label}</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${safeVal}</td></tr>`;
    })
    .filter(Boolean).join('');

  // Create job in Supabase if quote form
  let vendorToken = null, jobId = null;
  if (isQuoteForm && env.SUPABASE_URL) {
    vendorToken = generateToken();
    const job = await supabase(env, 'bb_jobs', 'POST', {
      vendor_token: vendorToken,
      status: 'pending',
      customer_name: data.name || null,
      customer_email: data.email || null,
      customer_phone: data.phone || null,
      service: data.service || null,
      trip_type: data['trip-type'] || null,
      pickup_date: data.date || null,
      passengers: data.passengers || null,
      pickup_location: data.pickup || null,
      dropoff_location: data.dropoff || null,
      ada_accessible: data['ada-accessible'] === 'yes',
      multi_stop: data['multi-stop'] === 'yes',
      luggage_assist: data['luggage-assist'] === 'yes',
      notes: data.notes || null,
      page_url: data['page-url'] || null
    });
    if (job.ok && Array.isArray(job.data) && job.data.length > 0) {
      jobId = job.data[0].id;
    }
  }

  const adminSecret = env.BUSBROTHER_ADMIN_SECRET;
  const approveUrl = jobId && adminSecret ? `https://busbrother.com/api/send-to-vendors?secret=${adminSecret}&job_id=${jobId}` : null;
  const btmUrl = jobId && adminSecret ? `https://busbrother.com/api/send-to-btm?secret=${adminSecret}&job_id=${jobId}` : null;
  const rejectUrl = jobId && adminSecret ? `https://busbrother.com/api/jobs-admin?secret=${adminSecret}&action=close&job_id=${jobId}` : null;
  const dashboardUrl = `https://busbrother.com/admin/jobs/`;

  const serviceLabel = SERVICE_LABELS[data.service] || data.service || 'Charter Bus';

  const ownerHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#8a9ab5;font-size:12px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;">New ${leadType}${isQuoteForm ? ' - PENDING APPROVAL' : ''}</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    ${isQuoteForm ? `<div style="background:rgba(245,166,35,0.12);border:2px solid rgba(245,166,35,0.5);border-radius:6px;padding:16px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;color:#f5a623;font-size:16px;font-weight:700;">REVIEW REQUIRED</p>
      <p style="margin:6px 0 0;color:#f8f6f0;font-size:13px;">This lead needs your approval before vendors are notified.</p>
    </div>` : ''}
    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:16px;margin-bottom:20px;">
      <p style="margin:0;color:#f5a623;font-size:14px;font-weight:600;">${leadType} received at ${submittedAt} ET</p>
      ${data['page-url'] ? `<p style="margin:6px 0 0;color:#8a9ab5;font-size:12px;">From: https://busbrother.com${data['page-url']}</p>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">${fields}</table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    ${btmUrl ? `<a href="${btmUrl}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:10px;">🚌 SEND TO BTM COACH</a><br/>` : ''}
    ${approveUrl ? `<a href="${approveUrl}" style="display:inline-block;background:#2ecc71;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;margin:6px 0;">Send to Full Vendor Network</a><br/>
    <a href="${rejectUrl}" style="display:inline-block;background:transparent;border:1px solid #e74c3c;color:#e74c3c;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;margin-top:8px;">Reject Lead</a><br/>` : ''}
    ${data.email ? `<a href="mailto:${data.email}?subject=BusBrother%20Quote" style="display:inline-block;color:#f5a623;padding:10px 24px;text-decoration:none;font-size:13px;margin-top:10px;">Reply to ${data.name || 'Customer'}</a>` : ''}
    ${data.phone ? `<a href="tel:${data.phone}" style="display:inline-block;color:#8a9ab5;padding:10px 24px;text-decoration:none;font-size:13px;margin-top:4px;">Call ${data.phone}</a>` : ''}
    <br/><a href="${dashboardUrl}" style="display:inline-block;color:#8a9ab5;padding:8px 24px;text-decoration:none;font-size:12px;margin-top:8px;">Open Dashboard &rarr;</a>
  </div>
</div></body></html>`;

  const notifyEmails = (env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
  const subject = `[BusBrother] ${isQuoteForm ? 'REVIEW: ' : ''}New ${leadType} from ${data.name || data.email || 'Website'}${isQuoteForm ? ' - ' + serviceLabel : ''}`;
  const emailResult = await sendEmail(env, { to: notifyEmails, subject, html: ownerHtml, replyTo: data.email || undefined });

  // Lead-loss guard: quote forms persist to Supabase (jobId set), so a failed
  // email is non-fatal. But contact/lead-magnet forms are email-only — if that
  // email fails AND nothing was persisted, the lead would vanish. Surface an
  // error so the visitor can retry instead of seeing a false thank-you.
  const persisted = !!jobId;
  if (!persisted && (!emailResult || emailResult.ok === false)) {
    if (!ct.includes('application/json')) {
      return new Response(null, { status: 303, headers: { 'Location': '/?error=send_failed#contact' } });
    }
    return json({ success: false, error: 'We could not submit your request. Please try again or call us.' }, 502);
  }

  // For HTML form submits, redirect to thank-you page
  if (!ct.includes('application/json')) {
    return new Response(null, { status: 303, headers: { 'Location': '/thank-you/' } });
  }
  return json({ success: true, jobId, vendorToken });
}
