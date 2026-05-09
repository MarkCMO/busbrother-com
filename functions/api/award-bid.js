// GET /api/award-bid?secret=X&job_id=ID&bid_id=ID
import { html, supabase, sendEmail, adminOk, adminPage, SERVICE_LABELS } from '../_shared/helpers.js';

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!adminOk(url, env)) return html(adminPage('Unauthorized', 'Invalid admin secret.', 'red'), 401);
  const jobId = url.searchParams.get('job_id');
  const bidId = url.searchParams.get('bid_id');
  if (!jobId || !bidId) return html(adminPage('Error', 'Missing job or bid ID.', 'red'), 400);

  const j = await supabase(env, `bb_jobs?id=eq.${jobId}&select=*`);
  if (!j.ok || !j.data || !j.data.length) return html(adminPage('Not Found', 'Job not found.', 'red'), 404);
  const job = j.data[0];
  if (job.status === 'awarded') return html(adminPage('Already Awarded', 'This job has already been awarded.', 'green'));

  const b = await supabase(env, `bb_bids?id=eq.${bidId}&select=*`);
  if (!b.ok || !b.data || !b.data.length) return html(adminPage('Not Found', 'Bid not found.', 'red'), 404);
  const bid = b.data[0];

  await supabase(env, `bb_jobs?id=eq.${jobId}`, 'PATCH', { status: 'awarded', awarded_bid_id: bidId });

  const serviceLabel = SERVICE_LABELS[job.service] || job.service || 'Charter Bus';
  const price = parseFloat(bid.total_price).toFixed(2);
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
      <p style="margin:8px 0 0;color:#f8f6f0;font-size:14px;">Your bid of <strong>$${price}</strong> has been accepted for the job below.</p>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;width:120px;">Service</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${serviceLabel}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Date</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.pickup_date || 'TBD'}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Passengers</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.passengers || 'TBD'}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Pickup</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.pickup_location || 'TBD'}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Drop-off</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.dropoff_location || 'TBD'}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Your Price</td><td style="padding:10px 16px;color:#2ecc71;font-size:16px;font-weight:700;border-bottom:1px solid #1e3052;">$${price}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Vehicle</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${bid.vehicle_type || ''}</td></tr>
      ${job.ada_accessible ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">ADA</td><td style="padding:10px 16px;color:#2ecc71;font-size:14px;border-bottom:1px solid #1e3052;">Wheelchair Accessible Required</td></tr>` : ''}
    </table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <p style="color:#f8f6f0;font-size:14px;margin:0 0 16px;">A BusBrother coordinator will contact you shortly with final details.</p>
    <a href="mailto:info@busbrother.com?subject=Accepted Bid - ${serviceLabel} ${job.pickup_date || ''}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Contact BusBrother</a>
  </div>
</div></body></html>`;

  await sendEmail(env, { to: bid.contact_email, subject: `[BusBrother] Your Bid Was Accepted! - ${serviceLabel} - $${price}`, html: vendorHtml });

  return html(adminPage('Bid Awarded!', `You awarded this job to <strong>${bid.company_name}</strong> for <strong>$${price}</strong>. The vendor has been notified at ${bid.contact_email}.`, 'green'));
}
