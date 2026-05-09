// POST /api/square-webhook  - Square payment.created/completed/updated
// Verifies HMAC-SHA256 signature using Web Crypto, marks job paid, emails Mark + customer.
import { supabase, sendEmail, SERVICE_LABELS } from '../_shared/helpers.js';

const WEBHOOK_URL = 'https://busbrother.com/api/square-webhook';

async function verifySignature(env, rawBody, signatureHeader) {
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY || !signatureHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(WEBHOOK_URL + rawBody));
  // base64
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const expected = btoa(bin);
  // constant-time compare
  if (expected.length !== signatureHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return mismatch === 0;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return new Response('OK', { status: 200 });

  const rawBody = await request.text();
  const sig = request.headers.get('x-square-hmacsha256-signature');
  if (env.SQUARE_WEBHOOK_SIGNATURE_KEY && !(await verifySignature(env, rawBody, sig))) {
    return new Response('Invalid signature', { status: 403 });
  }

  let payload; try { payload = JSON.parse(rawBody); } catch { return new Response('OK'); }
  if (!['payment.created', 'payment.completed', 'payment.updated'].includes(payload.type)) {
    return new Response('OK');
  }

  const payment = payload.data?.object?.payment || payload.data?.object || {};
  const orderId = payment.order_id || null;
  const amountMoney = payment.amount_money || payment.total_money;
  const amountDollars = amountMoney ? (amountMoney.amount / 100).toFixed(2) : '0.00';
  if (!orderId) return new Response('OK');

  const j = await supabase(env, `bb_jobs?square_invoice_id=eq.${orderId}&select=*`);
  if (!j.ok || !j.data || !j.data.length) return new Response('OK');
  const job = j.data[0];
  if (job.payment_status === 'paid') return new Response('OK');

  await supabase(env, `bb_jobs?id=eq.${job.id}`, 'PATCH', { payment_status: 'paid', status: 'paid' });

  const serviceLabel = SERVICE_LABELS[job.service] || job.service || 'Charter Bus';

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
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Vendor Cost</td><td style="padding:8px 16px;color:#8a9ab5;font-size:14px;border-bottom:1px solid #1e3052;">$${(job.vendor_cost || 0).toFixed(2)}</td></tr>
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Your Profit</td><td style="padding:8px 16px;color:#2ecc71;font-size:16px;font-weight:700;border-bottom:1px solid #1e3052;">$${(job.profit || 0).toFixed(2)}</td></tr>
    </table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <a href="https://busbrother.com/admin/jobs/" style="display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Open Dashboard</a>
  </div>
</div></body></html>`;

  const notifyEmails = (env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
  await sendEmail(env, { to: notifyEmails, subject: `[BusBrother] PAID: $${amountDollars} from ${job.customer_name || 'Customer'} - ${serviceLabel}`, html: ownerHtml });

  if (job.customer_email) {
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
    await sendEmail(env, { to: job.customer_email, subject: `BusBrother - Booking Confirmed! ${serviceLabel} - ${job.pickup_date || ''}`, html: customerHtml, replyTo: 'info@busbrother.com' });
  }

  return new Response('OK', { status: 200 });
}
