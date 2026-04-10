/**
 * watchlist-poll-runner.ts
 *
 * Calls POST /internal/watchlist-poll on the running API server.
 * Intended for use with Replit Scheduled Deployment or any external cron system.
 *
 * Usage:
 *   POLL_URL=http://localhost:8080/api/internal/watchlist-poll \
 *   NAG_SECRET=optional-secret \
 *   pnpm --filter @workspace/scripts run watchlist-poll
 *
 * Environment:
 *   POLL_URL    — API endpoint (required). For production: set to deployed URL.
 *   NAG_SECRET  — Optional shared secret. If set, sent as X-Nag-Secret header.
 *
 * Replit Scheduled Deployment setup:
 *   Run command: pnpm --filter @workspace/scripts run watchlist-poll
 *   Schedule:    once daily (cron: 0 8 * * *)
 *   Set POLL_URL in Replit Secrets → Deployment env to point at your
 *   deployed API server URL (e.g. https://your-app.replit.app/api/internal/watchlist-poll)
 */

const pollUrl = process.env.POLL_URL ?? "http://localhost:8080/api/internal/watchlist-poll";
const nagSecret = process.env.NAG_SECRET ?? "";

async function main() {
  const ts = new Date().toISOString();
  console.log(`[watchlist-poll-runner] ${ts} — calling ${pollUrl}`);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nagSecret) headers["X-Nag-Secret"] = nagSecret;

  let res: Response;
  try {
    res = await fetch(pollUrl, { method: "POST", headers });
  } catch (err) {
    console.error("[watchlist-poll-runner] Network error:", err);
    process.exit(1);
  }

  const body = await res.text();

  if (!res.ok) {
    console.error(`[watchlist-poll-runner] Error ${res.status}: ${body}`);
    process.exit(1);
  }

  console.log(`[watchlist-poll-runner] Success ${res.status}: ${body}`);
}

main();
