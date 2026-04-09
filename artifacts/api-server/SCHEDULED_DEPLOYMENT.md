# Nag Engine — Scheduled Deployment Setup

The PI nag engine runs via `POST /internal/nag-check`. This endpoint:
- Finds reports in **PI Review** status that have not received a nag in the past `nagIntervalHours` (configurable in Settings, default **4 hours**)
- Sends a reminder email to the PI via Gmail
- Updates `lastNagAt` on each nagged report

The endpoint is idempotent — calling it more frequently than `nagIntervalHours` will simply result in no emails being sent.

## Option 1 — Replit Scheduled Deployment (recommended)

A `nag-runner.ts` script in `scripts/src/` is the designated entrypoint for scheduled nag calls:

```bash
# Run command to configure in Replit Scheduled Deployment:
pnpm --filter @workspace/scripts run nag
```

### Setup steps

1. Open your Repl → **Deploy** tab → **Scheduled**
2. Click **New scheduled job**
3. Set the **Run command** to:
   ```
   pnpm --filter @workspace/scripts run nag
   ```
4. Set the **Schedule** to every 4 hours:
   ```
   0 */4 * * *
   ```
   (cron expression: at minute 0, every 4 hours)
5. In **Environment** → **Secrets**, add:
   - `NAG_URL` = `https://<your-app>.replit.app/api/internal/nag-check`
   - `NAG_SECRET` = `<same value as set on API server>` (if using auth)
6. Click **Save & Deploy**

### What the script does

`scripts/src/nag-runner.ts` calls `POST $NAG_URL` with an optional `X-Nag-Secret` header,
logs the response, and exits non-zero on failure so Replit can alert on errors.

## Option 2 — External cron (GitHub Actions, etc.)

```bash
curl -X POST https://<your-app>.replit.app/api/internal/nag-check \
  -H "X-Nag-Secret: $NAG_SECRET"
# Response: { "nagsSent": <number>, "errors": [] }
```

## Manual trigger (development / testing)

```bash
NAG_URL=http://localhost:8080/api/internal/nag-check \
  pnpm --filter @workspace/scripts run nag
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `STALE_THRESHOLD_HOURS` | `24` | Hours before enrollment sheet is considered stale. Set to `0.001` (~3 s) for demo purposes. |
| `NAG_SECRET` | _(unset)_ | If set, `/internal/nag-check` requires `X-Nag-Secret: <value>` header. |
| `NAG_URL` | `http://localhost:8080/api/internal/nag-check` | Target for `nag-runner.ts`. Override to deployed URL in Scheduled Deployment secrets. |

## Security

`/internal/nag-check` is **unauthenticated by default** (safe only behind Replit's network boundary).
To enable auth:
1. Set `NAG_SECRET` in Replit Secrets for **both** the API server and the Scheduled Deployment.
2. The API server will then require `X-Nag-Secret: <value>` on every nag-check request.
