# Clinical Trials Co-Pilot — Agent Handoff Document

> **Status:** Live and deployed. All integrations active.
> **Stack:** pnpm monorepo · Node.js/Express API · React + Vite frontend · Replit DB · Google Workspace · Notion
> **Deployed at:** `artifacts/clinical-trials` (web) + `artifacts/api-server` (API)

---

## 1. What This System Does

A two-track intelligence and automation platform for clinical research coordinators (CRCs) managing oncology trials (built around trial ONCO-247, user "Susan"):

| Track | Purpose |
|---|---|
| **Competitor Intelligence** | Monitors rival trials on ClinicalTrials.gov via a deterministic Signal Engine → generates Google Docs briefs → writes to Notion C2 databases → emails PI via Gmail Compose URL |
| **Sponsor Reports** | Reads enrollment from Google Sheets + AE/deviation data from Notion → fills a Google Docs template → emails PI for sign-off → syncs deadlines to Google Calendar |

---

## 2. Repository Structure

```
/
├── artifacts/
│   ├── api-server/                    # Express API (Node.js + TypeScript)
│   │   └── src/
│   │       ├── app.ts                 # Express app bootstrap
│   │       ├── routes/
│   │       │   ├── index.ts           # Router mount point (/api prefix)
│   │       │   ├── strike.ts          # Competitor intelligence + /strike/rules
│   │       │   ├── briefs.ts          # Intelligence brief lifecycle (CRUD + send-to-PI)
│   │       │   ├── reports.ts         # Sponsor report pipeline
│   │       │   ├── swarm.ts           # Swarm ingestion trigger route
│   │       │   ├── integrations.ts    # Integration health probes
│   │       │   ├── watchlist.ts       # Trial watchlist management
│   │       │   ├── regulatory.ts      # Regulatory timeline + calendar sync
│   │       │   ├── audit.ts           # Audit log retrieval
│   │       │   ├── connections.ts     # Connection test utilities
│   │       │   └── settings.ts        # App settings CRUD
│   │       ├── services/
│   │       │   ├── ingestion/
│   │       │   │   └── swarm.ts       # ClinicalTrials.gov fetch + delta storage
│   │       │   ├── exploitation/
│   │       │   │   └── orchestrator.ts  # 6-module Signal Engine kill chain
│   │       │   ├── delivery/
│   │       │   │   ├── formatter.ts   # Alert → Markdown brief formatter
│   │       │   │   └── notionSink.ts  # Writes intelligence to Notion C2 DBs
│   │       │   ├── audit/
│   │       │   │   └── logger.ts      # Structured audit trail writer
│   │       │   └── types.ts           # Shared service interfaces
│   │       └── lib/
│   │           ├── settings.ts        # AppSettings interface + DB accessor
│   │           ├── gmail.ts           # Gmail Compose URL email builders
│   │           ├── gmailClient.ts     # getGmailComposeUrl() helper
│   │           ├── notion.ts          # Notion regulatory/AE/deviation reader
│   │           ├── notionClient.ts    # Raw Notion API client
│   │           ├── notionAeDeviation.ts  # AE + deviation log reader
│   │           ├── notionIntelligence.ts # Competitor intelligence Notion writer
│   │           ├── googleSheets.ts    # Enrollment data reader
│   │           ├── googleDocs.ts      # Template copy + placeholder filler
│   │           ├── googleDriveClient.ts  # Drive API proxy (driveProxy)
│   │           ├── googleCalendar.ts  # Calendar event writer
│   │           ├── googleCalendarClient.ts
│   │           ├── googleOAuthClient.ts  # OAuth2 client factory
│   │           ├── clinicalTrialsClient.ts  # ClinicalTrials.gov v2 API client
│   │           ├── watchlist.ts       # Watchlist DB helpers
│   │           ├── watchlistDeltas.ts # Trial snapshot delta utilities
│   │           ├── briefHistory.ts    # Intelligence brief DB helpers
│   │           ├── reportHistory.ts   # Sponsor report DB helpers
│   │           ├── auditLog.ts        # Audit log DB helpers
│   │           ├── openaiClient.ts    # OpenAI client (available, underused)
│   │           └── logger.ts          # Pino structured logger
│   │
│   └── clinical-trials/               # React + Vite frontend
│       └── src/
│           ├── App.tsx                # Router (Wouter) + all routes
│           ├── pages/
│           │   ├── strike-center.tsx  # Competitor Intelligence dashboard
│           │   ├── TargetDossier.tsx  # Per-trial deep-dive view
│           │   ├── competitor-watch.tsx  # Watchlist management
│           │   ├── reports.tsx        # Sponsor Report Co-Pilot
│           │   ├── governance.tsx     # Governance & Audit log
│           │   ├── regulatory.tsx     # Regulatory Timeline
│           │   ├── settings.tsx       # Connection Setup
│           │   ├── AdminRules.tsx     # Signal Engine Configuration
│           │   └── not-found.tsx
│           ├── components/
│           │   └── layout-shell.tsx   # Sidebar nav + live health checks
│           ├── hooks/                 # Shared React Query hooks
│           └── lib/                   # apiFetch helper
│
├── lib/
│   ├── api-spec/openapi.yaml          # Full OpenAPI 3.0 spec
│   ├── api-zod/                       # Zod schemas auto-generated from spec
│   └── api-client-react/              # TanStack Query hooks (generated)
│
└── HANDOFF.md                         # This document
```

