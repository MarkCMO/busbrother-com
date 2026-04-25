/**
 * POST /.netlify/functions/square-webhook
 * Handles Square payment.created webhook
 * Verifies signature, updates job to 'paid', sends confirmation emails
 */

const crypto = require('crypto');
const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
const WEBHOOK_URL = 'https://busbrother.com/.netlify/functions/square-webhook';

function verifySignature(body, signatureHeader) {
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY || !signatureHeader) return false;
  const hmac = crypto.createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY);
  hmac.update(WEBHOOK_URL + body);
  const expected = hmac.digest('base64');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.BUSBROTHER_FROM_EMAIL || 'onboarding@resend.dev';
const NOTIFY_EMAILS = (process.env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

async function supabaseFetch(path, method, body) {
  const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  if (method === 'PATCH') headers['Prefer'] = 'return=representation';
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  return res.ok ? await res.json() : null;
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: Array.isArray(to) ? to : [to], subject, html, reply_to: 'info@busbrother.com' })
  }).catch(e => console.error('Email error:', e));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'OK' };

  // Verify Square signature
  const signature = event.headers['x-square-hmacsha256-signature'] || event.headers['X-Square-HmacSha256-Signature'];
  if (SQUARE_WEBHOOK_SIGNATURE_KEY && !verifySignature(event.body, signature)) {
    console.log('Invalid Square webhook signature - rejected');
    return { statusCode: 403, body: 'Invalid signature' };
  }

  let payload;
  try { payload = JSON.parse(event.body); } catch(e) { return { statusCode: 200, body: 'OK' }; }

  console.log('Square webhook:', payload.type);

  // Handle payment events
  if (payload.type !== 'payment.created' && payload.type !== 'payment.completed' && payload.type !== 'payment.updated') {
    return { statusCode: 200, body: 'OK' };
  }

  try {
    const payment = payload.data?.object?.payment || payload.data?.object || {};
    const orderId = payment.order_id || null;
    const amountMoney = payment.amount_money || payment.total_money;
    const amountDollars = amountMoney ? (amountMoney.amount / 100).toFixed(2) : '0.00';

    if (!orderId) {
      console.log('No order_id in webhook, skipping');
      return { statusCode: 200, body: 'OK' };
    }

    // Find job by square_invoice_id (which stores the order_id)
    const jobs = await supabaseFetch(`bb_jobs?square_invoice_id=eq.${orderId}&select=*`, 'GET');
    if (!jobs || !jobs.length) {
      console.log('No job found for order:', orderId);
      return { statusCode: 200, body: 'OK' };
    }

    const job = jobs[0];
    if (job.payment_status === 'paid') {
      console.log('Job already marked paid:', job.id);
      return { statusCode: 200, body: 'OK' };
    }

    // Update job to paid
    await supabaseFetch(`bb_jobs?id=eq.${job.id}`, 'PATCH', { payment_status: 'paid', status: 'paid' });
    console.log('Job marked paid:', job.id);

    const serviceLabel = {
      cruise: 'Cruise Port Shuttle', ksc: 'Kennedy Space Center', airport: 'Airport Transfer',
      rocket: 'Rocket Launch Viewing', corporate: 'Corporate Charter', wedding: 'Wedding/Event',
      school: 'School Group', themepark: 'Theme Parks', hotel: 'Hotel Shuttle', sports: 'Sports Event'
    }[job.service] || job.service || 'Charter Bus';

    // Send payment confirmation to Mark
    const ownerHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#2ecc71;font-size:14px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;font-weight:700;">PAYMENT RECEIVED</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <div style="background:rgba(46,204,113,0.1);border:2px solid rgba(46,204,113,0.4);border-radius:6px;padding:20px;text-align:center;margin-bottom:20px;">
      <p style="margin:0;color:#2ecc71;font-size:32px;font-weight:700;">$${amountDollars}</p>
      <p style="margin:6px 0 0;color:#f8f6f0;font-size:14px;">from ${job.customer_name || 'Customer'}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;width:120px;">Service</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${serviceLabel}</td></tr>
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Date</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.pickup_date || 'TBD'}</td></tr>
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Customer</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.customer_name || ''} - ${job.customer_email || ''}</td></tr>
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Pickup</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.pickup_location || ''} &rarr; ${job.dropoff_location || ''}</td></tr>
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Vendor Cost</td><td style="padding:8px 16px;color:var(--muted);font-size:14px;border-bottom:1px solid #1e3052;">$${(job.vendor_cost || 0).toFixed(2)}</td></tr>
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Your Profit</td><td style="padding:8px 16px;color:#2ecc71;font-size:16px;font-weight:700;border-bottom:1px solid #1e3052;">$${(job.profit || 0).toFixed(2)}</td></tr>
    </table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <a href="https://busbrother.com/admin/jobs/" style="display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Open Dashboard</a>
  </div>
</div></body></html>`;

    await sendEmail(NOTIFY_EMAILS, `[BusBrother] PAID: $${amountDollars} from ${job.customer_name || 'Customer'} - ${serviceLabel}`, ownerHtml);

    // Send confirmation to customer
    const customerHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#2ecc71;font-size:14px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;font-weight:700;">BOOKING CONFIRMED</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <p style="color:#f8f6f0;font-size:15px;margin:0 0 16px;">Hi ${job.customer_name || 'there'},</p>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;">Your payment has been received and your charter bus transportation is confirmed! Here are your booking details:</p>
    <div style="background:#0a1628;border:1px solid #1e3052;border-radius:6px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;">
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;width:100px;">Service</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${serviceLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Date</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.pickup_date || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Passengers</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.passengers || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Pickup</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.pickup_location || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Drop-off</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.dropoff_location || 'TBD'}</td></tr>
        ${job.trip_type ? `<tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Trip Type</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.trip_type}</td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Amount Paid</td><td style="padding:6px 0;color:#2ecc71;font-size:16px;font-weight:700;">$${amountDollars}</td></tr>
      </table>
    </div>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;">Your driver will contact you the day before your trip with pickup details. If you have any questions, reply to this email or contact us at info@busbrother.com.</p>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <p style="color:#8a9ab5;font-size:12px;">BusBrother Transportation - Central Florida</p>
    <p style="color:#8a9ab5;font-size:12px;">info@busbrother.com | busbrother.com</p>
  </div>
</div></body></html>`;

    if (job.customer_email) {
      await sendEmail([job.customer_email], `BusBrother - Booking Confirmed! ${serviceLabel} - ${job.pickup_date || ''}`, customerHtml);
    }

  } catch (err) {
    console.error('square-webhook error:', err);
  }

  return { statusCode: 200, body: 'OK' };
};
