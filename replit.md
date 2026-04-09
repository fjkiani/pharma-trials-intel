# Workspace

## Overview

Clinical Trials Co-Pilot — a pnpm workspace monorepo for research coordinators ("Susan") that automates regulatory document management and sponsor report generation.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: Replit Database (`@replit/database`) for settings/report history
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (via `build.mjs`)
- **Frontend**: React + Vite + shadcn/ui (teal/navy theme)

## Integrations

- **Notion** (`@replit/connectors-sdk` proxy) — regulatory docs, AE log, deviation log DBs
- **Google Calendar** (`googleapis` v148) — 30-day renewal reminder events
- **Google Drive / Docs / Sheets** — planned for Task #2 (Sponsor Report Co-Pilot)

## Key Files

| Path | Purpose |
|------|---------|
| `lib/api-spec/openapi.yaml` | Single source of truth for all API endpoints |
| `artifacts/api-server/src/routes/regulatory.ts` | Regulatory document + calendar sync endpoints |
| `artifacts/api-server/src/routes/settings.ts` | GET/PUT app settings (persisted to Replit DB) |
| `artifacts/api-server/src/lib/notion.ts` | Pagination-aware Notion document fetching + parsing |
| `artifacts/api-server/src/lib/notionClient.ts` | Replit Connectors proxy wrapper for Notion |
| `artifacts/api-server/src/lib/googleCalendarClient.ts` | googleapis OAuth client via Replit Connectors |
| `artifacts/api-server/src/lib/googleCalendar.ts` | Calendar sync logic (dedup + event creation) |
| `artifacts/api-server/src/lib/settings.ts` | Replit Database settings persistence |
| `artifacts/clinical-trials/src/pages/regulatory.tsx` | Regulatory Timeline page |
| `artifacts/clinical-trials/src/pages/settings.tsx` | Settings page (all integration config) |

## Key Commands

- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/api-zod run build` — compile `lib/api-zod` declarations (required before api-server typecheck)
- `pnpm --filter @workspace/api-client-react run build` — compile `lib/api-client-react` declarations (required before clinical-trials typecheck)
- `pnpm --filter @workspace/api-server run typecheck` — typecheck API server
- `pnpm --filter @workspace/clinical-trials run typecheck` — typecheck frontend
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Notion Database Property Names (exact)

- `"Document Name"` (title)
- `"Expiration Date"` (date)
- `"Status"` (select: Current / Expiring Soon / Expired)
- `"File Link"` (url)

## Settings Keys (Replit DB: `app:settings`)

`notionRegulatoryDbId`, `googleCalendarId`, `notionAeLogDbId`, `notionDeviationLogDbId`, `googleSheetsId`, `googleSheetTab`, `googleSheetHeaderRow`, `googleDocsTemplateId`, `sponsorCallEventId`, `piEmail`, `sponsorEmail`, `nagIntervalHours`

## Task #2 — Sponsor Report Co-Pilot (planned)

- Google Drive (staleness check), Google Docs (`replaceAllText`), Gmail (nag engine)
- Concurrent report guard (block new generation if PI Review/Approved status exists)
- Nag engine via `POST /internal/nag-check` + Replit Scheduled Deployment
- Report history stored in Replit DB
