/**
 * nag-runner.ts
 *
 * Calls POST /internal/nag-check on the running API server.
 * Intended for use with Replit Scheduled Deployment or any external cron system.
 *
 * Usage:
 *   NAG_URL=http://localhost:8080/api/internal/nag-check \
 *   NAG_SECRET=optional-secret \
 *   pnpm --filter @workspace/scripts run nag
 *
 * Environment:
 *   NAG_URL     — API endpoint (required). For production: set to deployed URL.
 *   NAG_SECRET  — Optional shared secret. If set, sent as X-Nag-Secret header.
 *
 * Replit Scheduled Deployment setup:
 *   Run command: pnpm --filter @workspace/scripts run nag
 *   Schedule:    every 4 hours (cron: 0 *\/4 * * *)
 *   Set NAG_URL in Replit Secrets → Deployment env to point at your
 *   deployed API server URL (e.g. https://your-app.replit.app/api/internal/nag-check)
 */

const nagUrl = process.env.NAG_URL ?? "http://localhost:8080/api/internal/nag-check";
const nagSecret = process.env.NAG_SECRET ?? "";

async function main() {
  const ts = new Date().toISOString();
  console.log(`[nag-runner] ${ts} — calling ${nagUrl}`);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nagSecret) headers["X-Nag-Secret"] = nagSecret;

  let res: Response;
  try {
    res = await fetch(nagUrl, { method: "POST", headers });
  } catch (err) {
    console.error("[nag-runner] Network error:", err);
    process.exit(1);
  }

  const body = await res.text();

  if (!res.ok) {
    console.error(`[nag-runner] Error ${res.status}: ${body}`);
    process.exit(1);
  }

  console.log(`[nag-runner] Success ${res.status}: ${body}`);
}

main();
