// GET/POST /api/send-to-vendors?secret=X&job_id=ID
// Approves a pending job, flips status to 'open', emails all active vendors.
import { html, supabase, sendEmail, adminOk, adminPage, SERVICE_LABELS } from '../_shared/helpers.js';

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!adminOk(url, env)) return html(adminPage('Unauthorized', 'Invalid admin secret.', 'red'), 401);

  const jobId = url.searchParams.get('job_id');
  if (!jobId) return html(adminPage('Error', 'Missing job ID.', 'red'), 400);

  const j = await supabase(env, `bb_jobs?id=eq.${jobId}&select=*`);
  if (!j.ok || !j.data || !j.data.length) return html(adminPage('Not Found', 'Job not found.', 'red'), 404);
  const job = j.data[0];

  if (job.status !== 'pending') {
    return html(adminPage('Already Processed', `This job is already "${job.status}". No action needed.`, 'green'));
  }

  await supabase(env, `bb_jobs?id=eq.${jobId}`, 'PATCH', { status: 'open' });

  const v = await supabase(env, 'bb_vendors?active=eq.true&select=email,company_name,contact_name');
  const vendors = (v.ok && v.data) ? v.data : [];
  if (!vendors.length) {
    return html(adminPage('Approved - No Vendors', 'Job approved and set to open, but no active vendors found. Add vendors in Supabase to receive bid notifications.', 'green'));
  }

  const jobUrl = `https://busbrother.com/jobs/?token=${job.vendor_token}`;
  const serviceLabel = SERVICE_LABELS[job.service] || job.service || 'Charter Bus';
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
      ${job.pickup_date ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;width:120px;">Date</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.pickup_date}</td></tr>` : ''}
      ${job.passengers ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Passengers</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.passengers}</td></tr>` : ''}
      ${job.trip_type ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Trip Type</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.trip_type}</td></tr>` : ''}
      ${job.ada_accessible ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">ADA</td><td style="padding:10px 16px;color:#2ecc71;font-size:14px;border-bottom:1px solid #1e3052;">Wheelchair Accessible Required</td></tr>` : ''}
      ${job.notes ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Notes</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.notes}</td></tr>` : ''}
    </table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <a href="${jobUrl}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:14px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px;">Submit Your Bid</a>
    <p style="color:#8a9ab5;font-size:11px;margin-top:16px;">Click above to view full details and submit your quote.</p>
  </div>
</div></body></html>`;

  const subject = `[BusBrother] New Job: ${serviceLabel} - ${job.pickup_date || 'Date TBD'} - ${job.passengers || ''} passengers`;
  await sendEmail(env, { to: vendors.map(v => v.email), subject, html: vendorHtml });

  return html(adminPage('Sent to Vendors!', `Job approved and sent to ${vendors.length} vendor${vendors.length !== 1 ? 's' : ''}. You will receive email notifications as bids come in.`, 'green'));
}