---

## 3. Integrations — Complete Map

### 3.1 ClinicalTrials.gov (Public API — no auth)
- **Endpoint:** `https://clinicaltrials.gov/api/v2/studies?query.id={nctIds}`
- **Used in:** `services/ingestion/swarm.ts`, `lib/clinicalTrialsClient.ts`
- **Data pulled:** overallStatus, enrollment, primaryOutcomes, completionDate, sponsors, collaborators, conditions, hasResults, adverseEventsModule
- **Pattern:** Fetch → compare against stored baseline in Replit DB → run Signal Engine on delta

### 3.2 Notion (via Replit Integration — OAuth)
- **Connector:** `notion` (Replit-managed)
- **Databases configured:**
  | DB Name | Settings Key | Purpose |
  |---|---|---|
  | Regulatory | `notionRegulatoryDbId` | Milestones, due dates, status |
  | AE Log | `notionAeLogDbId` | Adverse events, grade, resolution |
  | Deviation Log | `notionDeviationLogDbId` | Protocol deviations |
  | Competitor Intelligence | `notionCompetitorDbId` | Signal Engine write-back |
  | Trial Action Tasks | `notionTasksDbId` | 48-hour action items from briefs |
- **Reads:** AE counts, Grade 3+ events, deviation count, regulatory milestones
- **Writes:** Intelligence briefs (3 pages per run), action tasks (3 tasks per run)
- **Key files:** `lib/notion.ts`, `lib/notionAeDeviation.ts`, `lib/notionIntelligence.ts`, `services/delivery/notionSink.ts`

### 3.3 Google Sheets (via `google-drive` connector — OAuth)
- **Data pulled:** Enrollment counts, screen failures, protocol dropouts
- **Sheet config:** `googleSheetsId`, `googleSheetTab`, `googleSheetHeaderRow` in settings
- **Key file:** `lib/googleSheets.ts`
- **Note:** Routes through `driveProxy` using `google-drive` connector (Sheets connector has no configured connection)

### 3.4 Google Docs (via `google-drive` connector — OAuth)
- **Template:** Configured via `googleDocsTemplateId`
- **Pattern:** Copy template → fill `{{PLACEHOLDER}}` fields → share with PI email (writer access)
- **Placeholders filled:** `{{REPORT_DATE}}`, `{{TRIAL_ID}}`, `{{ENROLLED}}`, `{{SCREEN_FAILURES}}`, `{{DROPOUTS}}`, `{{AE_COUNT}}`, `{{GRADE3_AE_COUNT}}`, `{{DEVIATION_COUNT}}`, `{{NEXT_MILESTONE}}`, `{{NEXT_MILESTONE_DATE}}`
- **Key file:** `lib/googleDocs.ts`

