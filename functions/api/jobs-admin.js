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
