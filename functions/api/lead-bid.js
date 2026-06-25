// POST /api/lead-bid  (Phase 2 — stub. NOT wired into vendor email yet.)
// Carrier submits a bid amount for lead access on a specific job.
// Body: { token: vendor_token of job, vendor_email, bid_amount_dollars }
//
// When Phase 2 flips on:
//  1. Vendor blast email gets a "Bid for this lead" link in place of "View Full Details"
//  2. Carrier-facing /jobs/{token}/ page shows the bid form
//  3. This endpoint records the bid in bb_lead_bids
//  4. A separate cron Worker (bid-resolver) closes the auction window and picks winners
//
// Why this stub exists now: so the table schema, endpoint route, and idempotency
// behavior are deployable BEFORE we flip on the paid model. Flipping is a 5-line
// change to send-to-vendors.js (swap the link + add bid form), no infrastructure change.

import { json, errResponse, optionsResponse, supabase } from '../_shared/helpers.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return errResponse('Method not allowed', 405);

  let body; try { body = await request.json(); } catch { return errResponse('Invalid JSON'); }

  const { token, vendor_email, bid_amount_dollars } = body;
  if (!token) return errResponse('Missing job token');
  if (!vendor_email) return errResponse('Missing vendor email');
  if (!bid_amount_dollars || isNaN(bid_amount_dollars) || bid_amount_dollars < 1) {
    return errResponse('Bid must be at least $1');
  }

  // Resolve job
  const j = await supabase(env, `bb_jobs?vendor_token=eq.${encodeURIComponent(token)}&select=id,status,pricing_model,auction_closes_at`);
  if (!j.ok || !j.data || !j.data.length) return errResponse('Job not found', 404);
  const job = j.data[0];

  // Phase guard: only bid on jobs explicitly marked as auction
  if (job.pricing_model !== 'auction') {
    return errResponse('This lead is not currently in auction mode. Contact the customer directly per your network terms.', 400);
  }
  if (job.auction_closes_at && new Date(job.auction_closes_at).getTime() < Date.now()) {
    return errResponse('Auction for this lead has closed', 410);
  }

  // Resolve vendor (must be approved)
  const v = await supabase(env, `bb_vendors?email=eq.${encodeURIComponent(vendor_email.toLowerCase())}&approved=eq.true&active=eq.true&select=id,company_name,founding_carrier`);
  if (!v.ok || !v.data || !v.data.length) {
    return errResponse('Vendor not found or not approved', 403);
  }
  const vendor = v.data[0];

  // Founding carriers bid $0 (lifetime free access)
  const bidCents = vendor.founding_carrier ? 0 : Math.round(parseFloat(bid_amount_dollars) * 100);

  // Upsert bid (one bid per vendor per job)
  const existing = await supabase(env, `bb_lead_bids?job_id=eq.${job.id}&vendor_id=eq.${vendor.id}&select=id`);
  if (existing.ok && existing.data && existing.data.length) {
    await supabase(env, `bb_lead_bids?id=eq.${existing.data[0].id}`, 'PATCH', {
      bid_amount_cents: bidCents,
      status: 'submitted'
    });
  } else {
    await supabase(env, 'bb_lead_bids', 'POST', {
      job_id: job.id,
      vendor_id: vendor.id,
      bid_amount_cents: bidCents,
      status: 'submitted'
    });
  }

  return json({
    success: true,
    company: vendor.company_name,
    bid_amount_dollars: bidCents / 100,
    founding_carrier: vendor.founding_carrier,
    auction_closes_at: job.auction_closes_at,
    note: vendor.founding_carrier
      ? 'Founding Carrier status — you receive this lead at no cost regardless of bid.'
      : 'Bid recorded. You will be notified after the auction window closes.'
  });
}
