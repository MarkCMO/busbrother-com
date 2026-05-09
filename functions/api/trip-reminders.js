// GET /api/trip-reminders?secret=X
// Sends 24h-out trip reminder emails. Trigger via CF Cron Worker, GitHub Actions, or external scheduler.
import { json, errResponse, supabase, sendEmail, adminOk, SERVICE_LABELS } from '../_shared/helpers.js';

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!adminOk(url, env)) return errResponse('Unauthorized', 401);

  if (!env.SUPABASE_URL) return json({ ok: false, error: 'Supabase not configured' });

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const j = await supabase(env, `bb_jobs?pickup_date=eq.${tomorrow}&status=in.(paid,awarded)&select=*`);
  if (!j.ok) return json({ ok: false, error: 'Supabase fetch failed' });
  const jobs = j.data || [];
  if (!jobs.length) return json({ ok: true, processed: 0, date: tomorrow });

  let processed = 0;
  for (const job of jobs) {
    const serviceLabel = SERVICE_LABELS[job.service] || job.service || 'Charter Bus';

    if (job.customer_email) {
      const customerHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#f5a623;font-size:14px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;font-weight:700;">TRIP REMINDER - TOMORROW!</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <p style="color:#f8f6f0;font-size:15px;margin:0 0 16px;">Hi ${job.customer_name || 'there'},</p>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;">This is a friendly reminder that your charter bus trip is <strong style="color:#f5a623;">tomorrow</strong>! Here are your booking details:</p>
    <div style="background:#0a1628;border:1px solid #1e3052;border-radius:6px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;">
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;width:100px;">Service</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${serviceLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Date</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;font-weight:700;">${job.pickup_date}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Passengers</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.passengers || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Pickup</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.pickup_location || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Drop-off</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.dropoff_location || 'TBD'}</td></tr>
        ${job.ada_accessible ? '<tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">ADA</td><td style="padding:6px 0;color:#2ecc71;font-size:14px;">Wheelchair Accessible Vehicle Confirmed</td></tr>' : ''}
      </table>
    </div>
    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:16px;">
      <p style="margin:0;color:#f5a623;font-size:13px;font-weight:600;">IMPORTANT REMINDERS:</p>
      <ul style="color:#8a9ab5;font-size:13px;line-height:1.8;margin:8px 0 0;padding-left:20px;">
        <li>Your driver will arrive 15 minutes before the scheduled pickup time</li>
        <li>Look for the BusBrother name sign at your pickup location</li>
        <li>Have your group ready at the designated pickup point</li>
        <li>Contact us immediately if plans change: info@busbrother.com</li>
      </ul>
    </div>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <p style="color:#8a9ab5;font-size:12px;">Questions? Reply to this email or contact info@busbrother.com</p>
  </div>
</div></body></html>`;
      await sendEmail(env, {
        to: job.customer_email,
        subject: `BusBrother - Trip Reminder: ${serviceLabel} TOMORROW ${job.pickup_date}`,
        html: customerHtml,
        replyTo: 'info@busbrother.com'
      });
    }

    if (job.awarded_bid_id) {
      const b = await supabase(env, `bb_bids?id=eq.${job.awarded_bid_id}&select=*`);
      if (b.ok && b.data && b.data.length) {
        const bid = b.data[0];
        const vendorHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#f5a623;font-size:14px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;font-weight:700;">TRIP REMINDER - TOMORROW!</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <p style="color:#f8f6f0;font-size:15px;margin:0 0 16px;">Hi ${bid.contact_name || bid.company_name},</p>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;">Reminder: You have a confirmed BusBrother job <strong style="color:#f5a623;">tomorrow</strong>.</p>
    <div style="background:#0a1628;border:1px solid #1e3052;border-radius:6px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;">
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;width:100px;">Service</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${serviceLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Date</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;font-weight:700;">${job.pickup_date}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Passengers</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.passengers || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Pickup</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.pickup_location || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Drop-off</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${job.dropoff_location || 'TBD'}</td></tr>
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Vehicle</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${bid.vehicle_type || 'TBD'}</td></tr>
        ${bid.driver_name ? `<tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Driver</td><td style="padding:6px 0;color:#f8f6f0;font-size:14px;">${bid.driver_name}</td></tr>` : ''}
        ${job.ada_accessible ? '<tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">ADA</td><td style="padding:6px 0;color:#2ecc71;font-size:14px;">Wheelchair Accessible Required</td></tr>' : ''}
        <tr><td style="padding:6px 0;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;">Your Bid</td><td style="padding:6px 0;color:#2ecc71;font-size:16px;font-weight:700;">$${parseFloat(bid.total_price).toFixed(2)}</td></tr>
      </table>
    </div>
    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:16px;">
      <p style="margin:0;color:#f5a623;font-size:13px;font-weight:600;">DRIVER INSTRUCTIONS:</p>
      <ul style="color:#8a9ab5;font-size:13px;line-height:1.8;margin:8px 0 0;padding-left:20px;">
        <li>Arrive 15 minutes before scheduled pickup time</li>
        <li>Display BusBrother name sign for the group</li>
        <li>Assist with luggage loading</li>
        <li>Contact BusBrother if any issues: info@busbrother.com</li>
      </ul>
    </div>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <a href="mailto:info@busbrother.com?subject=Trip Tomorrow - ${job.pickup_date}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Contact BusBrother</a>
  </div>
</div></body></html>`;
        await sendEmail(env, {
          to: bid.contact_email,
          subject: `BusBrother - Job Reminder: ${serviceLabel} TOMORROW ${job.pickup_date}`,
          html: vendorHtml,
          replyTo: 'info@busbrother.com'
        });
      }
    }
    processed++;
  }

  return json({ ok: true, processed, date: tomorrow });
}