### 3.5 Gmail (Compose URL — no API scope required)
- **Pattern:** Build pre-filled `https://mail.google.com/mail/?view=cm&fs=1&to=...&su=...&body=...` URL → return to frontend → `window.open()` in new tab → user clicks Send
- **Emails built:** PI Review (sponsor reports), PI Review (intelligence briefs), Nag/reminder
- **Why Compose URLs:** Replit's `google-mail` connector lacks `gmail.send` scope; this is a permanent constraint of the integration
- **Key files:** `lib/gmailClient.ts`, `lib/gmail.ts`

### 3.6 Google Calendar (via Replit Integration — OAuth)
- **Connector:** `google-calendar`
- **Writes:** Regulatory deadline events, sponsor call enrichment
- **Config:** `googleCalendarId`, `sponsorCallEventId`
- **Key files:** `lib/googleCalendar.ts`, `lib/googleCalendarClient.ts`

### 3.7 Replit DB (`@replit/database` v3)
- **Always use `{ok, value}` unwrap pattern** (breaking change in v3)
- **Key namespaces:**
  | Prefix | Content |
  |---|---|
  | `trial:baseline:{nctId}` | First-fetch snapshot (ground truth) |
  | `trial:current:{nctId}` | Latest snapshot |
  | `trial:alerts:{nctId}` | Active `TriggeredAlert[]` array |
  | `watchlist` | Array of watched NCT IDs |
  | `briefs:{id}` | `IntelligenceBrief` records |
  | `reports:{id}` | `SponsorReportRecord` records |
  | `audit:log` | `AuditEntry[]` — full action history |
  | `settings` | `AppSettings` object |

---

## 4. The Agentic Pipeline — Signal Engine Architecture

```
ClinicalTrials.gov
        │
        ▼
  SWARM_INGESTION 📡          POST /internal/swarm-poll
  swarm.ts                    ↳ fetches N trials in one API call
        │                     ↳ stores baseline + current in Replit DB
        ▼
  ORCHESTRATOR 🧠             orchestrator.ts
  runKillChain()              ↳ extracts fields from both snapshots
        │                     ↳ runs 6 deterministic modules
        │
        ├── TerminationDetector  → severity: critical
        ├── ResultsIntelligence  → severity: high
        ├── ToxicityCamouflage   → severity: high
        ├── EnrollmentBleed      → severity: medium  (delta only)
        ├── TimelineShift        → severity: medium  (delta only)
        └── StatusTransition     → severity: medium  (delta only)
        │
        ▼
  ZETA_CORE 🧬                services/delivery/
  notionSink.ts + formatter.ts
        ├── Formats alerts into structured Markdown brief
        ├── Writes 3 intelligence pages → Notion Competitor DB
        └── Creates 3 action tasks (48h deadline) → Notion Tasks DB
        │
        ▼
  SUSAN 👤                    Frontend trigger
  Brief generated →           User clicks "Send to PI"
  Gmail Compose URL →         Opens pre-filled email in new tab
  PI reviews + sends
```

**Audit actors logged throughout:** `SWARM_INGESTION📡`, `ORCHESTRATOR🧠`, `ZETA_CORE🧬`, `SYSTEM⚡`, `SUSAN👤`

---

## 5. Signal Engine — Full Rule Registry

`GET /api/strike/rules` returns all 14 rules. Source: `routes/strike.ts` `KILL_CHAIN_RULES[]`

| Vector | Category | Severity | Mode |
|---|---|---|---|
| `GOALPOST_SHIFT` | Math & Logic | Critical | Delta |
| `TOLERABILITY_BLEED` | Math & Logic | High | Delta |
| `P_HACKING` | Math & Logic | High | Delta |
| `BURN_RATE` | Math & Logic | Medium | Delta |
| `BASELINE_IMBALANCE` | Math & Logic | Medium | Delta |
| `TOXICITY_CAMOUFLAGE` | Semantic | High | Absolute + Delta |
| `GEOGRAPHIC_BOTTLENECK` | Semantic | Medium | Absolute + Delta |
| `PLACEBO_SABOTAGE` | Semantic | High | Delta |
| `NARRATIVE_PIVOT` | Semantic | Medium | Delta |
| `INDICATION_CREEP` | Semantic | Medium | Delta |
| `INDICATION_DESPERATION` | Semantic | High | Delta |
| `PARTNER_BAILOUT` | Operational | Critical | Delta |
| `DATA_SUPPRESSION` | Operational | High | Absolute |
| `GAG_ORDER` | Operational | High | Delta |

