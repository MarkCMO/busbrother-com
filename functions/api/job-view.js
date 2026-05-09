// GET /api/job-view?token={vendor_token}
import { json, errResponse, optionsResponse, supabase } from '../_shared/helpers.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'GET') return errResponse('Method not allowed', 405);

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return errResponse('Missing token');

  const job = await supabase(env,
    `bb_jobs?vendor_token=eq.${encodeURIComponent(token)}&select=id,created_at,status,service,trip_type,pickup_date,passengers,pickup_location,dropoff_location,ada_accessible,multi_stop,luggage_assist,notes,page_url`
  );
  if (!job.ok || !job.data || job.data.length === 0) return errResponse('Job not found', 404);

  const bids = await supabase(env, `bb_bids?job_id=eq.${job.data[0].id}&select=id`);
  return json({ job: job.data[0], bidCount: bids.ok && bids.data ? bids.data.length : 0 });
}
