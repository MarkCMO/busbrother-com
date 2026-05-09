// BusBrother Cron Worker - fires daily, hits /api/trip-reminders on the Pages site.
// Deploy:  cd cron-worker && npx wrangler deploy
// First-time secret:  npx wrangler secret put BUSBROTHER_ADMIN_SECRET

export default {
  async scheduled(event, env, ctx) {
    const url = `${env.TRIP_REMINDERS_URL}?secret=${encodeURIComponent(env.BUSBROTHER_ADMIN_SECRET || '')}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      const text = await res.text();
      console.log('trip-reminders ping:', res.status, text.slice(0, 500));
    } catch (err) {
      console.error('cron error:', err);
    }
  },
  async fetch() {
    // Manual ping endpoint for debugging (does nothing useful by itself).
    return new Response('busbrother-cron is alive', { status: 200 });
  }
};
