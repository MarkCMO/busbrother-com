# BusBrother on Cloudflare - Operations Guide

This document covers everything that must be set up in Cloudflare for the site to work end-to-end after the Netlify -> Cloudflare migration.

## 1. Cloudflare Pages Project

The site is deployed via Cloudflare Pages. The repo's `dist/` directory is the publish output.

After every push to `main`:
1. Cloudflare auto-runs `npm install && node build.js`
2. Output goes to `dist/`
3. `dist/_redirects` (301s), `dist/_headers` (caching/security), and `dist/functions/` (Pages Functions) all deploy together.

If a manual rebuild is needed:
```
node build.js
npx wrangler pages deploy dist --project-name=<your-project-name>
```

## 2. Environment Variables (Cloudflare Pages dashboard)

Go to Cloudflare dashboard -> Pages -> busbrother project -> Settings -> Environment variables. Set ALL of the following for **Production** AND **Preview**:

| Variable | Used By | Notes |
|---|---|---|
| `RESEND_API_KEY` | every email-sending function | Get from resend.com |
| `BUSBROTHER_FROM_EMAIL` | every email-sending function | e.g. `BusBrother <info@busbrother.com>` (must be verified domain in Resend) |
| `BUSBROTHER_NOTIFY_EMAIL` | submit-quote, bid-submit, square-webhook | Comma-separated. Default: `info@busbrother.com` |
| `BUSBROTHER_ADMIN_SECRET` | jobs-admin, send-to-vendors, award-bid, send-invoice, trip-reminders | Long random string. Used in admin URL params. |
| `SUPABASE_URL` | every function that hits Supabase | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | every function that hits Supabase | Service role key (NOT anon) |
| `SQUARE_ACCESS_TOKEN` | send-invoice | Square OAuth access token |
| `SQUARE_LOCATION_ID` | send-invoice | Default fallback `LVBWTHWMEP60S` |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | square-webhook | From Square dashboard -> Webhook subscriptions |

After adding/changing env vars, **redeploy** the Pages project (Settings -> Builds & deployments -> Retry deployment).

## 3. Supabase Setup

The bidding system requires three tables: `bb_jobs`, `bb_bids`, `bb_vendors`. As of the migration, these tables do NOT exist on any Supabase project linked to this site. They must be created.

Run the SQL in `supabase/schema.sql` (see file in repo) against the Supabase project, then set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in Cloudflare Pages env vars (above).

## 4. Cron Worker (Trip Reminders)

Cloudflare Pages Functions cannot host Cron Triggers. To fire daily 24-hour-out trip reminders, deploy the standalone Worker in `cron-worker/`:

```
cd cron-worker
npx wrangler login                                  # one-time
npx wrangler secret put BUSBROTHER_ADMIN_SECRET     # paste the same value as Pages
npx wrangler deploy
```

The Worker fires daily at 13:00 UTC (08:00 ET) and pings `https://busbrother.com/api/trip-reminders?secret=...`. To change schedule, edit `cron-worker/wrangler.toml`'s `crons = [...]` line.

## 5. DNS / Domain

Cloudflare DNS should point `busbrother.com` (and `www.busbrother.com`) to the Pages project. Both apex and www should resolve to the same Pages deployment via Cloudflare's automatic CNAME flattening.

## 6. Square Webhook URL

In the Square dashboard -> Developer Dashboard -> Webhooks -> your subscription, set the notification URL to:

```
https://busbrother.com/api/square-webhook
```

Subscribe to events: `payment.created`, `payment.updated`, `payment.completed`. The signing key in Square's webhook settings goes into `SQUARE_WEBHOOK_SIGNATURE_KEY` env var (above).

## 7. Resend Domain

Resend must have `busbrother.com` (or whichever domain is in `BUSBROTHER_FROM_EMAIL`) verified via DNS records (DKIM, SPF, return-path). Otherwise outgoing emails will be marked spam or rejected.

## 8. Smoke-test checklist

After all of the above:

- [ ] Visit `https://busbrother.com/airports/test` - should 301 to `/services/airport-transfers/`
- [ ] Visit `https://busbrother.com/from/orlando/to/magic-kingdom` - should 301 to `/attractions/magic-kingdom/`
- [ ] Submit a test quote on `/book/` - should redirect to `/thank-you/`, Mark gets email within ~10 sec
- [ ] Email "SEND OUT FOR BID" button should hit `/api/send-to-vendors?...` and show a green confirmation page
- [ ] Visit `/admin/jobs/?secret=<your-admin-secret>` - dashboard should load with the test job
- [ ] `curl https://busbrother.com/api/trip-reminders?secret=<your-admin-secret>` - should return JSON
- [ ] Cloudflare dashboard -> Workers -> busbrother-cron -> Logs - confirm cron fired at 13:00 UTC

## 9. What changed from Netlify

| Netlify | Cloudflare equivalent |
|---|---|
| `netlify.toml` redirects | `static/_redirects` (copied to `dist/_redirects` by build) |
| `netlify.toml` headers | `static/_headers` |
| `netlify/functions/*.js` | `functions/api/*.js` (Cloudflare Pages Functions) |
| Netlify Forms (`data-netlify="true"`) | Pages Function `/api/submit-quote` |
| Netlify scheduled function | Standalone Worker in `cron-worker/` |
| `process.env.X` | `env.X` (passed into each Pages Function) |
| `.netlify/functions/X` URLs | `/api/X` (with back-compat redirects in `_redirects`) |
