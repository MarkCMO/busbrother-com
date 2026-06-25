// Admin API for jobs / bids / vendors
// GET  /api/jobs-admin?secret=X                       -> list jobs with bids
// GET  /api/jobs-admin?secret=X&job_id=ID             -> single job + bids
// POST /api/jobs-admin?secret=X&action=award&job_id=ID&bid_id=ID
// POST /api/jobs-admin?secret=X&action=close&job_id=ID
// POST /api/jobs-admin?secret=X&action=delete&job_id=ID
// GET  /api/jobs-admin?secret=X&resource=vendors      -> list vendors
// POST /api/jobs-admin?secret=X&resource=vendors&action=add  body={company_name,contact_name,email,phone}
// POST /api/jobs-admin?secret=X&resource=vendors&action=toggle&vendor_id=ID
// POST /api/jobs-admin?secret=X&resource=vendors&action=delete&vendor_id=ID
import { json, errResponse, optionsResponse, supabase, adminOk } from '../_shared/helpers.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse();
  const url = new URL(request.url);
  if (!adminOk(url, env)) return errResponse('Unauthorized', 401);

  const params = url.searchParams;
  const resource = params.get('resource');
  const action = params.get('action');

  // Vendor management
  if (resource === 'vendors') {
    if (request.method === 'GET') {
      const v = await supabase(env, 'bb_vendors?select=*&order=created_at.desc');
      return json({ vendors: v.ok && v.data ? v.data : [] });
    }
    if (request.method === 'POST') {
      if (action === 'add') {
        let body; try { body = await request.json(); } catch { return errResponse('Invalid JSON'); }
        if (!body.company_name || !body.contact_name || !body.email) return errResponse('Company name, contact name, and email required');
        const r = await supabase(env, 'bb_vendors', 'POST', {
          company_name: body.company_name, contact_name: body.contact_name,
          email: body.email, phone: body.phone || null, active: true
        });
        return r.ok ? json({ success: true }) : errResponse('Failed to add vendor');
      }
      if (action === 'toggle' && params.get('vendor_id')) {
        const id = params.get('vendor_id');
        const v = await supabase(env, `bb_vendors?id=eq.${id}&select=active`);
        if (!v.ok || !v.data || !v.data.length) return errResponse('Vendor not found');
        await supabase(env, `bb_vendors?id=eq.${id}`, 'PATCH', { active: !v.data[0].active });
        return json({ success: true });
      }
      if (action === 'delete' && params.get('vendor_id')) {
        await supabase(env, `bb_vendors?id=eq.${params.get('vendor_id')}`, 'DELETE');
        return json({ success: true });
      }
      // Carrier-signup approval flow
      if (action === 'approve' && params.get('vendor_id')) {
        const id = params.get('vendor_id');
        const v = await supabase(env, `bb_vendors?id=eq.${id}&select=*`);
        if (!v.ok || !v.data || !v.data.length) return errResponse('Vendor not found');
        const vendor = v.data[0];

        // Auto-grant Founding Carrier status if there are fewer than 5 existing founding carriers
        const existing = await supabase(env, 'bb_vendors?founding_carrier=eq.true&select=id');
        const foundingCount = (existing.ok && existing.data) ? existing.data.length : 0;
        const grantFounding = foundingCount < 5;

        const patch = { active: true, approved: true, approved_at: new Date().toISOString() };
        if (grantFounding) patch.founding_carrier = true;
        await supabase(env, `bb_vendors?id=eq.${id}`, 'PATCH', patch);

        // Email the carrier letting them know they're approved
        // Inline sendEmail to avoid extra import dependency
        const subject = grantFounding
          ? `[BusBrother] You're approved as a Founding Carrier! (${vendor.company_name})`
          : `[BusBrother] Your carrier application is approved! (${vendor.company_name})`;
        const approvalHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#2ecc71;font-size:14px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;font-weight:700;">CARRIER APPLICATION APPROVED</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <p style="color:#f8f6f0;font-size:15px;margin:0 0 16px;">Hi ${vendor.contact_name},</p>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;"><strong style="color:#2ecc71;">${vendor.company_name}</strong> has been approved to receive BusBrother leads. You'll start receiving lead emails for trips matching your service area immediately.</p>
    ${grantFounding ? `<div style="background:rgba(245,166,35,0.12);border:2px solid rgba(245,166,35,0.5);border-radius:6px;padding:20px;margin:0 0 20px;text-align:center;">
      <p style="margin:0;color:#f5a623;font-size:18px;font-weight:700;">🏆 FOUNDING CARRIER STATUS</p>
      <p style="margin:8px 0 0;color:#f8f6f0;font-size:13px;line-height:1.5;">You're one of our first 5 Founding Carriers. You receive lifetime free lead access — no per-lead fees, no commission, no monthly subscription, ever, regardless of how our pricing model evolves.</p>
    </div>` : ''}
    <h3 style="color:#f5a623;font-size:15px;margin:20px 0 8px;">How leads will arrive</h3>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 14px;">When a customer submits a quote request matching your service area, you'll receive an email titled "BusBrother — New Job: [Service] [Date] [Passengers]" with full customer details (name, email, phone), trip specs, and any special requirements. Contact the customer directly with your quote and book them on your standard terms.</p>
    <h3 style="color:#f5a623;font-size:15px;margin:20px 0 8px;">Response expectations</h3>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 14px;">Reply to customers within 2 hours during business hours, 4 hours after-hours. Repeated slow responses or customer complaints may result in removal from the network.</p>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0;">Questions? Email <a href="mailto:info@busbrother.com" style="color:#f5a623;">info@busbrother.com</a> any time.</p>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <p style="color:#8a9ab5;font-size:12px;">BusBrother — Brevard County, Florida</p>
  </div>
</div></body></html>`;

        if (env.RESEND_API_KEY) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: env.BUSBROTHER_FROM_EMAIL || 'onboarding@resend.dev',
              to: [vendor.email],
              subject,
              html: approvalHtml,
              reply_to: 'info@busbrother.com'
            })
          });
        }

        return new Response(`<!DOCTYPE html><html><head><title>Approved</title><style>body{background:#060e1c;color:#f8f6f0;font-family:Arial;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:2rem;}h1{color:#2ecc71;}p{color:#8a9ab5;}a{display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:1rem;}</style></head><body><div><h1>✓ ${vendor.company_name} approved</h1><p>${grantFounding ? 'Granted FOUNDING CARRIER status. ' : ''}Approval email sent to ${vendor.email}.</p><p>Carriers approved so far: ${foundingCount + 1} (of 5 Founding slots${grantFounding ? ' — including this one' : ''})</p><a href="https://busbrother.com/admin/jobs/">Open Dashboard</a></div></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    }
    return errResponse('Invalid vendor action');
  }

  if (request.method === 'GET') {
    const jobId = params.get('job_id');
    if (jobId) {
      const j = await supabase(env, `bb_jobs?id=eq.${jobId}&select=*`);
      if (!j.ok || !j.data || !j.data.length) return errResponse('Job not found', 404);
      const b = await supabase(env, `bb_bids?job_id=eq.${jobId}&select=*&order=total_price.asc`);
      return json({ job: j.data[0], bids: b.ok && b.data ? b.data : [] });
    }
    const jobs = await supabase(env, 'bb_jobs?select=*&order=created_at.desc');
    if (!jobs.ok) return errResponse('Failed to fetch jobs');
    const jobsWithBids = await Promise.all((jobs.data || []).map(async (j) => {
      const b = await supabase(env, `bb_bids?job_id=eq.${j.id}&select=id,total_price,company_name`);
      return { ...j, bids: b.ok && b.data ? b.data : [], bidCount: b.ok && b.data ? b.data.length : 0 };
    }));
    return json({ jobs: jobsWithBids });
  }

  if (request.method === 'POST') {
    const jobId = params.get('job_id');
    if (!jobId) return errResponse('Missing job_id');
    if (action === 'award' && params.get('bid_id')) {
      await supabase(env, `bb_jobs?id=eq.${jobId}`, 'PATCH', { status: 'awarded', awarded_bid_id: params.get('bid_id') });
      return json({ success: true, message: 'Job awarded' });
    }
    if (action === 'close') {
      await supabase(env, `bb_jobs?id=eq.${jobId}`, 'PATCH', { status: 'closed' });
      return json({ success: true, message: 'Job closed' });
    }
    if (action === 'delete') {
      await supabase(env, `bb_bids?job_id=eq.${jobId}`, 'DELETE');
      await supabase(env, `bb_jobs?id=eq.${jobId}`, 'DELETE');
      return json({ success: true, message: 'Job deleted' });
    }
    return errResponse('Invalid action');
  }

  return errResponse('Method not allowed', 405);
}
