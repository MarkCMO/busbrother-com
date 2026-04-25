/**
 * GET /.netlify/functions/award-bid?secret={admin}&job_id={id}&bid_id={id}
 * Mark clicks "Accept This Bid" in email -> awards bid, notifies vendor
 * Returns a branded confirmation page
 */

const ADMIN_SECRET = process.env.BUSBROTHER_ADMIN_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.BUSBROTHER_FROM_EMAIL || 'onboarding@resend.dev';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

async function supabaseFetch(path, method, body) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };
  if (method === 'POST' || method === 'PATCH') headers['Prefer'] = 'return=representation';
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  return res.ok ? await res.json() : null;
}

function htmlPage(title, message, color) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title} | BusBrother</title>
<style>body{margin:0;padding:0;background:#060e1c;color:#f8f6f0;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.box{text-align:center;max-width:500px;padding:3rem;}h1{font-size:2rem;letter-spacing:3px;margin-bottom:1rem;}h1 span{color:#f5a623;}
.msg{color:#8a9ab5;font-size:1.1rem;line-height:1.6;margin-bottom:2rem;}
.btn{display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;margin:0.3rem;}</style>
</head><body><div class="box">
<h1>BUS<span>BROTHER</span></h1>
<div style="font-size:4rem;margin:1rem 0;">${color === 'green' ? '&#10003;' : '&#10007;'}</div>
<p class="msg">${message}</p>
<a href="https://busbrother.com/admin/jobs/" class="btn">Open Dashboard</a>
</div></body></html>`;
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};

  if (!ADMIN_SECRET || params.secret !== ADMIN_SECRET) {
    return { statusCode: 401, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Unauthorized', 'Invalid admin secret.', 'red') };
  }

  const { job_id, bid_id } = params;
  if (!job_id || !bid_id) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Error', 'Missing job or bid ID.', 'red') };
  }

  try {
    // Get the job
    const jobs = await supabaseFetch(`bb_jobs?id=eq.${job_id}&select=*`, 'GET');
    if (!jobs || !jobs.length) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Not Found', 'Job not found.', 'red') };
    }
    const job = jobs[0];

    if (job.status === 'awarded') {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Already Awarded', 'This job has already been awarded.', 'green') };
    }

    // Get the bid
    const bids = await supabaseFetch(`bb_bids?id=eq.${bid_id}&select=*`, 'GET');
    if (!bids || !bids.length) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Not Found', 'Bid not found.', 'red') };
    }
    const bid = bids[0];

    // Award the bid
    await supabaseFetch(`bb_jobs?id=eq.${job_id}`, 'PATCH', { status: 'awarded', awarded_bid_id: bid_id });

    // Email the winning vendor
    if (RESEND_API_KEY) {
      const serviceLabel = {
        cruise: 'Cruise Port Shuttle', ksc: 'Kennedy Space Center', airport: 'Airport Transfer',
        rocket: 'Rocket Launch Viewing', corporate: 'Corporate Charter', wedding: 'Wedding/Event',
        school: 'School Group', themepark: 'Theme Parks', hotel: 'Hotel Shuttle', sports: 'Sports Event'
      }[job.service] || job.service || 'Charter Bus';

      const vendorHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#2ecc71;font-size:14px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;font-weight:700;">YOUR BID HAS BEEN ACCEPTED!</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <div style="background:rgba(46,204,113,0.1);border:2px solid rgba(46,204,113,0.4);border-radius:6px;padding:20px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;color:#2ecc71;font-size:24px;font-weight:700;">Congratulations!</p>
      <p style="margin:8px 0 0;color:#f8f6f0;font-size:14px;">Your bid of <strong>$${parseFloat(bid.total_price).toFixed(2)}</strong> has been accepted for the job below.</p>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;width:120px;">Service</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${serviceLabel}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Date</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.pickup_date || 'TBD'}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Passengers</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.passengers || 'TBD'}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Pickup</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.pickup_location || 'TBD'}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Drop-off</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.dropoff_location || 'TBD'}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Your Price</td><td style="padding:10px 16px;color:#2ecc71;font-size:16px;font-weight:700;border-bottom:1px solid #1e3052;">$${parseFloat(bid.total_price).toFixed(2)}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Vehicle</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${bid.vehicle_type || ''}</td></tr>
      ${job.ada_accessible ? '<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">ADA</td><td style="padding:10px 16px;color:#2ecc71;font-size:14px;border-bottom:1px solid #1e3052;">Wheelchair Accessible Required</td></tr>' : ''}
    </table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <p style="color:#f8f6f0;font-size:14px;margin:0 0 16px;">A BusBrother coordinator will contact you shortly with final details.</p>
    <a href="mailto:info@busbrother.com?subject=Accepted Bid - ${serviceLabel} ${job.pickup_date || ''}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Contact BusBrother</a>
  </div>
</div></body></html>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [bid.contact_email],
          subject: `[BusBrother] Your Bid Was Accepted! - ${serviceLabel} - $${parseFloat(bid.total_price).toFixed(2)}`,
          html: vendorHtml
        })
      }).catch(e => console.error('Award email error:', e));
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage('Bid Awarded!', `You awarded this job to <strong>${bid.company_name}</strong> for <strong>$${parseFloat(bid.total_price).toFixed(2)}</strong>. The vendor has been notified by email at ${bid.contact_email}.`, 'green')
    };
  } catch (err) {
    console.error('award-bid error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Error', 'Something went wrong.', 'red') };
  }
};
