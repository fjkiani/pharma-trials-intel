# Workspace

## Overview

Clinical Trials Co-Pilot — a pnpm workspace monorepo for research coordinators ("Susan") that automates regulatory document management (Task #1) and sponsor report generation (Task #2).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: Replit Database (`@replit/database`) for settings + report history
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (via `build.mjs`)
- **Frontend**: React + Vite + shadcn/ui (teal/navy theme)

## Integrations

| Connector | ID | Auth method | Used for |
|-----------|----|----|---------|
| Notion | `conn_notion_01KNREG1192A3Y9R6V3K73HDES` | connectors-sdk proxy | Regulatory docs, AE log, deviation log |
| Google Calendar | `conn_google-calendar_01KNREH8FEDZNR777E2M542SEG` | googleapis OAuth token | Calendar reminder events |
| Google Drive | `conn_google-drive_01KNSCZAXZXARHD7DVD08NSKAC` | connectors-sdk proxy | File freshness, doc copy/delete/perms, Sheets API |
| Google Docs | `conn_google-docs_01KNREF0HTC1AARCPAEBN6J6Y5` | googleapis OAuth token | replaceAllText, doc content scan |
| Gmail | `conn_google-mail_01KNSE85K7JABHK7TKG5B3ZJCN` | googleapis OAuth token | PI review + nag emails |

## Key Files

| Path | Purpose |
|------|---------|
| `lib/api-spec/openapi.yaml` | Single source of truth for all API endpoints |
| `artifacts/api-server/src/routes/regulatory.ts` | Regulatory document + calendar sync endpoints |
| `artifacts/api-server/src/routes/reports.ts` | Sponsor report lifecycle + nag-check endpoints |
| `artifacts/api-server/src/routes/settings.ts` | GET/PUT app settings (persisted to Replit DB) |
| `artifacts/api-server/src/lib/notion.ts` | Pagination-aware Notion regulatory doc fetching |
| `artifacts/api-server/src/lib/notionAeDeviation.ts` | AE/deviation/milestone aggregation from Notion |
| `artifacts/api-server/src/lib/notionClient.ts` | Replit Connectors proxy wrapper for Notion |
| `artifacts/api-server/src/lib/googleCalendarClient.ts` | googleapis OAuth client via Replit Connectors |
| `artifacts/api-server/src/lib/googleCalendar.ts` | Calendar sync logic (dedup + event creation) |
| `artifacts/api-server/src/lib/googleOAuthClient.ts` | Generic googleapis OAuth token fetcher (Docs/Gmail) |
| `artifacts/api-server/src/lib/googleDriveClient.ts` | Drive proxy client (freshness, copy, delete, Sheets API) |
| `artifacts/api-server/src/lib/googleDocs.ts` | Template copy, replaceAllText, placeholder scan |
| `artifacts/api-server/src/lib/googleSheets.ts` | Enrollment data reader via Drive proxy |
| `artifacts/api-server/src/lib/gmailClient.ts` | Gmail send via googleapis OAuth token |
| `artifacts/api-server/src/lib/gmail.ts` | PI review + nag email templates |
| `artifacts/api-server/src/lib/reportHistory.ts` | Replit DB CRUD for report records |
| `artifacts/api-server/src/lib/settings.ts` | Replit Database settings persistence |
| `artifacts/clinical-trials/src/pages/reports.tsx` | Sponsor Report Co-Pilot page (full lifecycle UI) |
| `artifacts/clinical-trials/src/pages/regulatory.tsx` | Regulatory Timeline page |
| `artifacts/clinical-trials/src/pages/settings.tsx` | Settings page (all integration config + placeholder table) |
| `scripts/src/seed-demo.ts` | Demo seed: populates Notion AE/deviation/milestone data |

## Key Commands

- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/api-zod run build` — compile `lib/api-zod` declarations (required before api-server typecheck)
- `pnpm --filter @workspace/api-client-react run build` — compile `lib/api-client-react` declarations (required before clinical-trials typecheck)
- `pnpm --filter @workspace/api-server run typecheck` — typecheck API server
- `pnpm --filter @workspace/clinical-trials run typecheck` — typecheck frontend
- `pnpm --filter @workspace/scripts run seed` — run demo seed script (requires NOTION_TOKEN env var)

## Notion Database Property Names (exact)

**Regulatory / Milestone DB:** `"Document Name"` (title), `"Expiration Date"` (date), `"Status"` (select), `"File Link"` (url)
**AE Log DB:** `"AE Description"` (title), `"Grade"` (select: Grade 1–5), `"Date Reported"` (date), `"Resolved"` (checkbox)
**Deviation Log DB:** `"Deviation Type"` (title), `"Date"` (date), `"Severity"` (select: Minor / Major)

## Settings Keys (Replit DB: `app:settings`)

`notionRegulatoryDbId`, `googleCalendarId`, `notionAeLogDbId`, `notionDeviationLogDbId`, `googleSheetsId`, `googleSheetTab`, `googleSheetHeaderRow`, `googleDocsTemplateId`, `sponsorCallEventId`, `piEmail`, `sponsorEmail`, `nagIntervalHours`

## Report History (Replit DB)

- Index key: `reports:all` (array of UUIDs)
- Per-report key: `report:<uuid>` (serialized `SponsorReportRecord` object)
- Status lifecycle: `Draft → PI Review → Approved → Sent` (Discarded is terminal)

## Report Lifecycle API

| Method | Endpoint | Action |
|--------|----------|--------|
| GET | `/api/reports` | List all reports (sorted newest-first) |
| POST | `/api/reports/generate` | Generate new draft (with staleness check + concurrent guard) |
| POST | `/api/reports/:id/send-to-pi` | Send PI review email, advance to PI Review |
| POST | `/api/reports/:id/mark-approved` | Advance from PI Review → Approved |
| POST | `/api/reports/:id/mark-final` | Append link to calendar event, advance to Sent |
| POST | `/api/reports/:id/discard` | Delete Google Doc, mark Discarded |
| POST | `/api/internal/nag-check` | Nag engine — call every 4h via Scheduled Deployment |

## Nag Engine

`POST /internal/nag-check` scans Replit DB for PI Review reports past the nag interval and sends follow-up Gmail. Must be called by **Replit Scheduled Deployment** every 4 hours. No in-process timers.

## Google Sheets Layout (Canonical)

Row 1 = headers (Metric | Value). Match by metric name in column A (case-insensitive). Rows: Enrolled, Screened, Screen Failures, Withdrawals.
