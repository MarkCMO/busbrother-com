-- BusBrother Carrier Network + Bid Auction Migration
-- Apply ONCE to your Supabase project (Dashboard -> SQL Editor -> paste -> Run)
-- Idempotent: safe to re-run.

-- =================================================================
-- EXTEND bb_vendors WITH FULL CARRIER PROFILE FIELDS
-- =================================================================

alter table public.bb_vendors
  add column if not exists usdot_number text,
  add column if not exists mc_number text,
  add column if not exists insurance_amount numeric(12,2),
  add column if not exists insurance_expires date,
  add column if not exists fleet_summary text,
  add column if not exists primary_service_area text,
  add column if not exists secondary_service_areas text,
  add column if not exists founding_carrier boolean default false,
  add column if not exists approved boolean default false,
  add column if not exists approved_at timestamptz,
  add column if not exists notes_internal text,
  add column if not exists square_customer_id text;

create index if not exists bb_vendors_founding_idx on public.bb_vendors (founding_carrier) where founding_carrier = true;
create index if not exists bb_vendors_approved_idx on public.bb_vendors (approved) where approved = true;

-- =================================================================
-- VENDOR PRE-PAID WALLET (Phase 2)
-- Each approved vendor has one wallet. Lead-access fees draw down balance.
-- Auto-tops up via Square when balance < threshold.
-- =================================================================

create table if not exists public.bb_vendor_wallets (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.bb_vendors(id) on delete cascade,
  balance_cents bigint not null default 0,
  total_deposited_cents bigint not null default 0,
  total_spent_cents bigint not null default 0,
  auto_topup_enabled boolean default false,
  auto_topup_threshold_cents bigint default 5000,
  auto_topup_amount_cents bigint default 50000,
  square_card_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor_id)
);

create index if not exists bb_vendor_wallets_vendor_idx on public.bb_vendor_wallets (vendor_id);

-- =================================================================
-- WALLET LEDGER (every credit and debit)
-- =================================================================

create table if not exists public.bb_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.bb_vendors(id) on delete cascade,
  type text not null,                         -- 'topup' | 'lead_access' | 'refund' | 'manual_credit' | 'manual_debit'
  amount_cents bigint not null,               -- positive for credit, negative for debit
  balance_after_cents bigint not null,
  related_job_id uuid references public.bb_jobs(id) on delete set null,
  related_bid_id uuid,                        -- references bb_lead_bids when applicable
  square_payment_id text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists bb_wallet_tx_vendor_idx on public.bb_wallet_transactions (vendor_id, created_at desc);
create index if not exists bb_wallet_tx_job_idx on public.bb_wallet_transactions (related_job_id);

-- =================================================================
-- LEAD BIDS (Phase 2 auction)
-- Carriers submit blind bids on lead access. Top N win.
-- =================================================================

create table if not exists public.bb_lead_bids (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bb_jobs(id) on delete cascade,
  vendor_id uuid not null references public.bb_vendors(id) on delete cascade,
  bid_amount_cents bigint not null,
  status text not null default 'submitted',   -- 'submitted' | 'won' | 'lost' | 'refunded'
  resolved_at timestamptz,
  charged_at timestamptz,
  charge_amount_cents bigint,                 -- what was actually charged (may differ from bid in second-price auctions)
  customer_contact_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (job_id, vendor_id)                  -- one bid per vendor per job
);

create index if not exists bb_lead_bids_job_idx on public.bb_lead_bids (job_id, bid_amount_cents desc);
create index if not exists bb_lead_bids_vendor_idx on public.bb_lead_bids (vendor_id, created_at desc);
create index if not exists bb_lead_bids_status_idx on public.bb_lead_bids (status);

-- =================================================================
-- LEAD-PRICING CONFIG (per-job pricing decisions)
-- =================================================================

alter table public.bb_jobs
  add column if not exists pricing_model text default 'free',   -- 'free' | 'flat_fee' | 'auction' | 'commission'
  add column if not exists lead_access_fee_cents bigint,
  add column if not exists auction_winners_count int default 3,
  add column if not exists auction_closes_at timestamptz,
  add column if not exists auction_resolved_at timestamptz;

-- =================================================================
-- SEED: BTM Coaches as founding carrier (Mark's preferred operator)
-- =================================================================

insert into public.bb_vendors (
  company_name, contact_name, email, phone,
  active, approved, approved_at, founding_carrier,
  primary_service_area, notes_internal
)
values (
  'BTM Coaches', 'Sales Team', 'sales@btmcoach.com', '',
  true, true, now(), true,
  'Florida (statewide)', 'Founding Carrier. First preferred operator. Lifetime free lead access.'
)
on conflict (email) do update set
  founding_carrier = true,
  approved = true,
  approved_at = coalesce(public.bb_vendors.approved_at, now()),
  notes_internal = 'Founding Carrier. First preferred operator. Lifetime free lead access.';
