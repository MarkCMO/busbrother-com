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
    return err('Invalid action');
  }

  return err('Method not allowed', 405);
};
