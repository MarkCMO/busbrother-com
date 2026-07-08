// GET/POST /api/lead-status?secret=X&job_id=Y&vendor_id=Z&status=contacted
// BTM (or any vendor) clicks a button in email to report lead status.
// One-click mode (GET with ?status=X): records the status, redirects to a confirmation
// page with optional "add details" form.
// Form mode (GET with ?mode=form): shows a full detail-entry form.
// Detail submit mode (POST): records status + notes + dollar amounts.
import { supabase, sendEmail, adminOk, SERVICE_LABELS } from '../_shared/helpers.js';

const VALID_STATUSES = ['not_contacted', 'contacted', 'quoted', 'booked', 'lost', 'no_response'];

const STATUS_META = {
  contacted:      { emoji: '📞', label: 'Contacted',        color: '#3498db', bg: 'rgba(52,152,219,0.1)' },
  quoted:         { emoji: '💵', label: 'Quoted',           color: '#f5a623', bg: 'rgba(245,166,35,0.1)' },
  booked:         { emoji: '✅', label: 'BOOKED (WIN)',     color: '#2ecc71', bg: 'rgba(46,204,113,0.15)' },
  lost:           { emoji: '❌', label: 'Lost',             color: '#e74c3c', bg: 'rgba(231,76,60,0.1)' },
  no_response:    { emoji: '🔇', label: 'No Response',      color: '#8a9ab5', bg: 'rgba(138,154,181,0.1)' },
  not_contacted:  { emoji: '⏳', label: 'Not Yet Contacted', color: '#8a9ab5', bg: 'rgba(138,154,181,0.1)' }
};

