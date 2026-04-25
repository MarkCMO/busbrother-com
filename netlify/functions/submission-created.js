/**
 * Netlify submission-created event handler
 * 1. Creates job in Supabase with status 'pending'
 * 2. Sends branded email to Mark ONLY with approve/reject buttons
 * Vendors are NOT notified until Mark approves the lead
 */

const NOTIFY_EMAILS = (process.env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.BUSBROTHER_FROM_EMAIL || 'onboarding@resend.dev';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const ADMIN_SECRET = process.env.BUSBROTHER_ADMIN_SECRET;

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 24; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

async function supabasePost(table, data) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  return res.ok ? await res.json() : null;
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) { console.log('No RESEND_API_KEY - skipping email'); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: Array.isArray(to) ? to : [to], subject, html })
  });
  const result = await res.json();
  console.log('Email result:', JSON.stringify(result));
}

exports.handler = async (event) => {
  try {
    const { payload } = JSON.parse(event.body);
    const formName = payload.form_name || 'Unknown Form';
    const data = payload.data || {};
    const submittedAt = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    const isQuoteForm = ['quote-sidebar', 'quote-full'].includes(formName);

    // Build field rows for email
    const fields = Object.entries(data)
      .filter(([key]) => !['form-name', 'bot-field'].includes(key))
      .map(([key, value]) => {
        if (!value) return '';
        const label = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `<tr><td style="padding:10px 16px;font-weight:600;color:#f5a623;text-transform:uppercase;font-size:12px;letter-spacing:1px;border-bottom:1px solid #1e3052;width:160px;vertical-align:top;">${label}</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td></tr>`;
      }).filter(Boolean).join('');

    let leadType = 'Quote Request';
    if (formName === 'contact') leadType = 'Contact Message';
    if (formName === 'lead-magnet') leadType = 'Lead Magnet Download';
    if (formName === 'lead-magnet-cruise') leadType = 'Cruise Checklist Download';

    // Create job in Supabase (quote forms only) with status PENDING
    let vendorToken = null;
    let jobId = null;
    if (isQuoteForm && SUPABASE_URL) {
      vendorToken = generateToken();
      const job = await supabasePost('bb_jobs', {
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
      if (job && job.length > 0) {
        jobId = job[0].id;
        console.log('Job created (pending):', jobId, 'token:', vendorToken);
      }
    }

    // Build approve URL for Mark
    const approveUrl = jobId && ADMIN_SECRET
      ? `https://busbrother.com/.netlify/functions/send-to-vendors?secret=${ADMIN_SECRET}&job_id=${jobId}`
      : null;
    const rejectUrl = jobId && ADMIN_SECRET
      ? `https://busbrother.com/.netlify/functions/jobs-admin?secret=${ADMIN_SECRET}&action=close&job_id=${jobId}`
      : null;
    const dashboardUrl = `https://busbrother.com/admin/jobs/`;

    // Send email to Mark ONLY
    const serviceLabel = {
      cruise: 'Cruise Port Shuttle', ksc: 'Kennedy Space Center', airport: 'Airport Transfer',
      rocket: 'Rocket Launch Viewing', corporate: 'Corporate Charter', wedding: 'Wedding/Event',
      school: 'School Group', themepark: 'Theme Parks', hotel: 'Hotel Shuttle', sports: 'Sports Event'
    }[data.service] || data.service || 'Charter Bus';

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
    ${approveUrl ? `
    <a href="${approveUrl}" style="display:inline-block;background:#2ecc71;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:10px;">SEND OUT FOR BID</a>
    <br/>
    <a href="${rejectUrl}" style="display:inline-block;background:transparent;border:1px solid #e74c3c;color:#e74c3c;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;margin-top:8px;">Reject Lead</a>
    <br/>` : ''}
    ${data.email ? `<a href="mailto:${data.email}?subject=BusBrother%20Quote" style="display:inline-block;color:#f5a623;padding:10px 24px;text-decoration:none;font-size:13px;margin-top:10px;">Reply to ${data.name || 'Customer'}</a>` : ''}
    ${data.phone ? `<a href="tel:${data.phone}" style="display:inline-block;color:#8a9ab5;padding:10px 24px;text-decoration:none;font-size:13px;margin-top:4px;">Call ${data.phone}</a>` : ''}
    <br/>
    <a href="${dashboardUrl}" style="display:inline-block;color:#8a9ab5;padding:8px 24px;text-decoration:none;font-size:12px;margin-top:8px;">Open Dashboard &rarr;</a>
  </div>
</div></body></html>`;

    await sendEmail(NOTIFY_EMAILS, `[BusBrother] ${isQuoteForm ? 'REVIEW: ' : ''}New ${leadType} from ${data.name || data.email || 'Website'}${isQuoteForm ? ' - ' + serviceLabel : ''}`, ownerHtml);

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('submission-created error:', err);
    return { statusCode: 200, body: 'OK' };
  }
};
