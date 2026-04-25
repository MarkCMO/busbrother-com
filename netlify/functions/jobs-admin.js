/**
 * Admin API for BusBrother jobs/bids
 * GET /.netlify/functions/jobs-admin?secret={admin_secret}
 * GET /.netlify/functions/jobs-admin?secret={admin_secret}&job_id={id}
 * POST /.netlify/functions/jobs-admin?secret={admin_secret}&action=award&job_id={id}&bid_id={id}
 * POST /.netlify/functions/jobs-admin?secret={admin_secret}&action=close&job_id={id}
 */
const { supabaseQuery, ok, err, options } = require('./supabase-config');

const ADMIN_SECRET = process.env.BUSBROTHER_ADMIN_SECRET;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const params = event.queryStringParameters || {};
  if (!ADMIN_SECRET || params.secret !== ADMIN_SECRET) return err('Unauthorized', 401);

  // Vendor management
  if (params.resource === 'vendors') {
    if (event.httpMethod === 'GET') {
      const vendors = await supabaseQuery('bb_vendors?select=*&order=created_at.desc');
      return ok({ vendors: vendors.ok ? vendors.data : [] });
    }
    if (event.httpMethod === 'POST') {
      const action = params.action;
      if (action === 'add') {
        let body; try { body = JSON.parse(event.body); } catch(e) { return err('Invalid JSON'); }
        if (!body.company_name || !body.contact_name || !body.email) return err('Company name, contact name, and email required');
        const result = await supabaseQuery('bb_vendors', 'POST', {
          company_name: body.company_name, contact_name: body.contact_name,
          email: body.email, phone: body.phone || null, active: true
        });
        return result.ok ? ok({ success: true }) : err('Failed to add vendor');
      }
      if (action === 'toggle' && params.vendor_id) {
        const v = await supabaseQuery(`bb_vendors?id=eq.${params.vendor_id}&select=active`, 'GET');
        if (!v.ok || !v.data.length) return err('Vendor not found');
        await supabaseQuery(`bb_vendors?id=eq.${params.vendor_id}`, 'PATCH', { active: !v.data[0].active });
        return ok({ success: true });
      }
      if (action === 'delete' && params.vendor_id) {
        await supabaseQuery(`bb_vendors?id=eq.${params.vendor_id}`, 'DELETE');
        return ok({ success: true });
      }
    }
    return err('Invalid vendor action');
  }

  if (event.httpMethod === 'GET') {
    if (params.job_id) {
      // Get single job with all bids
      const job = await supabaseQuery(`bb_jobs?id=eq.${params.job_id}&select=*`);
      if (!job.ok || !job.data.length) return err('Job not found', 404);
      const bids = await supabaseQuery(`bb_bids?job_id=eq.${params.job_id}&select=*&order=total_price.asc`);
      return ok({ job: job.data[0], bids: bids.ok ? bids.data : [] });
    }
    // List all jobs with bid counts
    const jobs = await supabaseQuery('bb_jobs?select=*&order=created_at.desc');
    if (!jobs.ok) return err('Failed to fetch jobs');

    // Get bid counts
    const jobsWithBids = await Promise.all(jobs.data.map(async (j) => {
      const bids = await supabaseQuery(`bb_bids?job_id=eq.${j.id}&select=id,total_price,company_name`);
      return { ...j, bids: bids.ok ? bids.data : [], bidCount: bids.ok ? bids.data.length : 0 };
    }));

    return ok({ jobs: jobsWithBids });
  }

  if (event.httpMethod === 'POST') {
    const action = params.action;
    const jobId = params.job_id;
    if (!jobId) return err('Missing job_id');

    if (action === 'award' && params.bid_id) {
      await supabaseQuery(`bb_jobs?id=eq.${jobId}`, 'PATCH', { status: 'awarded', awarded_bid_id: params.bid_id });
      return ok({ success: true, message: 'Job awarded' });
    }
    if (action === 'close') {
      await supabaseQuery(`bb_jobs?id=eq.${jobId}`, 'PATCH', { status: 'closed' });
      return ok({ success: true, message: 'Job closed' });
    }
    if (action === 'delete') {
      await supabaseQuery(`bb_bids?job_id=eq.${jobId}`, 'DELETE');
      await supabaseQuery(`bb_jobs?id=eq.${jobId}`, 'DELETE');
      return ok({ success: true, message: 'Job deleted' });
    }
    return err('Invalid action');
  }

  return err('Method not allowed', 405);
};
