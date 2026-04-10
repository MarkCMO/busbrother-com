/**
 * Netlify submission-created event handler
 * 1. Sends branded email to Mark (owner notification)
 * 2. Creates job in Supabase with vendor_token
 * 3. Sends "New Job Available" email to all active vendors
 */

const NOTIFY_EMAILS = (process.env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.BUSBROTHER_FROM_EMAIL || 'onboarding@resend.dev';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

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

async function getActiveVendors() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bb_vendors?active=eq.true&select=email,company_name,contact_name`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.ok ? await res.json() : [];
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: Array.isArray(to) ? to : [to], subject, html })
  }).catch(e => console.error('Email error:', e));
}

exports.handler = async (event) => {
  try {
    const { payload } = JSON.parse(event.body);
    const formName = payload.form_name || 'Unknown Form';
    const data = payload.data || {};
    const submittedAt = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    // Only create jobs for quote forms (not contact or lead magnets)
    const isQuoteForm = ['quote-sidebar', 'quote-full'].includes(formName);

    // ── 1. Send owner notification email ──────────────────
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

    const ownerHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#8a9ab5;font-size:12px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;">New ${leadType}</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:16px;margin-bottom:20px;">
      <p style="margin:0;color:#f5a623;font-size:14px;font-weight:600;">${leadType} received at ${submittedAt} ET</p>
      ${data['page-url'] ? `<p style="margin:6px 0 0;color:#8a9ab5;font-size:12px;">From: https://busbrother.com${data['page-url']}</p>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">${fields}</table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    ${data.email ? `<a href="mailto:${data.email}?subject=BusBrother%20Quote" style="display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Reply to ${data.name || 'Customer'}</a>` : ''}
    ${data.phone ? `<a href="tel:${data.phone}" style="display:inline-block;background:transparent;border:1px solid #1e3052;color:#f8f6f0;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-left:10px;">Call ${data.phone}</a>` : ''}
  </div>
</div></body></html>`;

    await sendEmail(NOTIFY_EMAILS, `[BusBrother] New ${leadType} from ${data.name || data.email || 'Website'}`, ownerHtml);

    // ── 2. Create job in Supabase (quote forms only) ──────
    if (isQuoteForm && SUPABASE_URL) {
      const vendorToken = generateToken();

      const job = await supabasePost('bb_jobs', {
        vendor_token: vendorToken,
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
        page_url: data['page-url'] || null,
        status: 'open'
      });

      if (job && job.length > 0) {
        console.log('Job created:', job[0].id, 'token:', vendorToken);

        // ── 3. Notify vendors ──────────────────────────────
        const vendors = await getActiveVendors();
        if (vendors.length > 0) {
          const jobUrl = `https://busbrother.com/jobs/?token=${vendorToken}`;
          const serviceLabel = {
            cruise: 'Cruise Port Shuttle', ksc: 'Kennedy Space Center', airport: 'Airport Transfer',
            rocket: 'Rocket Launch Viewing', corporate: 'Corporate Charter', wedding: 'Wedding/Event',
            school: 'School Group', themepark: 'Theme Parks', hotel: 'Hotel Shuttle', sports: 'Sports Event'
          }[data.service] || data.service || 'Charter Bus';

          const vendorHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#8a9ab5;font-size:12px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;">New Job Available for Bid</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:20px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;color:#f5a623;font-size:18px;font-weight:700;">${serviceLabel}</p>
      <p style="margin:8px 0 0;color:#f8f6f0;font-size:14px;">${data.pickup || 'TBD'} &rarr; ${data.dropoff || 'TBD'}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
      ${data.date ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;width:120px;">Date</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data.date}</td></tr>` : ''}
      ${data.passengers ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Passengers</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data.passengers}</td></tr>` : ''}
      ${data['trip-type'] ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Trip Type</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data['trip-type']}</td></tr>` : ''}
      ${data['ada-accessible'] === 'yes' ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">ADA</td><td style="padding:10px 16px;color:#2ecc71;font-size:14px;border-bottom:1px solid #1e3052;">Wheelchair Accessible Required</td></tr>` : ''}
      ${data.notes ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Notes</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data.notes}</td></tr>` : ''}
    </table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <a href="${jobUrl}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:14px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px;">Submit Your Bid</a>
    <p style="color:#8a9ab5;font-size:11px;margin-top:16px;">Click the button above to view full job details and submit your quote.</p>
  </div>
</div></body></html>`;

          const vendorEmails = vendors.map(v => v.email);
          await sendEmail(vendorEmails, `[BusBrother] New Job: ${serviceLabel} - ${data.date || 'Date TBD'} - ${data.passengers || ''} passengers`, vendorHtml);
          console.log('Vendor notification sent to', vendorEmails.length, 'vendors');
        }
      }
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('submission-created error:', err);
    return { statusCode: 200, body: 'OK' };
  }
};
