/**
 * GET /.netlify/functions/job-view?token={vendor_token}
 * Returns job details for vendor view (no customer email/phone)
 */
const { supabaseQuery, ok, err, options } = require('./supabase-config');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'GET') return err('Method not allowed', 405);

  const token = event.queryStringParameters?.token;
  if (!token) return err('Missing token');

  // Get job by vendor_token
  const job = await supabaseQuery(
    `bb_jobs?vendor_token=eq.${encodeURIComponent(token)}&select=id,created_at,status,service,trip_type,pickup_date,passengers,pickup_location,dropoff_location,ada_accessible,multi_stop,luggage_assist,notes,page_url`
  );

  if (!job.ok || !job.data || job.data.length === 0) return err('Job not found', 404);

  // Get existing bids count for this job
  const bids = await supabaseQuery(
    `bb_bids?job_id=eq.${job.data[0].id}&select=id`
  );

  return ok({
    job: job.data[0],
    bidCount: bids.ok ? bids.data.length : 0
  });
};
