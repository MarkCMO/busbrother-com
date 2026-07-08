-- BusBrother BTM Accountability Migration
-- Adds per-lead vendor status tracking so BTM Coaches (and future carriers)
-- must report contacted / quoted / booked / lost on every lead they receive.
-- Weekly Friday digest emails will hold them accountable.
--
-- Apply ONCE to your Supabase project (Dashboard -> SQL Editor -> paste -> Run).
-- Idempotent: safe to re-run.

-- =================================================================
-- ADD ASSIGNMENT TRACKING TO bb_jobs
-- =================================================================

alter table public.bb_jobs
  add column if not exists assigned_vendor_id uuid references public.bb_vendors(id),
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by text;               -- 'mark' | 'auto' | 'auction'

create index if not exists bb_jobs_assigned_vendor_idx on public.bb_jobs (assigned_vendor_id);

-- =================================================================
-- VENDOR STATUS TRACKING (BTM reports back on each lead)
-- =================================================================
-- Every status update the vendor makes is appended as a new row.
-- The MOST RECENT row per (job_id, vendor_id) is the current status.
-- Allowed status values:
--   'not_contacted' - vendor hasn't reached out yet (default until they say otherwise)
--   'contacted'     - vendor emailed/called customer
--   'quoted'        - vendor sent a quote (record dollar amount)
--   'booked'        - customer booked (record final amount, this is a WIN)
--   'lost'          - customer went with someone else or didn't book (record reason)
--   'no_response'   - vendor tried but customer went silent

create table if not exists public.bb_lead_vendor_status (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bb_jobs(id) on delete cascade,
  vendor_id uuid not null references public.bb_vendors(id) on delete cascade,
  status text not null,
  quoted_amount_cents bigint,
  final_amount_cents bigint,
  lost_reason text,
  notes text,
  updated_by_email text,        -- 'sales@btmcoach.com' etc.
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists bb_lvs_job_idx on public.bb_lead_vendor_status (job_id, updated_at desc);
create index if not exists bb_lvs_vendor_idx on public.bb_lead_vendor_status (vendor_id, updated_at desc);
create index if not exists bb_lvs_status_idx on public.bb_lead_vendor_status (status, updated_at desc);

-- =================================================================
-- CONVENIENCE VIEW: current status per (job, vendor)
-- =================================================================

create or replace view public.bb_lead_vendor_status_current as
select distinct on (job_id, vendor_id)
  id, job_id, vendor_id, status,
  quoted_amount_cents, final_amount_cents, lost_reason, notes,
  updated_by_email, updated_at
from public.bb_lead_vendor_status
order by job_id, vendor_id, updated_at desc;

-- =================================================================
-- CONVENIENCE VIEW: closing-rate stats per vendor (last 30/90/365 days)
-- =================================================================

create or replace view public.bb_vendor_closing_stats as
with statuses as (
  select v.id as vendor_id,
         v.company_name,
         s.job_id,
         s.status,
         s.final_amount_cents,
         s.updated_at
  from public.bb_vendors v
  left join public.bb_lead_vendor_status_current s on s.vendor_id = v.id
)
select
  vendor_id,
  company_name,
  count(*) filter (where updated_at >= now() - interval '30 days') as total_leads_30d,
  count(*) filter (where status = 'booked' and updated_at >= now() - interval '30 days') as booked_30d,
  count(*) filter (where status = 'lost' and updated_at >= now() - interval '30 days') as lost_30d,
  count(*) filter (where status in ('not_contacted', 'contacted', 'quoted') and updated_at >= now() - interval '30 days') as pending_30d,
  sum(final_amount_cents) filter (where status = 'booked' and updated_at >= now() - interval '30 days') / 100.0 as booked_revenue_30d,
  count(*) filter (where updated_at >= now() - interval '90 days') as total_leads_90d,
  count(*) filter (where status = 'booked' and updated_at >= now() - interval '90 days') as booked_90d,
  sum(final_amount_cents) filter (where status = 'booked' and updated_at >= now() - interval '90 days') / 100.0 as booked_revenue_90d
from statuses
group by vendor_id, company_name;
