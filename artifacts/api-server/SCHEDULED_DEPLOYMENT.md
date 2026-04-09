# Nag Engine — Scheduled Deployment Setup

The PI nag engine runs via `POST /internal/nag-check`. This endpoint:
- Finds reports in **PI Review** status that have not received a nag in the past `nagIntervalHours` (configurable in Settings, default 48 h)
- Sends a reminder email to the PI via Gmail
- Updates `lastNagAt` on each nagged report

## Replit Scheduled Deployment (recommended)

1. Open your Repl → **Deploy** tab → **Scheduled**
2. Click **New scheduled job**
3. Set the **URL** to your deployed API endpoint:
   ```
   https://<your-app>.replit.app/api/internal/nag-check
   ```
4. Set the **Method** to `POST`
5. Set the **Schedule** to run every 4 hours:
   ```
   0 */4 * * *
   ```
   (cron expression: every 4 hours at minute 0)
6. Click **Save**

The endpoint is idempotent — calling it more frequently than `nagIntervalHours` will simply result in no emails being sent.

## Manual trigger (development / testing)

```bash
curl -X POST https://<your-app>.replit.app/api/internal/nag-check
# Response: { "nagsSent": <number>, "errors": [] }
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `STALE_THRESHOLD_HOURS` | `25` | Hours before enrollment sheet is considered stale. Set to `0.01` (~36 s) for demo purposes. |

## Security note

`/internal/nag-check` has no authentication by default (it relies on Replit's deployment network boundary). If you expose the API server publicly, consider adding a shared secret header check:

```typescript
// In reports.ts nag-check handler, add at the top:
const nagSecret = process.env.NAG_SECRET;
if (nagSecret && req.headers["x-nag-secret"] !== nagSecret) {
  res.status(401).json({ error: "Unauthorized" });
  return;
}
```

And set `NAG_SECRET` in Replit Secrets + the Scheduled Deployment header config.
