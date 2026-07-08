// GET /api/weekly-digest?secret=X[&vendor_email=X][&days=30][&test=1]
// Weekly Friday accountability email listing all leads assigned to BTM (or any vendor)
// that don't have a final status of "booked" or "lost".
// Includes per-lead status update buttons + 30/90-day closing-rate stats.
//
// Params:
//   secret        - BUSBROTHER_ADMIN_SECRET (required)
//   vendor_email  - target vendor's email (default: sales@btmcoach.com)
//   days          - look-back window in days (default 30)
//   test          - if =1, send only to Mark (not BTM); useful for previewing
//
// Cron trigger: busbrother-cron Worker fires this Fridays 13:00 UTC (8am ET DST).
// Manual trigger: Mark can hit the URL any time to send a fresh digest.
import { json, errResponse, supabase, sendEmail, adminOk, SERVICE_LABELS } from '../_shared/helpers.js';

const BTM_EMAIL_ADDRESSES = 'sales@btmcoach.com,bill@btmcoach.com';

const STATUS_META = {
  contacted:      { emoji: '📞', label: 'Contacted',        color: '#3498db' },
  quoted:         { emoji: '💵', label: 'Quoted',           color: '#f5a623' },
  booked:         { emoji: '✅', label: 'BOOKED',           color: '#2ecc71' },
  lost:           { emoji: '❌', label: 'Lost',             color: '#e74c3c' },
  no_response:    { emoji: '🔇', label: 'No Response',      color: '#8a9ab5' },
  not_contacted:  { emoji: '⏳', label: 'Not Contacted',    color: '#e74c3c' }
};

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  } catch { return iso; }
}
function daysAgo(iso) {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (24 * 3600 * 1000));
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!adminOk(url, env)) return errResponse('Unauthorized', 401);

  const vendorEmail = (url.searchParams.get('vendor_email') || 'sales@btmcoach.com').toLowerCase();
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  const testMode = url.searchParams.get('test') === '1';

  // Resolve vendor
  const vRes = await supabase(env, `bb_vendors?email=eq.${encodeURIComponent(vendorEmail)}&select=id,company_name,contact_name,email`);
  if (!vRes.ok || !vRes.data || !vRes.data.length) return errResponse(`Vendor not found: ${vendorEmail}`, 404);
  const vendor = vRes.data[0];

  const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // Get all jobs assigned to this vendor within lookback window
  const jRes = await supabase(env,
    `bb_jobs?assigned_vendor_id=eq.${vendor.id}&created_at=gte.${sinceIso}&select=id,created_at,assigned_at,status,service,trip_type,pickup_date,passengers,pickup_location,dropoff_location,customer_name,customer_email,customer_phone,notes&order=created_at.desc`
  );
  if (!jRes.ok) return errResponse('Failed to fetch jobs', 500);
  const allJobs = jRes.data || [];

  // Get current status for each job (from the view)
  const statusRes = await supabase(env,
    `bb_lead_vendor_status_current?vendor_id=eq.${vendor.id}&select=job_id,status,quoted_amount_cents,final_amount_cents,lost_reason,notes,updated_at`
  );
  const statusByJob = {};
  if (statusRes.ok && statusRes.data) {
    for (const s of statusRes.data) statusByJob[s.job_id] = s;
  }

  // Attach status + filter out closed jobs (booked / lost)
  const openJobs = [];
  const closedJobs = [];
  for (const job of allJobs) {
    const s = statusByJob[job.id] || { status: 'not_contacted' };
    job._currentStatus = s.status;
    job._quotedCents = s.quoted_amount_cents;
    job._finalCents = s.final_amount_cents;
    job._lostReason = s.lost_reason;
    job._statusNotes = s.notes;
    job._statusUpdatedAt = s.updated_at;
    if (s.status === 'booked' || s.status === 'lost') closedJobs.push(job);
    else openJobs.push(job);
  }

  // Compute stats
  const totalAssigned = allJobs.length;
  const booked = closedJobs.filter(j => j._currentStatus === 'booked');
  const lost = closedJobs.filter(j => j._currentStatus === 'lost');
  const bookedRevenue = booked.reduce((n, j) => n + (j._finalCents || 0), 0) / 100;
  const closingRate = totalAssigned > 0 ? Math.round((booked.length / totalAssigned) * 100) : 0;
  const responseRate = totalAssigned > 0 ? Math.round(((totalAssigned - allJobs.filter(j => j._currentStatus === 'not_contacted').length) / totalAssigned) * 100) : 0;
  const notContactedCount = openJobs.filter(j => j._currentStatus === 'not_contacted').length;

  const adminSecret = env.BUSBROTHER_ADMIN_SECRET;
  const statusUrl = (jobId, s) => `https://busbrother.com/api/lead-status?job_id=${jobId}&vendor_id=${vendor.id}&secret=${adminSecret}&status=${s}`;
  const formUrl   = (jobId)    => `https://busbrother.com/api/lead-status?job_id=${jobId}&vendor_id=${vendor.id}&secret=${adminSecret}&mode=form`;

  // Build open-lead rows
  const openRows = openJobs.map(job => {
    const serviceLabel = SERVICE_LABELS[job.service] || job.service || 'Charter Bus';
    const meta = STATUS_META[job._currentStatus] || STATUS_META.not_contacted;
    const daysAssigned = daysAgo(job.assigned_at || job.created_at);
    const overdue = daysAssigned >= 3 && job._currentStatus === 'not_contacted';
    return `
<div style="background:#0a1628;border:1px solid ${overdue ? '#e74c3c' : '#1e3052'};border-radius:6px;padding:16px;margin-bottom:12px;">
  <div style="display:flex;justify-content:space-between;gap:1rem;margin-bottom:10px;">
    <div>
      <div style="color:#f5a623;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">${serviceLabel}</div>
      <div style="color:#f8f6f0;font-size:14px;margin-top:3px;">${job.customer_name || 'Customer'} · ${job.passengers || '?'} pax · ${fmtDate(job.pickup_date)}</div>
      <div style="color:#8a9ab5;font-size:12px;margin-top:3px;">${job.pickup_location || 'TBD'} → ${job.dropoff_location || 'TBD'}</div>
    </div>
    <div style="text-align:right;flex-shrink:0;">
      <div style="color:${meta.color};font-size:12px;font-weight:700;">${meta.emoji} ${meta.label}</div>
      <div style="color:${overdue ? '#e74c3c' : '#8a9ab5'};font-size:11px;margin-top:3px;">${daysAssigned}d ago${overdue ? ' · OVERDUE' : ''}</div>
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-top:10px;font-size:12px;">
    <a href="mailto:${job.customer_email}?subject=BusBrother%20-%20${encodeURIComponent(serviceLabel)}%20quote" style="color:#f5a623;text-decoration:none;flex:1;background:rgba(245,166,35,0.08);padding:8px;border-radius:4px;text-align:center;">Email</a>
    ${job.customer_phone ? `<a href="tel:${job.customer_phone}" style="color:#f5a623;text-decoration:none;flex:1;background:rgba(245,166,35,0.08);padding:8px;border-radius:4px;text-align:center;">Call</a>` : ''}
  </div>
  <div style="display:flex;gap:6px;margin-top:8px;">
    <a href="${statusUrl(job.id, 'contacted')}" style="flex:1;background:#3498db;color:#fff;padding:8px 4px;border-radius:4px;text-decoration:none;font-weight:700;font-size:11px;text-align:center;">📞 Contacted</a>
    <a href="${statusUrl(job.id, 'quoted')}" style="flex:1;background:#f5a623;color:#060e1c;padding:8px 4px;border-radius:4px;text-decoration:none;font-weight:700;font-size:11px;text-align:center;">💵 Quoted</a>
    <a href="${statusUrl(job.id, 'booked')}" style="flex:1;background:#2ecc71;color:#fff;padding:8px 4px;border-radius:4px;text-decoration:none;font-weight:700;font-size:11px;text-align:center;">✅ Booked</a>
    <a href="${statusUrl(job.id, 'lost')}" style="flex:1;background:#e74c3c;color:#fff;padding:8px 4px;border-radius:4px;text-decoration:none;font-weight:700;font-size:11px;text-align:center;">❌ Lost</a>
  </div>
  <div style="text-align:center;margin-top:6px;">
    <a href="${formUrl(job.id)}" style="color:#8a9ab5;font-size:11px;text-decoration:none;">Detailed update (add amount + notes) →</a>
  </div>
</div>`;
  }).join('');

  const closedRows = closedJobs.slice(0, 10).map(job => {
    const serviceLabel = SERVICE_LABELS[job.service] || job.service || 'Charter Bus';
    const meta = STATUS_META[job._currentStatus] || STATUS_META.not_contacted;
    const dollars = job._finalCents ? '$' + (job._finalCents / 100).toFixed(2) : job._quotedCents ? '$' + (job._quotedCents / 100).toFixed(2) : '';
    return `
<tr>
  <td style="padding:8px 12px;color:#f8f6f0;font-size:13px;border-bottom:1px solid #1e3052;">${job.customer_name || ''}</td>
  <td style="padding:8px 12px;color:#8a9ab5;font-size:12px;border-bottom:1px solid #1e3052;">${serviceLabel}</td>
  <td style="padding:8px 12px;color:${meta.color};font-size:13px;font-weight:700;border-bottom:1px solid #1e3052;">${meta.emoji} ${meta.label}</td>
  <td style="padding:8px 12px;color:${job._finalCents ? '#2ecc71' : '#f8f6f0'};font-size:13px;font-weight:${job._finalCents ? '700' : '400'};border-bottom:1px solid #1e3052;text-align:right;">${dollars}</td>
</tr>`;
  }).join('');

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

  const digestHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:680px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#f5a623;font-size:14px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;font-weight:700;">Weekly Accountability Digest · ${vendor.company_name}</p>
    <p style="color:#8a9ab5;font-size:12px;margin:4px 0 0;">${dateStr}</p>
  </div>

  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">

    <!-- Stats block -->
    <div style="display:table;width:100%;background:#0a1628;border:1px solid #1e3052;border-radius:6px;padding:20px;margin-bottom:20px;">
      <div style="display:table-row;">
        <div style="display:table-cell;text-align:center;padding:10px 6px;">
          <div style="color:#f5a623;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Assigned (${days}d)</div>
          <div style="color:#f8f6f0;font-size:24px;font-weight:700;margin-top:4px;">${totalAssigned}</div>
        </div>
        <div style="display:table-cell;text-align:center;padding:10px 6px;">
          <div style="color:#f5a623;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Booked</div>
          <div style="color:#2ecc71;font-size:24px;font-weight:700;margin-top:4px;">${booked.length}</div>
        </div>
        <div style="display:table-cell;text-align:center;padding:10px 6px;">
          <div style="color:#f5a623;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Closing Rate</div>
          <div style="color:${closingRate >= 30 ? '#2ecc71' : (closingRate >= 15 ? '#f5a623' : '#e74c3c')};font-size:24px;font-weight:700;margin-top:4px;">${closingRate}%</div>
        </div>
        <div style="display:table-cell;text-align:center;padding:10px 6px;">
          <div style="color:#f5a623;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Booked Rev</div>
          <div style="color:#2ecc71;font-size:22px;font-weight:700;margin-top:4px;">$${bookedRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>
    </div>

    ${notContactedCount > 0 ? `<div style="background:rgba(231,76,60,0.12);border:2px solid #e74c3c;border-radius:6px;padding:14px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;color:#e74c3c;font-size:14px;font-weight:700;">⚠️ ${notContactedCount} LEAD${notContactedCount === 1 ? '' : 'S'} NOT YET CONTACTED</p>
      <p style="margin:6px 0 0;color:#f8f6f0;font-size:12px;">Response expectation: 2 hours during business hours. Overdue leads (3+ days) are flagged red below.</p>
    </div>` : ''}

    <h3 style="color:#f5a623;font-size:16px;margin:0 0 12px;">Open leads awaiting status update (${openJobs.length})</h3>
    ${openJobs.length ? openRows : '<p style="color:#8a9ab5;padding:20px;text-align:center;background:#0a1628;border-radius:6px;">No open leads. Great work — everything is closed.</p>'}

    ${closedJobs.length ? `<h3 style="color:#f5a623;font-size:16px;margin:24px 0 12px;">Recently closed leads (${closedJobs.length} in last ${days}d)</h3>
    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
      <thead>
        <tr style="background:#111d33;">
          <th style="padding:10px 12px;color:#8a9ab5;font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:left;">Customer</th>
          <th style="padding:10px 12px;color:#8a9ab5;font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:left;">Service</th>
          <th style="padding:10px 12px;color:#8a9ab5;font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:left;">Result</th>
          <th style="padding:10px 12px;color:#8a9ab5;font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>${closedRows}</tbody>
    </table>` : ''}

    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:16px;margin-top:24px;">
      <p style="margin:0;color:#f5a623;font-size:13px;font-weight:600;">Why this email?</p>
      <p style="margin:6px 0 0;color:#f8f6f0;font-size:12px;line-height:1.6;">BusBrother sends this every Friday to hold ${vendor.company_name} accountable to closing the leads we assign. Any lead not marked Booked or Lost will keep appearing here. Consistently strong closing rates keep you as our preferred Founding Carrier. Weak closing rates trigger a network review.</p>
    </div>

  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <p style="color:#8a9ab5;font-size:12px;margin:0;">Questions about the digest? Reply to this email or contact info@busbrother.com.</p>
    <p style="color:#8a9ab5;font-size:11px;margin:8px 0 0;">BusBrother · Cape Canaveral, Brevard County, Florida · busbrother.com</p>
  </div>
</div></body></html>`;

  // Recipients
  const notifyEmails = (env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
  const markEmails = notifyEmails.filter(e => !/btmcoach\.com$/i.test(e) && e !== 'info@busbrother.com');
  const btmEmails = BTM_EMAIL_ADDRESSES.split(',').map(e => e.trim());
  const recipients = testMode
    ? markEmails
    : [...new Set([...btmEmails, ...markEmails])];

  await sendEmail(env, {
    to: recipients,
    subject: `[BusBrother] Weekly Accountability Digest — ${vendor.company_name} — ${totalAssigned} leads / ${closingRate}% closing rate`,
    html: digestHtml,
    replyTo: 'info@busbrother.com'
  });

  return json({
    success: true,
    vendor: vendor.company_name,
    total_assigned: totalAssigned,
    open_leads: openJobs.length,
    booked: booked.length,
    lost: lost.length,
    closing_rate_pct: closingRate,
    booked_revenue_dollars: bookedRevenue,
    not_contacted_overdue: notContactedCount,
    test_mode: testMode,
    recipients
  });
}
