// BusBrother Cron Worker
// - Daily 13:00 UTC (8am ET DST) -> /api/trip-reminders
// - Fridays 13:00 UTC            -> /api/weekly-digest (BTM accountability)
// Deploy:  cd cron-worker && npx wrangler deploy
// First-time secret:  npx wrangler secret put BUSBROTHER_ADMIN_SECRET

async function fire(url, env, tag) {
  if (!url || !env.BUSBROTHER_ADMIN_SECRET) {
    console.log(`[${tag}] SKIP - missing url or secret`);
    return;
  }
  const full = `${url}?secret=${encodeURIComponent(env.BUSBROTHER_ADMIN_SECRET)}`;
  try {
    const res = await fetch(full, { method: 'GET' });
    const body = await res.text();
    console.log(`[${tag}] ${res.status} ${body.slice(0, 300)}`);
  } catch (err) {
    console.error(`[${tag}] error:`, err);
  }
}

export default {
  async scheduled(event, env, ctx) {
    // Fire trip reminders every day. Fridays also fire the digest.
    // Use event.cron to differentiate: daily "0 13 * * *" vs Friday "0 13 * * 5"
    const cron = event.cron || '';
    const isDay = new Date(event.scheduledTime).getUTCDay();  // 5 = Friday

    // Always fire trip reminders
    ctx.waitUntil(fire(env.TRIP_REMINDERS_URL, env, 'trip-reminders'));

    // On Fridays fire the weekly digest as well.
    // The Friday cron is "0 13 * * 5" - matches ONLY on Fridays. The daily cron
    // "0 13 * * *" ALSO matches on Fridays, so both fire on Fri. We detect the
    // day and only fire the digest once (per the day-of-week match), avoiding
    // duplicate sends.
    if (cron === '0 13 * * 5' || (cron === '0 13 * * *' && isDay === 5)) {
      // Only fire from the explicit Friday cron to prevent double-sends.
      if (cron === '0 13 * * 5') {
        ctx.waitUntil(fire(env.WEEKLY_DIGEST_URL, env, 'weekly-digest'));
      }
    }
  },
  async fetch() {
    return new Response('busbrother-cron is alive', { status: 200 });
  }
};