function page(title, bodyHtml, statusColor = 'green') {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title} | BusBrother</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#060e1c;color:#f8f6f0;font-family:Arial,sans-serif;min-height:100vh;padding:2rem 1rem;line-height:1.5}
.container{max-width:640px;margin:0 auto}
.card{background:#0a1628;border:1px solid #1e3052;border-radius:8px;padding:2rem;margin-bottom:1rem}
h1{font-size:1.8rem;letter-spacing:3px;color:#f8f6f0;text-align:center;margin-bottom:0.5rem}
h1 span{color:#f5a623}
h2{font-size:1.4rem;color:#f5a623;margin:1rem 0}
p{color:#8a9ab5;font-size:0.95rem;margin-bottom:0.8rem}
.status-icon{font-size:4rem;text-align:center;margin:1rem 0}
.status-label{color:${statusColor === 'green' ? '#2ecc71' : (statusColor === 'red' ? '#e74c3c' : '#f5a623')};font-size:1.2rem;font-weight:700;text-align:center;letter-spacing:1px;text-transform:uppercase}
label{display:block;color:#f5a623;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:0.4rem;margin-top:1rem}
input,textarea,select{width:100%;background:#0a1628;color:#f8f6f0;border:1px solid #1e3052;padding:10px 12px;border-radius:4px;font-family:inherit;font-size:14px}
textarea{min-height:80px;resize:vertical}
button,.btn{display:inline-block;background:#f5a623;color:#060e1c;border:none;padding:12px 28px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;text-decoration:none;margin-top:1rem}
.btn-outline{background:transparent;border:1px solid #f5a623;color:#f5a623}
.btn-row{display:flex;gap:0.8rem;flex-wrap:wrap;justify-content:center;margin-top:1rem}
.info-row{padding:0.6rem 0;border-bottom:1px solid #1e3052;display:flex;gap:1rem}
.info-row:last-child{border-bottom:none}
.info-label{color:#f5a623;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;min-width:100px}
.info-val{color:#f8f6f0;font-size:14px}
</style></head>
<body><div class="container">
<h1>BUS<span>BROTHER</span></h1>
${bodyHtml}
</div></body></html>`;
}

function needField(status) {
  if (status === 'quoted') return { field: 'quoted_amount_dollars', label: 'Quoted amount (USD)', type: 'number', required: true };
  if (status === 'booked') return { field: 'final_amount_dollars', label: 'Final booked amount (USD)', type: 'number', required: true };
  if (status === 'lost')   return { field: 'lost_reason', label: 'Reason lost (e.g. price too high, customer went with competitor, wrong date)', type: 'text', required: true };
  return null;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  // Auth - accept BUSBROTHER_ADMIN_SECRET (Mark can also update on BTM's behalf)
  if (!adminOk(url, env)) {
    return new Response(page('Unauthorized', '<div class="card"><h2>Unauthorized</h2><p>This link is missing a valid secret. Contact info@busbrother.com if you need help.</p></div>', 'red'), {
      status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  const jobId = url.searchParams.get('job_id');
  const vendorId = url.searchParams.get('vendor_id');
  const status = url.searchParams.get('status');
  const mode = url.searchParams.get('mode');

  if (!jobId || !vendorId) {
    return new Response(page('Error', '<div class="card"><h2>Missing IDs</h2><p>The link is missing job_id or vendor_id.</p></div>', 'red'), {
      status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // Look up job + vendor
  const jRes = await supabase(env, `bb_jobs?id=eq.${jobId}&select=*`);
  if (!jRes.ok || !jRes.data || !jRes.data.length) {
    return new Response(page('Not Found', '<div class="card"><h2>Job not found</h2></div>', 'red'), {
      status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  const job = jRes.data[0];
  const vRes = await supabase(env, `bb_vendors?id=eq.${vendorId}&select=id,company_name,email`);
  if (!vRes.ok || !vRes.data || !vRes.data.length) {
    return new Response(page('Not Found', '<div class="card"><h2>Vendor not found</h2></div>', 'red'), {
      status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  const vendor = vRes.data[0];
  const serviceLabel = SERVICE_LABELS[job.service] || job.service || 'Charter Bus';

  // POST: full form submission with amounts + notes
  if (request.method === 'POST') {
    let form;
    try {
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('application/json')) form = await request.json();
      else {
        const fd = await request.formData();
        form = Object.fromEntries(fd.entries());
      }
    } catch (e) {
      return new Response(page('Error', '<div class="card"><h2>Invalid form data</h2></div>', 'red'), {
        status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    const s = form.status;
    if (!VALID_STATUSES.includes(s)) {
      return new Response(page('Error', '<div class="card"><h2>Invalid status</h2></div>', 'red'), {
        status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    const payload = {
      job_id: jobId,
      vendor_id: vendorId,
      status: s,
      updated_by_email: form.updated_by_email || vendor.email,
      notes: form.notes || null,
      lost_reason: form.lost_reason || null,
      quoted_amount_cents: form.quoted_amount_dollars ? Math.round(parseFloat(form.quoted_amount_dollars) * 100) : null,
      final_amount_cents: form.final_amount_dollars ? Math.round(parseFloat(form.final_amount_dollars) * 100) : null
    };
    await supabase(env, 'bb_lead_vendor_status', 'POST', payload);

    // If booked, flip job status too
    if (s === 'booked') {
      await supabase(env, `bb_jobs?id=eq.${jobId}`, 'PATCH', { status: 'awarded' });
    }

    const meta = STATUS_META[s] || STATUS_META.contacted;
    // Notify Mark that status was updated
    try {
      const notifyEmails = (env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
      const markEmails = notifyEmails.filter(e => !/btmcoach\.com$/i.test(e) && e !== 'info@busbrother.com');
      if (markEmails.length) {
        const dollars = payload.final_amount_cents ? '$' + (payload.final_amount_cents / 100).toFixed(2)
                       : payload.quoted_amount_cents ? '$' + (payload.quoted_amount_cents / 100).toFixed(2) : '';
        await sendEmail(env, {
          to: markEmails,
          subject: `[BusBrother] ${vendor.company_name} marked "${meta.label}" ${dollars} - ${serviceLabel} - ${job.customer_name || ''}`,
          html: `<div style="background:#060e1c;color:#f8f6f0;padding:2rem;font-family:Arial,sans-serif;"><h2 style="color:${meta.color};">${meta.emoji} ${meta.label} ${dollars}</h2>
          <p><strong>Vendor:</strong> ${vendor.company_name}</p>
          <p><strong>Job:</strong> ${serviceLabel} | ${job.pickup_date || ''} | ${job.passengers || ''} pax | ${job.customer_name || ''}</p>
          ${payload.notes ? `<p><strong>Notes:</strong> ${payload.notes}</p>` : ''}
          ${payload.lost_reason ? `<p><strong>Lost reason:</strong> ${payload.lost_reason}</p>` : ''}
          </div>`
        });
      }
    } catch (e) {}

    return new Response(page(meta.label, `
<div class="card">
  <div class="status-icon">${meta.emoji}</div>
  <p class="status-label">${meta.label}</p>
  <p style="text-align:center;margin-top:1rem;">Status updated for <strong style="color:#f5a623;">${vendor.company_name}</strong> on this lead.</p>
  <p style="text-align:center;color:#8a9ab5;font-size:12px;margin-top:1rem;">${serviceLabel} · ${job.pickup_date || ''} · ${job.passengers || ''} pax · ${job.customer_name || ''}</p>
</div>`, s === 'booked' ? 'green' : s === 'lost' ? 'red' : 'green'), {
      status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // GET with ?mode=form -> show detailed form
  // GET with ?status=X (no mode) -> if status requires an amount, show mini form; else record immediately
  if (mode === 'form' || (status && needField(status))) {
    const preselect = status || '';
    const need = status ? needField(status) : null;
    return new Response(page('Update Lead Status', `
<div class="card">
  <h2>Update lead status</h2>
  <div class="info-row"><span class="info-label">Vendor</span><span class="info-val">${vendor.company_name}</span></div>
  <div class="info-row"><span class="info-label">Service</span><span class="info-val">${serviceLabel}</span></div>
  <div class="info-row"><span class="info-label">Customer</span><span class="info-val">${job.customer_name || ''}</span></div>
  <div class="info-row"><span class="info-label">Trip Date</span><span class="info-val">${job.pickup_date || 'TBD'}</span></div>
  <div class="info-row"><span class="info-label">Passengers</span><span class="info-val">${job.passengers || 'TBD'}</span></div>

  <form method="POST" action="${url.pathname}${url.search}">
    <label for="status">Status</label>
    <select name="status" id="status" required>
      <option value="">Select status...</option>
      <option value="contacted" ${preselect === 'contacted' ? 'selected' : ''}>📞 Contacted the customer</option>
      <option value="quoted" ${preselect === 'quoted' ? 'selected' : ''}>💵 Sent a quote</option>
      <option value="booked" ${preselect === 'booked' ? 'selected' : ''}>✅ BOOKED (customer accepted)</option>
      <option value="lost" ${preselect === 'lost' ? 'selected' : ''}>❌ Lost (customer went elsewhere)</option>
      <option value="no_response" ${preselect === 'no_response' ? 'selected' : ''}>🔇 Customer went silent</option>
    </select>

    <label for="quoted_amount_dollars">Quoted amount (if quoted)</label>
    <input type="number" step="0.01" name="quoted_amount_dollars" id="quoted_amount_dollars" placeholder="e.g. 1200.00" value="${preselect === 'quoted' && need ? '' : ''}"/>

    <label for="final_amount_dollars">Final booked amount (if booked)</label>
    <input type="number" step="0.01" name="final_amount_dollars" id="final_amount_dollars" placeholder="e.g. 1350.00"/>

    <label for="lost_reason">If lost, why?</label>
    <input type="text" name="lost_reason" id="lost_reason" placeholder="e.g. Price too high, went with competitor, changed plans"/>

    <label for="notes">Notes (customer preferences, follow-up needed, etc.)</label>
    <textarea name="notes" id="notes" placeholder="Any additional context for Mark"></textarea>

    <label for="updated_by_email">Your email</label>
    <input type="email" name="updated_by_email" id="updated_by_email" value="${vendor.email}" required/>

    <div class="btn-row">
      <button type="submit">Save Status Update &rarr;</button>
    </div>
  </form>
</div>`), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // Fast path: one-click status (no amount required — contacted / no_response / not_contacted)
  if (status && VALID_STATUSES.includes(status)) {
    await supabase(env, 'bb_lead_vendor_status', 'POST', {
      job_id: jobId, vendor_id: vendorId, status,
      updated_by_email: vendor.email,
      notes: `Recorded via one-click button from digest email.`
    });

    const meta = STATUS_META[status] || STATUS_META.contacted;
    return new Response(page(meta.label, `
<div class="card">
  <div class="status-icon">${meta.emoji}</div>
  <p class="status-label">${meta.label}</p>
  <p style="text-align:center;margin-top:1rem;">Status recorded for <strong style="color:#f5a623;">${vendor.company_name}</strong>.</p>
  <p style="text-align:center;color:#8a9ab5;font-size:12px;margin-top:1rem;">${serviceLabel} · ${job.pickup_date || ''} · ${job.customer_name || ''}</p>
  <div class="btn-row">
    <a href="${url.pathname}?job_id=${jobId}&vendor_id=${vendorId}&secret=${env.BUSBROTHER_ADMIN_SECRET}&mode=form" class="btn btn-outline">Add notes / dollar amount &rarr;</a>
  </div>
</div>`), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // Fallback: show the form
  return new Response(page('Update Lead Status', `
<div class="card">
  <h2>Update lead status</h2>
  <p>Click a button in the accountability email, or use the form below.</p>
  <p><a href="${url.pathname}?job_id=${jobId}&vendor_id=${vendorId}&secret=${env.BUSBROTHER_ADMIN_SECRET}&mode=form">Open the detailed form &rarr;</a></p>
</div>`), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