> **Gap:** Only 6 of the 14 rules are wired into `orchestrator.ts`. The remaining 8 (everything except TerminationDetector, ResultsIntelligence, ToxicityCamouflage, EnrollmentBleed, TimelineShift, StatusTransition) are defined in the registry for the UI but are **not yet evaluated** in the kill chain. See Section 8.

---

## 6. Sponsor Report Pipeline

```
POST /api/reports/run-monthly
        │
        ├─ 1. Read Google Sheets → enrollment data
        ├─ 2. Read Notion AE Log → AE count, Grade 3+ count
        ├─ 3. Read Notion Deviation Log → deviation count
        ├─ 4. Read Notion Regulatory DB → next milestone + date
        ├─ 5. Copy Google Docs template → new document
        ├─ 6. Fill {{PLACEHOLDERS}} in new doc
        ├─ 7. Grant PI write access to doc (Google Drive)
        ├─ 8. Save report record to Replit DB (status: Draft)
        ├─ 9. Build Gmail Compose URL (with Notion AE/deviation links)
        └─ 10. Return { report, composeUrl } → frontend opens Gmail tab
```

Report lifecycle states: `Draft → PI Review → Approved → Sent → Discarded`

---

## 7. Data Schema — Key Interfaces

```typescript
// services/types.ts
interface TriggeredAlert {
  nctId: string;
  detectedAt: string;
  module: string;           // e.g. "GOALPOST_SHIFT"
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  detail: string;
}

// lib/briefHistory.ts
interface IntelligenceBrief {
  id: string;
  docUrl: string;
  docId: string;
  alertCount: number;
  alertIds: string[];       // "NCTxxxxxxxx:module" format
  status: "Draft" | "PI Review" | "Approved" | "Final" | "Discarded";
  generatedAt: string;
  sentToPiAt?: string;
}

// lib/reportHistory.ts
interface SponsorReportRecord {
  id: string;
  docUrl: string;
  status: "Draft" | "PI Review" | "Approved" | "Sent" | "Discarded";
  generatedAt: string;
  sentToPiAt?: string;
  lastNagAt?: string;
}

// lib/settings.ts
interface AppSettings {
  notionRegulatoryDbId: string;
  notionAeLogDbId: string;
  notionDeviationLogDbId: string;
  notionCompetitorDbId: string;
  notionTasksDbId: string;
  googleCalendarId: string;
  googleSheetsId: string;
  googleSheetTab: string;
  googleSheetHeaderRow: number;
  googleDocsTemplateId: string;
  sponsorCallEventId: string;
  piEmail: string;
  sponsorEmail: string;
  nagIntervalHours: number;
}
```

---

## 8. Known Gaps — Priority Order

| # | Gap | Impact | Effort |
|---|---|---|---|
| 1 | **8 of 14 Signal Engine rules not wired** into `orchestrator.ts` — they exist in the registry but never fire | False sense of coverage | Medium |
| 2 | **Gmail send scope unavailable** — Compose URL workaround requires manual user action | PI handoff not fully automated | Blocked by Replit integration |
| 3 | **No polling scheduler** — `POST /internal/swarm-poll` must be called manually (via frontend "Refresh Swarm" button) | No autonomous monitoring without human trigger | Low (needs cron/webhook) |
| 4 | **COMMAND_TURNOVER rule omitted** — requires multi-cycle delta history chain not yet built | Incomplete leadership change detection | Medium |
| 5 | **Semantic rules use stub logic** — NARRATIVE_PIVOT, INDICATION_DESPERATION etc. have trigger conditions defined but no real embedding/NLP evaluation | Semantic category doesn't actually fire | High (needs embedding model) |
| 6 | **Single-tenant** — all settings, trial data, and reports belong to one user. No auth layer, no org concept | Cannot productize as-is | High |
| 7 | **No real-time push** — frontend polls on load; no WebSocket or SSE for live alert delivery | Users miss alerts between page visits | Medium |
| 8 | **OpenAI client exists** (`lib/openaiClient.ts`) but is unused | LLM-enriched alerts not available | Low (infrastructure ready) |
| 9 | **No test coverage** — no unit or integration tests for the kill chain or report pipeline | Regression risk on rule changes | Medium |
| 10 | **Nag engine logs URL but doesn't deliver it** — nag compose URLs are generated and logged server-side but never surfaced to the user | Reminder loop is incomplete | Low |

