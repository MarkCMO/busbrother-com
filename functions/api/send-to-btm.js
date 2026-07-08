// GET/POST /api/send-to-btm?secret=X&job_id=Y
// Mark clicks "SEND TO BTM COACH" button in the lead notification email.
// Assigns lead exclusively to BTM Coaches (sales@btmcoach.com), flips job to 'open',
// creates initial 'not_contacted' status row, and emails BTM the handoff with quick-status buttons.
import { html, supabase, sendEmail, adminOk, adminPage, SERVICE_LABELS } from '../_shared/helpers.js';

const BTM_EMAIL_ADDRESSES = 'sales@btmcoach.com,bill@btmcoach.com';

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!adminOk(url, env)) return html(adminPage('Unauthorized', 'Invalid admin secret.', 'red'), 401);
  const jobId = url.searchParams.get('job_id');
  if (!jobId) return html(adminPage('Error', 'Missing job ID.', 'red'), 400);

  // Look up job
  const j = await supabase(env, `bb_jobs?id=eq.${jobId}&select=*`);
  if (!j.ok || !j.data || !j.data.length) return html(adminPage('Not Found', 'Job not found.', 'red'), 404);
  const job = j.data[0];

  // Look up BTM vendor row
  const v = await supabase(env, 'bb_vendors?email=eq.sales@btmcoach.com&select=id,company_name,contact_name,email&limit=1');
  if (!v.ok || !v.data || !v.data.length) {
    return html(adminPage('BTM Not Found', 'BTM Coaches is not in bb_vendors. Ensure sales@btmcoach.com row exists.', 'red'), 404);
  }
  const btm = v.data[0];

  if (job.status === 'awarded' || job.status === 'paid') {
    return html(adminPage('Already Processed', `This job is already "${job.status}". No action needed.`, 'green'));
  }

  // Flip status to open and assign to BTM
  await supabase(env, `bb_jobs?id=eq.${jobId}`, 'PATCH', {
    status: 'open',
    assigned_vendor_id: btm.id,
    assigned_at: new Date().toISOString(),
    assigned_by: 'mark'
  });

  // Initial status row: not_contacted
  await supabase(env, 'bb_lead_vendor_status', 'POST', {
    job_id: jobId,
    vendor_id: btm.id,
    status: 'not_contacted',
    updated_by_email: 'system',
    notes: 'Auto-created when Mark assigned lead to BTM.'
  });

  const adminSecret = env.BUSBROTHER_ADMIN_SECRET;
  const serviceLabel = SERVICE_LABELS[job.service] || job.service || 'Charter Bus';

  // Per-status update links (signed with admin secret so BTM can click without login)
  const statusUrl = (s) => `https://busbrother.com/api/lead-status?job_id=${jobId}&vendor_id=${btm.id}&secret=${adminSecret}&status=${s}`;
  const detailFormUrl = `https://busbrother.com/api/lead-status?job_id=${jobId}&vendor_id=${btm.id}&secret=${adminSecret}&mode=form`;

  const btmHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#2ecc71;font-size:14px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;font-weight:700;">LEAD ASSIGNED TO BTM COACHES</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <p style="color:#f8f6f0;font-size:15px;margin:0 0 12px;">Hi BTM team,</p>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;">Mark has assigned you this lead directly. Contact the customer within 2 hours and update the status by clicking one of the buttons below.</p>

    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:16px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;color:#f5a623;font-size:18px;font-weight:700;">${serviceLabel}</p>
      <p style="margin:8px 0 0;color:#f8f6f0;font-size:14px;">${job.pickup_location || 'TBD'} &rarr; ${job.dropoff_location || 'TBD'}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;width:120px;">Customer</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.customer_name || 'N/A'}</td></tr>
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Email</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;"><a href="mailto:${job.customer_email}?subject=BusBrother%20-%20${encodeURIComponent(serviceLabel)}%20quote" style="color:#f5a623;">${job.customer_email || 'N/A'}</a></td></tr>
      <tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Phone</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;"><a href="tel:${job.customer_phone}" style="color:#f5a623;">${job.customer_phone || 'N/A'}</a></td></tr>
      ${job.pickup_date ? `<tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Trip Date</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.pickup_date}</td></tr>` : ''}
      ${job.passengers ? `<tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Passengers</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.passengers}</td></tr>` : ''}
      ${job.trip_type ? `<tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Trip Type</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.trip_type}</td></tr>` : ''}
      ${job.ada_accessible ? '<tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">ADA</td><td style="padding:8px 16px;color:#2ecc71;font-size:14px;border-bottom:1px solid #1e3052;">Wheelchair Accessible Required</td></tr>` : ''}
      ${job.notes ? `<tr><td style="padding:8px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;vertical-align:top;">Notes</td><td style="padding:8px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${job.notes}</td></tr>` : ''}
    </table>

    <div style="background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.3);border-radius:6px;padding:16px;margin-top:20px;">
      <p style="margin:0 0 12px;color:#2ecc71;font-size:14px;font-weight:600;text-align:center;">UPDATE STATUS (one click - required for accountability):</p>
      <table style="width:100%;">
        <tr>
          <td style="text-align:center;padding:4px;"><a href="${statusUrl('contacted')}" style="display:inline-block;background:#3498db;color:#fff;padding:10px 8px;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px;width:100%;box-sizing:border-box;text-align:center;">📞 Contacted</a></td>
          <td style="text-align:center;padding:4px;"><a href="${statusUrl('quoted')}" style="display:inline-block;background:#f5a623;color:#060e1c;padding:10px 8px;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px;width:100%;box-sizing:border-box;text-align:center;">💵 Quoted</a></td>
        </tr>
        <tr>
          <td style="text-align:center;padding:4px;"><a href="${statusUrl('booked')}" style="display:inline-block;background:#2ecc71;color:#fff;padding:10px 8px;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px;width:100%;box-sizing:border-box;text-align:center;">✅ BOOKED</a></td>
          <td style="text-align:center;padding:4px;"><a href="${statusUrl('lost')}" style="display:inline-block;background:#e74c3c;color:#fff;padding:10px 8px;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px;width:100%;box-sizing:border-box;text-align:center;">❌ Lost</a></td>
        </tr>
        <tr>
          <td colspan="2" style="text-align:center;padding:8px 4px 0;"><a href="${detailFormUrl}" style="color:#8a9ab5;font-size:12px;text-decoration:none;">Add detailed notes + dollar amount →</a></td>
        </tr>
      </table>
    </div>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <p style="color:#8a9ab5;font-size:12px;margin:0 0 12px;">Weekly accountability email every Friday will list any leads not marked Booked or Lost. Response expected within 2 hours during business hours.</p>
    <a href="mailto:${job.customer_email}?subject=BusBrother%20-%20${encodeURIComponent(serviceLabel)}%20quote" style="display:inline-block;background:#f5a623;color:#060e1c;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;">Email Customer Now</a>
  </div>
</div></body></html>`;

  const notifyEmails = (env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
  // BTM recipients + Mark's addresses (not info@busbrother.com since it's a general vendor blast style email)
  const markEmails = notifyEmails.filter(e => !/btmcoach\.com$/i.test(e) && e !== 'info@busbrother.com');
  const btmEmails = BTM_EMAIL_ADDRESSES.split(',').map(e => e.trim());
  const allRecipients = [...new Set([...btmEmails, ...markEmails])];

  await sendEmail(env, {
    to: allRecipients,
    subject: `[BusBrother] Lead Assigned to BTM: ${serviceLabel} - ${job.pickup_date || 'Date TBD'} - ${job.passengers || ''} pax - ${job.customer_name || ''}`,
    html: btmHtml,
    replyTo: 'info@busbrother.com'
  });

  return html(adminPage('Sent to BTM Coaches!', `Job assigned to BTM Coaches and email sent to ${btmEmails.join(', ')} + you.<br/><br/>BTM must update status (Contacted / Quoted / Booked / Lost) directly from that email. Any lead not marked "Booked" or "Lost" will appear on the Friday accountability digest.`, 'green'));
}
