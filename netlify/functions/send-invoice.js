/**
 * POST /.netlify/functions/send-invoice
 * Creates a Square invoice and sends payment link to customer
 * Body: { secret, job_id, customer_price, note }
 */

const ADMIN_SECRET = process.env.BUSBROTHER_ADMIN_SECRET;
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LVBWTHWMEP60S';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.BUSBROTHER_FROM_EMAIL || 'onboarding@resend.dev';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

async function supabaseFetch(path, method, body) {
  const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  if (method === 'PATCH') headers['Prefer'] = 'return=representation';
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  return res.ok ? await res.json() : null;
}

function ok(data) { return { statusCode: 200, headers: CORS, body: JSON.stringify(data) }; }
function err(msg, code = 400) { return { statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) }; }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return err('Invalid JSON'); }

  if (!ADMIN_SECRET || body.secret !== ADMIN_SECRET) return err('Unauthorized', 401);
  if (!body.job_id) return err('Missing job_id');
  if (!body.customer_price || isNaN(body.customer_price)) return err('Valid customer price required');

  // Get job
  const jobs = await supabaseFetch(`bb_jobs?id=eq.${body.job_id}&select=*`, 'GET');
  if (!jobs || !jobs.length) return err('Job not found', 404);
  const job = jobs[0];

  if (!job.customer_email) return err('Customer has no email address - cannot send invoice');

  // Get awarded bid for vendor cost
  let vendorCost = 0;
  if (job.awarded_bid_id) {
    const bids = await supabaseFetch(`bb_bids?id=eq.${job.awarded_bid_id}&select=total_price`, 'GET');
    if (bids && bids.length) vendorCost = parseFloat(bids[0].total_price);
  }

  const customerPrice = parseFloat(body.customer_price);
  const profit = customerPrice - vendorCost;
  const priceCents = Math.round(customerPrice * 100);

  const serviceLabel = {
    cruise: 'Cruise Port Shuttle', ksc: 'Kennedy Space Center', airport: 'Airport Transfer',
    rocket: 'Rocket Launch Viewing', corporate: 'Corporate Charter', wedding: 'Wedding/Event',
    school: 'School Group', themepark: 'Theme Parks', hotel: 'Hotel Shuttle', sports: 'Sports Event'
  }[job.service] || job.service || 'Charter Bus Service';

  const description = `${serviceLabel} - ${job.pickup_location || ''} to ${job.dropoff_location || ''} - ${job.pickup_date || ''} - ${job.passengers || ''} passengers`;

  try {
    // Create Square payment link (checkout)
    const idempotencyKey = `bb-${job.id}-${Date.now()}`;
    const squareRes = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18'
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        quick_pay: {
          name: `BusBrother - ${serviceLabel}`,
          price_money: {
            amount: priceCents,
            currency: 'USD'
          },
          location_id: SQUARE_LOCATION_ID
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

    const squareData = await squareRes.json();
    console.log('Square response:', JSON.stringify(squareData));

    if (!squareRes.ok || !squareData.payment_link) {
      return err('Square API error: ' + JSON.stringify(squareData.errors || squareData));
    }

    const paymentUrl = squareData.payment_link.url;
    const orderId = squareData.payment_link.order_id;

    // Update job in Supabase
    await supabaseFetch(`bb_jobs?id=eq.${job.id}`, 'PATCH', {
      vendor_cost: vendorCost,
      customer_price: customerPrice,
      profit: profit,
      square_invoice_id: orderId,
      square_payment_url: paymentUrl,
      payment_status: 'invoiced'
    });

    // Send payment link to customer via email
    if (RESEND_API_KEY) {
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
      <p style="color:#f5a623;font-size:36px;font-weight:700;margin:0;font-family:Arial,sans-serif;">$${customerPrice.toFixed(2)}</p>
    </div>

    ${body.note ? `<p style="color:#8a9ab5;font-size:13px;font-style:italic;margin:0 0 20px;">${body.note}</p>` : ''}
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <a href="${paymentUrl}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:16px 48px;border-radius:6px;text-decoration:none;font-weight:700;font-size:18px;">Pay Now - $${customerPrice.toFixed(2)}</a>
    <p style="color:#8a9ab5;font-size:11px;margin-top:16px;">Secure payment powered by Square. Accepts all major credit cards and Apple Pay.</p>
    <p style="color:#8a9ab5;font-size:11px;margin-top:8px;">Questions? Reply to this email or contact info@busbrother.com</p>
    <p style="color:#8a9ab5;font-size:10px;margin-top:12px;line-height:1.5;">By completing payment, you agree to the <a href="https://busbrother.com/terms/" style="color:#f5a623;">Terms of Service</a>. BusBrother is a transportation broker operated by WETYR Corporation. All transportation is provided by independent, licensed motor carriers. BusBrother does not own or operate any vehicles.</p>
  </div>
</div></body></html>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [job.customer_email],
          subject: `BusBrother - Invoice for ${serviceLabel} - $${customerPrice.toFixed(2)}`,
          html: customerHtml,
          reply_to: 'info@busbrother.com'
        })
      });
    }

    return ok({
      success: true,
      payment_url: paymentUrl,
      order_id: orderId,
      customer_price: customerPrice,
      vendor_cost: vendorCost,
      profit: profit
    });

  } catch (e) {
    console.error('send-invoice error:', e);
    return err('Failed to create invoice: ' + e.message);
  }
};