---

## 9. Expansion Possibilities

### 9.1 Immediate (1–2 sprints)
- **Wire remaining 8 kill-chain rules** — the `orchestrator.ts` function needs extractor helpers for `primaryOutcomes`, `secondaryOutcomes`, `armGroups`, `conditions`, `collaborators`, `ipdSharing`, and `locations`
- **Add a polling scheduler** — use a cron route or Replit's built-in scheduled deployments to call `/internal/swarm-poll` every 6/12/24 hours autonomously
- **Nag engine UX** — surface the nag compose URL to the frontend via a notification or toast rather than silently logging it
- **PMID/PubMed enrichment** — `resolveTrialPmids()` already exists; wire it into the brief to include citation links

### 9.2 Medium-term (1–2 months)
- **LLM-enriched alerts** — pass alert `detail` + trial snapshot through OpenAI (client already configured) to generate a paragraph of strategic analysis alongside the deterministic trigger
- **Semantic rule execution** — use `text-embedding-3-small` to compute cosine distance for NARRATIVE_PIVOT; use GPT-4 structured output for INDICATION_CREEP classification
- **Multi-trial sponsor reports** — extend the report pipeline to handle a portfolio of trials in a single document
- **Alert deduplication** — current design overwrites all alerts on each poll; add a delta-merge so persistent alerts aren't re-surfaced as new
- **Slack/Teams delivery** — add a delivery sink alongside Gmail Compose for real-time channel alerts

### 9.3 Strategic (3–6 months)
- **Multi-tenancy** — add Clerk Auth (infrastructure already in `.local/skills/clerk-auth`), org-scoped settings, per-user trial watchlists
- **Custom rule builder UI** — extend Signal Engine Configuration to allow non-technical users to define threshold rules via form (vectorName, threshold, field path, severity)
- **Regulatory submission module** — extend the report pipeline to generate IND annual reports, safety reports (SUSAR/CIOMS), and IRB renewals from the same data sources
- **Competitive landscape scoring** — aggregate all monitored trials into a portfolio-level threat score; surface as an executive dashboard widget

---

## 10. SaaS Architecture — The Moat

### What makes this defensible:

**1. The Signal Engine is a proprietary ruleset**
The 14 kill-chain vectors encode deep clinical trial domain knowledge — knowing *which* changes on ClinicalTrials.gov matter (and why) is not obvious. GOALPOST_SHIFT, P_HACKING, TOLERABILITY_BLEED — these names map to real regulatory and competitive intelligence tradecraft. This is expert knowledge encoded as code.

**2. The data pipeline is already integrated**
ClinicalTrials.gov + Notion + Google Workspace + Calendar is a workflow that took significant integration work. A SaaS competitor starts from zero; this system is already wired.

**3. Workflow automation replaces a $150–200/hr CRA task**
The sponsor report pipeline (Sheets → Notion → Docs → email PI) currently takes a CRC 2–4 hours per month. At 100 trials/month, that's $15,000–$40,000 in labor the platform eliminates. This is the billing anchor.

**4. The audit trail is compliance-ready**
Every action (SWARM_INGESTION, ORCHESTRATOR, SUSAN) is logged with actor, action, timestamp, and detail. This audit architecture can be marketed directly to Sponsors and IRBs as 21 CFR Part 11 compliance infrastructure.

### Monetization tiers:

| Tier | Feature Set | Target |
|---|---|---|
| **Solo CRC** | 1 trial, competitor watch (5 trials), manual reports | Individual coordinators |
| **Site** | 5 trials, 20-trial watchlist, autonomous reports, Calendar sync | Investigator sites |
| **Network** | Unlimited trials, portfolio dashboard, custom rules, API access | CRO / Site Networks |
| **Enterprise** | White-label, SSO, 21 CFR Part 11 export, Sponsor portal | Pharma sponsors |

