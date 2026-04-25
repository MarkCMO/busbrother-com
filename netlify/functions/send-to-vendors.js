/**
 * GET/POST /.netlify/functions/send-to-vendors?secret={admin}&job_id={id}
 * Mark clicks "Send Out for Bid" -> this changes job to 'open' and emails all vendors
 * Returns a branded confirmation page (not JSON)
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
.btn{display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;}</style>
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

  const jobId = params.job_id;
  if (!jobId) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Error', 'Missing job ID.', 'red') };
  }

  try {
    // Get the job
    const jobs = await supabaseFetch(`bb_jobs?id=eq.${jobId}&select=*`, 'GET');
    if (!jobs || jobs.length === 0) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Not Found', 'Job not found.', 'red') };
    }

    const job = jobs[0];

    if (job.status !== 'pending') {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Already Processed', `This job is already "${job.status}". No action needed.`, 'green') };
    }

    // Update status to 'open'
    await supabaseFetch(`bb_jobs?id=eq.${jobId}`, 'PATCH', { status: 'open' });

    // Get active vendors
    const vendors = await supabaseFetch('bb_vendors?active=eq.true&select=email,company_name,contact_name', 'GET');

    if (!vendors || vendors.length === 0) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Approved - No Vendors', 'Job approved and set to open, but no active vendors found in the system. Add vendors in Supabase to receive bid notifications.', 'green') };
    }

    // Send vendor notification emails
    const jobUrl = `https://busbrother.com/jobs/?token=${job.vendor_token}`;
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
    <p style="color:#8a9ab5;font-size:12px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;">New Job Available for Bid</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:20px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;color:#f5a623;font-size:18px;font-weight:700;">${serviceLabel}</p>
      <p style="margin:8px 0 0;color:#f8f6f0;font-size:14px;">${job.pickup_location || 'TBD'} &rarr; ${job.dropoff_location || 'TBD'}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
      ${job.pickup_date ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;width:120px;">Date</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.pickup_date}</td></tr>` : ''}
      ${job.passengers ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Passengers</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.passengers}</td></tr>` : ''}
      ${job.trip_type ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Trip Type</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.trip_type}</td></tr>` : ''}
      ${job.ada_accessible ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">ADA</td><td style="padding:10px 16px;color:#2ecc71;font-size:14px;border-bottom:1px solid #1e3052;">Wheelchair Accessible Required</td></tr>` : ''}
      ${job.notes ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Notes</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.notes}</td></tr>` : ''}
    </table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <a href="${jobUrl}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:14px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px;">Submit Your Bid</a>
    <p style="color:#8a9ab5;font-size:11px;margin-top:16px;">Click above to view full details and submit your quote.</p>
  </div>
</div></body></html>`;

    const vendorEmails = vendors.map(v => v.email);
    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: vendorEmails,
          subject: `[BusBrother] New Job: ${serviceLabel} - ${job.pickup_date || 'Date TBD'} - ${job.passengers || ''} passengers`,
          html: vendorHtml
        })
      });
    }

    console.log('Job', jobId, 'sent to', vendorEmails.length, 'vendors');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage('Sent to Vendors!', `Job approved and sent to ${vendorEmails.length} vendor${vendorEmails.length !== 1 ? 's' : ''}. You will receive email notifications as bids come in.`, 'green')
    };
  } catch (err) {
    console.error('send-to-vendors error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Error', 'Something went wrong. Check the function logs.', 'red') };
  }
};
