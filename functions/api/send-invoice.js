// POST /api/send-invoice  body={secret, job_id, customer_price, note}
// Creates Square payment link, stores it on the job, emails customer.
import { json, errResponse, optionsResponse, supabase, sendEmail, SERVICE_LABELS } from '../_shared/helpers.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return errResponse('Method not allowed', 405);

  let body; try { body = await request.json(); } catch { return errResponse('Invalid JSON'); }
  if (!env.BUSBROTHER_ADMIN_SECRET || body.secret !== env.BUSBROTHER_ADMIN_SECRET) return errResponse('Unauthorized', 401);
  if (!body.job_id) return errResponse('Missing job_id');
  if (!body.customer_price || isNaN(body.customer_price)) return errResponse('Valid customer price required');

  const j = await supabase(env, `bb_jobs?id=eq.${body.job_id}&select=*`);
  if (!j.ok || !j.data || !j.data.length) return errResponse('Job not found', 404);
  const job = j.data[0];
  if (!job.customer_email) return errResponse('Customer has no email - cannot send invoice');

  let vendorCost = 0;
  if (job.awarded_bid_id) {
    const b = await supabase(env, `bb_bids?id=eq.${job.awarded_bid_id}&select=total_price`);
    if (b.ok && b.data && b.data.length) vendorCost = parseFloat(b.data[0].total_price);
  }

  const customerPrice = parseFloat(body.customer_price);
  const profit = customerPrice - vendorCost;
  const priceCents = Math.round(customerPrice * 100);
  const serviceLabel = SERVICE_LABELS[job.service] || job.service || 'Charter Bus Service';
  const description = `${serviceLabel} - ${job.pickup_location || ''} to ${job.dropoff_location || ''} - ${job.pickup_date || ''} - ${job.passengers || ''} passengers`;

  const idempotencyKey = `bb-${job.id}-${Date.now()}`;
  const squareLocation = env.SQUARE_LOCATION_ID || 'LVBWTHWMEP60S';
  const sqRes = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18'
    },
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      quick_pay: {
        name: `BusBrother - ${serviceLabel}`,
        price_money: { amount: priceCents, currency: 'USD' },
        location_id: squareLocation
      },
      checkout_options: {
        redirect_url: 'https://busbrother.com/thank-you/',
        ask_for_shipping_address: false
      },
      pre_populated_data: {
        buyer_email: job.customer_email,
        buyer_phone_number: job.customer_phone || undefined
      },
      payment_note: description
    })
  });
  const sqData = await sqRes.json();
  if (!sqRes.ok || !sqData.payment_link) {
    return errResponse('Square API error: ' + JSON.stringify(sqData.errors || sqData));
  }
  const paymentUrl = sqData.payment_link.url;
  const orderId = sqData.payment_link.order_id;

  await supabase(env, `bb_jobs?id=eq.${job.id}`, 'PATCH', {
    vendor_cost: vendorCost, customer_price: customerPrice, profit,
    square_invoice_id: orderId, square_payment_url: paymentUrl, payment_status: 'invoiced'
  });

  const customerHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#8a9ab5;font-size:12px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;">Your Transportation Invoice</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <p style="color:#f8f6f0;font-size:15px;margin:0 0 20px;">Hi ${job.customer_name || 'there'},</p>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;">Thank you for choosing BusBrother! Your charter bus transportation has been confirmed. Please complete payment below to finalize your booking.</p>
    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;">
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;width:100px;">Service</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${serviceLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Date</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.pickup_date || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Passengers</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.passengers || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Pickup</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.pickup_location || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Drop-off</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.dropoff_location || 'TBD'}</td></tr>
        ${job.trip_type ? `<tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Trip Type</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.trip_type}</td></tr>` : ''}
      </table>
    </div>
    <div style="background:#0a1628;border:1px solid #1e3052;border-radius:6px;padding:20px;text-align:center;margin-bottom:20px;">
      <p style="color:#8a9ab5;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Total Due</p>
      <p style="color:#f5a623;font-size:36px;font-weight:700;margin:0;">$${customerPrice.toFixed(2)}</p>
    </div>
    ${body.note ? `<p style="color:#8a9ab5;font-size:13px;font-style:italic;margin:0 0 20px;">${body.note}</p>` : ''}
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <a href="${paymentUrl}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:16px 48px;border-radius:6px;text-decoration:none;font-weight:700;font-size:18px;">Pay Now - $${customerPrice.toFixed(2)}</a>
    <p style="color:#8a9ab5;font-size:11px;margin-top:16px;">Secure payment powered by Square. Accepts all major credit cards and Apple Pay.</p>
    <p style="color:#8a9ab5;font-size:11px;margin-top:8px;">Questions? Reply to this email or contact info@busbrother.com</p>
    <p style="color:#8a9ab5;font-size:10px;margin-top:12px;line-height:1.5;">By completing payment, you agree to the <a href="https://busbrother.com/terms/" style="color:#f5a623;">Terms of Service</a>. BusBrother is a transportation broker operated by WETYR Corporation. All transportation is provided by independent, licensed motor carriers.</p>
  </div>
</div></body></html>`;

  await sendEmail(env, {
    to: job.customer_email,
    subject: `BusBrother - Invoice for ${serviceLabel} - $${customerPrice.toFixed(2)}`,
    html: customerHtml,
    replyTo: 'info@busbrother.com'
  });

  return json({ success: true, payment_url: paymentUrl, order_id: orderId, customer_price: customerPrice, vendor_cost: vendorCost, profit });
}