---

## 11. Data Integration Roadmap

| Source | What it unlocks | Complexity |
|---|---|---|
| **PubMed / PubMed Central** | Publication velocity, citation counts, author network changes | Low (public API) |
| **FDA FAERS** | Safety signal cross-reference with your own AE database | Low (public API) |
| **SEC EDGAR** | Sponsor financial health, pipeline write-downs, M&A signals | Low (public API) |
| **EudraCT / CTIS** | European trial coverage (currently US-only) | Medium |
| **WHO ICTRP** | Global trial coverage | Medium |
| **Veeva Vault / Medidata Rave** | Direct EDC integration — real-time enrollment without Sheets | High |
| **CTMS (Oncore, Florence)** | Replace Notion as the source of truth for AEs and deviations | High |
| **OpenFDA** | Drug approval status, label changes, REMS updates | Low |
| **LinkedIn API** | PARTNER_BAILOUT enrichment — detect key personnel departures | Medium |

---

## 12. Automation Roadmap

| Automation | Current State | Next Step |
|---|---|---|
| Trial monitoring | Manual trigger ("Refresh Swarm" button) | Scheduled cron via Replit deployments |
| Report generation | Manual trigger ("Run Monthly Report") | Calendar-triggered on sponsor call date |
| PI reminders | Logic built, URL logged server-side | Surface nag URL in frontend notification |
| Notion write-back | Fires on every brief generation | Add deduplication by nctId + module |
| Regulatory calendar | Manual sync button | Auto-sync on Notion DB change webhook |
| Alert delivery | Frontend polling | WebSocket/SSE for live push |
| Competitor analysis | Deterministic rules only | LLM enrichment layer on top of signal triggers |

---

## 13. Instructions for Agents Building On Top

### Adding a new Signal Engine rule
1. Add the rule definition to `KILL_CHAIN_RULES[]` in `routes/strike.ts` (this surfaces it in the UI automatically)
2. Add the evaluation logic to `runKillChain()` in `services/exploitation/orchestrator.ts`
3. Add the field extractor to `extractFields()` in the same file
4. The alert will automatically flow through to Notion write-back and the brief formatter

### Adding a new data source
1. Create `lib/yourSource.ts` with a typed fetch function
2. Add the connection probe to `routes/integrations.ts` → `probeYourSource()`
3. Wire into the report pipeline (`routes/reports.ts`) or the ingestion pipeline (`services/ingestion/swarm.ts`)
4. Add the settings key to `lib/settings.ts` → `AppSettings` interface

### Adding a new email template
- Edit `lib/gmail.ts` — follow the existing `sendPiReviewEmail` pattern
- Returns a `Promise<string>` (the compose URL)
- Frontend calls `window.open(composeUrl, "_blank", "noopener,noreferrer")`

### Adding a new page
1. Create `artifacts/clinical-trials/src/pages/YourPage.tsx` — import `LayoutShell` as wrapper
2. Add route in `artifacts/clinical-trials/src/App.tsx`
3. Add nav item in `artifacts/clinical-trials/src/components/layout-shell.tsx`

### API conventions
- All routes return JSON; errors use `ApiError(status, message)` → `handleError(err, res)`
- Zod schemas live in `lib/api-zod/` — parse all request/response bodies
- DB access always uses `{ok, value}` unwrap pattern (Replit DB v3 breaking change)
- Import paths use `.js` extension for ESM compatibility (e.g. `import ... from "../lib/settings.js"`)

---

## 14. Environment Variables / Secrets

All configured via Replit Secrets panel. No `.env` file.

| Key | Purpose |
|---|---|
| `NAG_SECRET` | Auth header for `/internal/swarm-poll` endpoint |
| *(Google OAuth)* | Managed by Replit integrations — no manual config needed |
| *(Notion OAuth)* | Managed by Replit integrations — no manual config needed |

All other configuration (DB IDs, email addresses, sheet IDs) is stored in `settings` key in Replit DB and managed via the Connection Setup page in the UI.

---

*Generated by Clinical Trials Co-Pilot · Built on Replit*
