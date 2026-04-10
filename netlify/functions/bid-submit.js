/**
 * POST /.netlify/functions/bid-submit
 * Vendor submits a bid on a job
 */
const { supabaseQuery, ok, err, options } = require('./supabase-config');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.BUSBROTHER_FROM_EMAIL || 'onboarding@resend.dev';
const NOTIFY_EMAILS = (process.env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return err('Invalid JSON'); }

  const { token, company_name, contact_name, contact_email, contact_phone, total_price, vehicle_type, vehicle_year, vehicle_capacity, driver_name, insurance_info, notes } = body;

  // Validate required fields
  if (!token) return err('Missing job token');
  if (!company_name) return err('Company name required');
  if (!contact_name) return err('Contact name required');
  if (!contact_email) return err('Contact email required');
  if (!total_price || isNaN(total_price)) return err('Valid price required');
  if (!vehicle_type) return err('Vehicle type required');

  // Look up job by token
  const job = await supabaseQuery(
    `bb_jobs?vendor_token=eq.${encodeURIComponent(token)}&select=id,status,service,pickup_date,passengers,pickup_location,dropoff_location,customer_name`
  );

  if (!job.ok || !job.data || job.data.length === 0) return err('Job not found', 404);
  if (job.data[0].status !== 'open') return err('This job is no longer accepting bids');

  const jobData = job.data[0];

  // Insert bid
  const bid = await supabaseQuery('bb_bids', 'POST', {
    job_id: jobData.id,
    company_name,
    contact_name,
    contact_email,
    contact_phone: contact_phone || null,
    total_price: parseFloat(total_price),
    vehicle_type,
    vehicle_year: vehicle_year || null,
    vehicle_capacity: vehicle_capacity || null,
    driver_name: driver_name || null,
    insurance_info: insurance_info || null,
    notes: notes || null
  });

  if (!bid.ok) return err('Failed to submit bid');

  // Notify Mark about the new bid
  if (RESEND_API_KEY) {
    const subject = `[BusBrother] New Bid: $${parseFloat(total_price).toFixed(2)} from ${company_name}`;
    const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
      <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
      <p style="color:#8a9ab5;font-size:12px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;">New Vendor Bid Received</p>
    </div>
    <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
      <div style="background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3);border-radius:6px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;color:#2ecc71;font-size:20px;font-weight:700;">$${parseFloat(total_price).toFixed(2)}</p>
        <p style="margin:4px 0 0;color:#f8f6f0;font-size:14px;">from ${company_name}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
        <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;width:140px;">Company</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${company_name}</td></tr>
        <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Contact</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${contact_name} - ${contact_email}${contact_phone ? ' - ' + contact_phone : ''}</td></tr>
        <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Vehicle</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${vehicle_type}${vehicle_year ? ' (' + vehicle_year + ')' : ''}${vehicle_capacity ? ' - ' + vehicle_capacity + ' pax' : ''}</td></tr>
        ${driver_name ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Driver</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${driver_name}</td></tr>` : ''}
        ${insurance_info ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Insurance</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${insurance_info}</td></tr>` : ''}
        ${notes ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Notes</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${notes}</td></tr>` : ''}
        <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #1e3052;">Job</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${jobData.service || ''} | ${jobData.pickup_date || ''} | ${jobData.passengers || ''} pax | ${jobData.pickup_location || ''} to ${jobData.dropoff_location || ''}</td></tr>
      </table>
    </div>
    <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
      <a href="mailto:${contact_email}?subject=BusBrother%20Job%20-%20Bid%20Accepted" style="display:inline-block;background:#2ecc71;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Accept This Bid</a>
      <a href="https://busbrother.com/admin/jobs/" style="display:inline-block;background:transparent;border:1px solid #1e3052;color:#f8f6f0;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-left:10px;">View All Bids</a>
    </div>
  </div>
</body></html>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: NOTIFY_EMAILS, subject, html })
    }).catch(e => console.error('Bid notification email error:', e));
  }

  return ok({ success: true, message: 'Bid submitted successfully' });
};
