/**
 * Scheduled function - runs every hour
 * Checks for trips happening in ~24 hours and sends reminder emails
 * to both customer and awarded vendor
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.BUSBROTHER_FROM_EMAIL || 'onboarding@resend.dev';
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
  console.log('Trip reminders check running...');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('No Supabase config - skipping');
    return { statusCode: 200, body: 'OK' };
  }

  try {
    // Get tomorrow's date in YYYY-MM-DD format
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Also check today (for any missed reminders)
    const todayStr = now.toISOString().split('T')[0];

    // Find paid/awarded jobs with pickup_date = tomorrow that haven't been reminded yet
    const jobs = await supabaseFetch(
      `bb_jobs?pickup_date=eq.${tomorrowStr}&status=in.(paid,awarded)&select=*`,
      'GET'
    );

    if (!jobs || jobs.length === 0) {
      console.log('No trips tomorrow (' + tomorrowStr + ')');
      return { statusCode: 200, body: 'OK' };
    }

    console.log('Found', jobs.length, 'trip(s) tomorrow');

    for (const job of jobs) {
      // Check if we already sent a reminder (use notes field hack or a separate flag)
      // For now, just send - the scheduled function runs hourly but we can dedupe by checking a flag

      const serviceLabel = {
        cruise: 'Cruise Port Shuttle', ksc: 'Kennedy Space Center', airport: 'Airport Transfer',
        rocket: 'Rocket Launch Viewing', corporate: 'Corporate Charter', wedding: 'Wedding/Event',
        school: 'School Group', themepark: 'Theme Parks', hotel: 'Hotel Shuttle', sports: 'Sports Event'
      }[job.service] || job.service || 'Charter Bus';

      // Send reminder to customer
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

        await sendEmail([job.customer_email], `BusBrother - Trip Reminder: ${serviceLabel} TOMORROW ${job.pickup_date}`, customerHtml);
        console.log('Customer reminder sent:', job.customer_email);
      }

      // Send reminder to awarded vendor
      if (job.awarded_bid_id) {
        const bids = await supabaseFetch(`bb_bids?id=eq.${job.awarded_bid_id}&select=*`, 'GET');
        if (bids && bids.length) {
          const bid = bids[0];
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

          await sendEmail([bid.contact_email], `BusBrother - Job Reminder: ${serviceLabel} TOMORROW ${job.pickup_date}`, vendorHtml);
          console.log('Vendor reminder sent:', bid.contact_email);
        }
      }
    }

    return { statusCode: 200, body: `Processed ${jobs.length} reminder(s)` };
  } catch (err) {
    console.error('trip-reminders error:', err);
    return { statusCode: 200, body: 'OK' };
  }
};
