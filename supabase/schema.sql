-- BusBrother Supabase Schema
-- Apply once to your Supabase project (Dashboard -> SQL Editor -> paste -> Run)

create extension if not exists "pgcrypto";

-- =================================================================
-- TABLES
-- =================================================================

create table if not exists public.bb_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'pending',           -- pending | open | awarded | paid | closed
  vendor_token text unique not null,                 -- random token shared with vendors
  customer_name text,
  customer_email text,
  customer_phone text,
  service text,
  trip_type text,
  pickup_date text,
  passengers text,
  pickup_location text,
  dropoff_location text,
  ada_accessible boolean default false,
  multi_stop boolean default false,
  luggage_assist boolean default false,
  notes text,
  page_url text,
  awarded_bid_id uuid,
  vendor_cost numeric(10, 2),
  customer_price numeric(10, 2),
  profit numeric(10, 2),
  square_invoice_id text,
  square_payment_url text,
  payment_status text                                -- invoiced | paid
);

create table if not exists public.bb_bids (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bb_jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  company_name text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  total_price numeric(10, 2) not null,
  vehicle_type text not null,
  vehicle_year text,
  vehicle_capacity text,
  driver_name text,
  insurance_info text,
  notes text
);

create table if not exists public.bb_vendors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_name text not null,
  contact_name text not null,
  email text unique not null,
  phone text,
  active boolean not null default true
);

-- Indexes
create index if not exists bb_jobs_token_idx     on public.bb_jobs (vendor_token);
create index if not exists bb_jobs_status_idx    on public.bb_jobs (status);
create index if not exists bb_jobs_pickup_idx    on public.bb_jobs (pickup_date);
create index if not exists bb_bids_job_id_idx    on public.bb_bids (job_id);
create index if not exists bb_vendors_active_idx on public.bb_vendors (active);

-- =================================================================
-- ROW-LEVEL SECURITY
-- =================================================================
-- All access goes through Netlify/Cloudflare functions using the
-- SERVICE ROLE key. The service role bypasses RLS, so RLS policies
-- here only matter if anon clients ever connect directly.
-- We enable RLS and lock down by default; service-role calls still work.

alter table public.bb_jobs    enable row level security;
alter table public.bb_bids    enable row level security;
alter table public.bb_vendors enable row level security;

-- (No anon policies. Anything that needs to read a job goes through
-- /api/job-view which uses the service key and filters by vendor_token.)

-- =================================================================
-- SEED DATA: paste your initial vendor list here
-- =================================================================
-- insert into public.bb_vendors (company_name, contact_name, email, phone, active) values
--   ('Acme Charter Bus', 'Jane Doe', 'jane@acme.com', '555-1234', true),
--   ('Sunshine Coaches', 'Bob Smith', 'bob@sunshine.com', '555-5678', true);
