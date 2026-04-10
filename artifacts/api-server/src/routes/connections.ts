import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { updateSettings } from "../lib/settings.js";
import { getUncachableNotionClient } from "../lib/notionClient.js";
import { driveProxy } from "../lib/googleDriveClient.js";
import { getGoogleOAuth2Client } from "../lib/googleOAuthClient.js";
import { getUncachableGoogleCalendarClient } from "../lib/googleCalendarClient.js";
import { appendAudit, getAuditLog } from "../lib/auditLog.js";
import { google } from "googleapis";

const router: IRouter = Router();
const connectors = new ReplitConnectors();

function toNotionUuid(id: string): string {
  const raw = id.replace(/-/g, "");
  if (raw.length !== 32) return id;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

// -------------------------------------------------------------------------
// Discovery
// -------------------------------------------------------------------------

router.post("/connections/discover", async (_req, res): Promise<void> => {
  const results: {
    name: string;
    type: string;
    connector: string;
    id: string;
    label: string;
  }[] = [];

  const errors: string[] = [];

  // --- Notion: only surface the 3 ONCO-247 databases by name ---
  // These are the exact database names shared with the Replit integration.
  const ONCO247_NOTION_DBS: Array<{
    nameMatch: string[];
    role: "notionRegulatoryDbId" | "notionDeviationLogDbId" | "notionAeLogDbId";
    label: string;
  }> = [
    {
      nameMatch: ["regulatory milestones", "regulatory", "milestone"],
      role: "notionRegulatoryDbId",
      label: "Regulatory Milestones",
    },
    {
      nameMatch: ["protocol deviations log", "deviation", "protocol deviations"],
      role: "notionDeviationLogDbId",
      label: "Protocol Deviations Log",
    },
    {
      nameMatch: ["clinical trials co-pilot", "co-pilot", "adverse", "ae log", "clinical trials copilot"],
      role: "notionAeLogDbId",
      label: "Clinical Trials Co-Pilot",
    },
  ];

  try {
    const notionResponse = await connectors.proxy("notion", "/v1/search", {
      method: "POST",
      body: JSON.stringify({ filter: { value: "database", property: "object" }, page_size: 50 }),
    });
    if (notionResponse.ok) {
      const data = (await (notionResponse as unknown as Response).json()) as {
        results?: Record<string, unknown>[];
      };
      for (const db of data.results ?? []) {
        const rawTitle = db.title as Array<{ plain_text?: string }> | undefined;
        const title = rawTitle?.[0]?.plain_text ?? "Untitled";
        const id = (db.id as string) ?? "";
        const titleLower = title.toLowerCase();

        // Only include the 3 ONCO-247 databases — ignore everything else
        const matched = ONCO247_NOTION_DBS.find((entry) =>
          entry.nameMatch.some((m) => titleLower.includes(m)),
        );
        if (!matched) continue;

        results.push({
          name: title,
          type: "notion-database",
          connector: "notion",
          id,
          label: `Notion DB: ${matched.label}`,
        });
      }
    } else {
      const text = await (notionResponse as unknown as Response).text();
      errors.push(`Notion search failed (${notionResponse.status}): ${text.slice(0, 200)}`);
    }
  } catch (e) {
    errors.push(`Notion discovery error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // --- Google Drive: only surface ONCO-247-relevant Sheets and Docs ---
  // Filter by name keywords so personal files are never shown in the wizard.
  const ONCO247_DRIVE_KEYWORDS = [
    "onco",
    "enrollment extract",
    "sponsor report template",
    "clinical trial",
    "clinical trials",
  ];

  try {
    const driveRes = await driveProxy("/drive/v3/files", {
      params: {
        pageSize: "100",
        fields: "files(id,name,mimeType)",
        q: "mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.document'",
      },
    });
    if (driveRes.ok) {
      const data = (await (driveRes as Response).json()) as {
        files?: { id: string; name: string; mimeType: string }[];
      };
      for (const file of data.files ?? []) {
        const nameLower = file.name.toLowerCase();
        const isRelevant = ONCO247_DRIVE_KEYWORDS.some((kw) => nameLower.includes(kw));
        if (!isRelevant) continue;

        const type = file.mimeType.includes("spreadsheet") ? "google-sheet" : "google-doc";
        const typeLabel = file.mimeType.includes("spreadsheet") ? "Google Sheet" : "Google Doc";
        results.push({
          name: file.name,
          type,
          connector: "google-drive",
          id: file.id,
          label: `${typeLabel}: ${file.name}`,
        });
      }
    } else {
      const text = await (driveRes as Response).text();
      errors.push(`Drive list failed (${driveRes.status}): ${text.slice(0, 200)}`);
    }
  } catch (e) {
    errors.push(`Drive discovery error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // --- Google Calendar: list calendars + search for sponsor call event ---
  let sponsorCallEvent: { id: string; summary: string; start: string } | null = null;
  try {
    const cal = await getUncachableGoogleCalendarClient();

    const calListRes = await cal.calendarList.list({ maxResults: 20 });

    // Only surface the primary calendar — skip shared, family, holiday, and classroom calendars
    const primaryCalendar = calListRes.data.items?.find((c) => c.primary) ?? calListRes.data.items?.[0];
    if (primaryCalendar?.id && primaryCalendar.summary) {
      results.push({
        name: primaryCalendar.summary,
        type: "google-calendar",
        connector: "google-calendar",
        id: primaryCalendar.id,
        label: `Calendar: ${primaryCalendar.summary}`,
      });
    }
    if (primaryCalendar?.id) {
      const now = new Date().toISOString();
      const eventsRes = await cal.events.list({
        calendarId: primaryCalendar.id,
        q: "sponsor",
        timeMin: now,
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      });
      const sponsorEvents = eventsRes.data.items ?? [];
      if (sponsorEvents.length > 0) {
        const first = sponsorEvents[0];
        sponsorCallEvent = {
          id: first.id ?? "",
          summary: first.summary ?? "Sponsor Call",
          start: first.start?.dateTime ?? first.start?.date ?? "",
        };
      }
    }
  } catch (e) {
    errors.push(`Calendar discovery error: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const r of results) {
    await appendAudit({ resource: r.name, action: "discovered", result: `Found ${r.type}: ${r.id}` });
  }

  res.json({ resources: results, sponsorCallEvent, errors });
});

// -------------------------------------------------------------------------
// Validation data contracts
// -------------------------------------------------------------------------

const NOTION_CONTRACTS: Record<string, { required: string[]; optional: string[] }> = {
  notionAeLogDbId: {
    required: ["Grade"],
    optional: ["Severity", "Status", "AE Description", "Date Reported"],
  },
  notionDeviationLogDbId: {
    required: ["Severity"],
    optional: ["Type", "Status", "Protocol", "Description", "Date"],
  },
  notionRegulatoryDbId: {
    required: ["Document Name", "Expiration Date"],
    optional: ["Status", "File Link"],
  },
};

const SHEETS_REQUIRED_COLUMNS = ["Patient", "Status"];
const SHEETS_OPTIONAL_COLUMNS = ["Enrolled", "Screen", "Withdrawal", "Screen Failure", "Site"];

const EXPECTED_DOC_PLACEHOLDERS = [
  "{{enrolled}}", "{{screened}}", "{{screen_failures}}", "{{withdrawals}}",
  "{{ae_count}}", "{{ae_grade3_plus}}", "{{deviation_count}}", "{{major_deviations}}",
  "{{next_milestone}}", "{{next_milestone_date}}", "{{report_date}}",
];

type ResourceRole =
  | "notionAeLogDbId"
  | "notionDeviationLogDbId"
  | "notionRegulatoryDbId"
  | "googleSheetsId"
  | "googleDocsTemplateId"
  | "googleCalendarId"
  | "sponsorCallEventId";

const EXPECTED_NOTION_ROLES = ["notionAeLogDbId", "notionDeviationLogDbId", "notionRegulatoryDbId"] as const;
const EXPECTED_DRIVE_ROLES = ["googleSheetsId", "googleDocsTemplateId"] as const;
const EXPECTED_CALENDAR_ROLES = ["googleCalendarId"] as const;

interface ValidationResult {
  role: ResourceRole;
  id: string;
  verdict: "pass" | "warn" | "fail";
  reason: string;
  schemaDetails?: string;
}

// -------------------------------------------------------------------------
// Notion DB schema probe — reads /v1/databases/{id} to get property list
// -------------------------------------------------------------------------

async function probeNotionSchema(databaseId: string): Promise<{
  properties: string[];
  ok: boolean;
  errorMsg?: string;
}> {
  const uuid = toNotionUuid(databaseId);
  try {
    const res = await connectors.proxy("notion", `/v1/databases/${uuid}`, {
      method: "GET",
    });
    if (!res.ok) {
      const text = await (res as unknown as Response).text();
      return { properties: [], ok: false, errorMsg: `${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await (res as unknown as Response).json()) as {
      properties?: Record<string, unknown>;
    };
    const props = Object.keys(data.properties ?? {});
    return { properties: props, ok: true };
  } catch (e) {
    return {
      properties: [],
      ok: false,
      errorMsg: e instanceof Error ? e.message.slice(0, 200) : String(e),
    };
  }
}

// -------------------------------------------------------------------------
// Validate endpoint — does NOT write to DB; verdicts only
// -------------------------------------------------------------------------

router.post("/connections/validate", async (req, res): Promise<void> => {
  const mapping = req.body as Partial<Record<ResourceRole, string>>;
  const results: ValidationResult[] = [];

  // --- Validate Notion databases: schema + row check ---
  for (const role of EXPECTED_NOTION_ROLES) {
    const id = mapping[role];
    if (!id) {
      results.push({ role, id: "", verdict: "fail", reason: `No database assigned for ${role}.` });
      await appendAudit({ resource: role, action: "validated", result: "fail: no ID provided" });
      continue;
    }

    try {
      const schema = await probeNotionSchema(id);
      if (!schema.ok) {
        results.push({ role, id, verdict: "fail", reason: `Cannot read database schema: ${schema.errorMsg}` });
        await appendAudit({ resource: role, action: "validated", result: "fail: schema error" });
        continue;
      }

      const contract = NOTION_CONTRACTS[role];
      const requiredMissing = contract.required.filter((p) => !schema.properties.includes(p));

      if (requiredMissing.length > 0) {
        results.push({
          role,
          id,
          verdict: "fail",
          reason: `Database is accessible but missing required columns: ${requiredMissing.join(", ")}.`,
          schemaDetails: `Properties found: ${schema.properties.join(", ")}`,
        });
        await appendAudit({ resource: role, action: "validated", result: `fail: missing required columns ${requiredMissing.join(", ")}` });
        continue;
      }

      const client = getUncachableNotionClient();
      const data = await client.queryDatabase(id, { page_size: 1 });
      const rowCount = data.results.length;
      const schemaNote = `Has the required columns: ${contract.required.join(", ")}.`;

      if (rowCount === 0) {
        results.push({
          role,
          id,
          verdict: "warn",
          reason: `Database accessible but returned 0 records — confirm it is shared with the Replit integration. ${schemaNote}`,
          schemaDetails: `Properties found: ${schema.properties.join(", ")}`,
        });
        await appendAudit({ resource: role, action: "validated", result: "warn: 0 rows, schema OK" });
      } else {
        results.push({
          role,
          id,
          verdict: "pass",
          reason: `${schemaNote} Found ${rowCount}+ record(s).`,
          schemaDetails: `Properties found: ${schema.properties.slice(0, 8).join(", ")}${schema.properties.length > 8 ? "…" : ""}`,
        });
        await appendAudit({ resource: role, action: "validated", result: `pass: schema OK, ${rowCount} rows` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ role, id, verdict: "fail", reason: `Cannot read database: ${msg.slice(0, 200)}` });
      await appendAudit({ resource: role, action: "validated", result: `fail: ${msg.slice(0, 200)}` });
    }
  }

  // --- Validate Google Sheet: read CSV and check column headers ---
  const sheetsId = mapping["googleSheetsId"];
  if (!sheetsId) {
    results.push({ role: "googleSheetsId", id: "", verdict: "fail", reason: "No Sheet assigned." });
    await appendAudit({ resource: "googleSheetsId", action: "validated", result: "fail: no ID provided" });
  } else {
    try {
      const driveRes = await driveProxy(`/drive/v3/files/${sheetsId}/export`, {
        params: { mimeType: "text/csv" },
      });
      if (driveRes.ok) {
        const csv = await (driveRes as Response).text();
        const lines = csv.split("\n").filter((l) => l.trim().length > 0);
        const headerRow = lines[0] ?? "";
        const cols = headerRow.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        const dataRowCount = lines.length - 1;

        const missingRequired = SHEETS_REQUIRED_COLUMNS.filter(
          (req) => !cols.some((c) => c.toLowerCase().includes(req.toLowerCase()))
        );

        if (missingRequired.length > 0) {
          results.push({
            role: "googleSheetsId",
            id: sheetsId,
            verdict: "fail",
            reason: `Enrollment Sheet is readable but missing required columns: ${missingRequired.join(", ")}. Found: ${cols.slice(0, 6).join(", ")}.`,
            schemaDetails: `All columns: ${cols.join(", ")}`,
          });
          await appendAudit({ resource: "googleSheetsId", action: "validated", result: `fail: missing required columns ${missingRequired.join(", ")}` });
        } else {
          const optionalFound = SHEETS_OPTIONAL_COLUMNS.filter(
            (opt) => cols.some((c) => c.toLowerCase().includes(opt.toLowerCase()))
          );
          results.push({
            role: "googleSheetsId",
            id: sheetsId,
            verdict: "pass",
            reason: `Enrollment Sheet is readable. Found ${cols.length} columns and ${dataRowCount} data row(s). Detected: ${optionalFound.length > 0 ? optionalFound.join(", ") : cols.slice(0, 4).join(", ")}.`,
            schemaDetails: `Headers: ${cols.slice(0, 8).join(", ")}${cols.length > 8 ? "…" : ""}`,
          });
          await appendAudit({ resource: "googleSheetsId", action: "validated", result: `pass: ${cols.length} cols, ${dataRowCount} rows` });
        }
      } else {
        const text = await (driveRes as Response).text();
        results.push({
          role: "googleSheetsId",
          id: sheetsId,
          verdict: "fail",
          reason: `Could not read sheet (${driveRes.status}): ${text.slice(0, 200)}`,
        });
        await appendAudit({ resource: "googleSheetsId", action: "validated", result: `fail: HTTP ${driveRes.status}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ role: "googleSheetsId", id: sheetsId, verdict: "fail", reason: `Sheet read error: ${msg.slice(0, 200)}` });
      await appendAudit({ resource: "googleSheetsId", action: "validated", result: `fail: ${msg.slice(0, 200)}` });
    }
  }

  // --- Validate Google Docs template: read placeholders via Docs API ---
  const docsId = mapping["googleDocsTemplateId"];
  if (!docsId) {
    results.push({ role: "googleDocsTemplateId", id: "", verdict: "fail", reason: "No Docs template assigned." });
    await appendAudit({ resource: "googleDocsTemplateId", action: "validated", result: "fail: no ID provided" });
  } else {
    try {
      const auth = await getGoogleOAuth2Client("google-drive");
      const docs = google.docs({ version: "v1", auth });
      const doc = await docs.documents.get({ documentId: docsId });

      function extractText(elements: import("googleapis").docs_v1.Schema$StructuralElement[]): string {
        let text = "";
        for (const el of elements) {
          if (el.paragraph) {
            for (const pe of el.paragraph.elements ?? []) text += pe.textRun?.content ?? "";
          } else if (el.table) {
            for (const row of el.table.tableRows ?? []) {
              for (const cell of row.tableCells ?? []) text += extractText(cell.content ?? []);
            }
          }
        }
        return text;
      }

      const text = extractText(doc.data.body?.content ?? []);
      const placeholders = [...new Set(text.match(/\{\{[^}]+\}\}/g) ?? [])];
      const matched = EXPECTED_DOC_PLACEHOLDERS.filter((p) => placeholders.includes(p));
      const missing = EXPECTED_DOC_PLACEHOLDERS.filter((p) => !placeholders.includes(p));

      if (placeholders.length === 0) {
        results.push({
          role: "googleDocsTemplateId",
          id: docsId,
          verdict: "warn",
          reason: `Report template is readable but has no {{placeholder}} variables. Confirm this is the correct template.`,
        });
        await appendAudit({ resource: "googleDocsTemplateId", action: "validated", result: "warn: no placeholders" });
      } else {
        const verdict = missing.length === 0 ? "pass" : "warn";
        const matchedNote = `${matched.length} of ${EXPECTED_DOC_PLACEHOLDERS.length} expected placeholders matched.`;
        const missingNote = missing.length > 0 ? ` Missing: ${missing.join(", ")}` : "";
        results.push({
          role: "googleDocsTemplateId",
          id: docsId,
          verdict,
          reason: `Report template has ${placeholders.length} placeholder(s). ${matchedNote}${missingNote}`,
          schemaDetails: `Placeholders found: ${placeholders.join(", ")}`,
        });
        await appendAudit({
          resource: "googleDocsTemplateId",
          action: "validated",
          result: `${verdict}: ${matched.length}/${EXPECTED_DOC_PLACEHOLDERS.length} placeholders matched`,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ role: "googleDocsTemplateId", id: docsId, verdict: "fail", reason: `Cannot read template doc: ${msg.slice(0, 200)}` });
      await appendAudit({ resource: "googleDocsTemplateId", action: "validated", result: `fail: ${msg.slice(0, 200)}` });
    }
  }

  // --- Validate Google Calendar ---
  const calId = mapping["googleCalendarId"];
  if (!calId) {
    results.push({ role: "googleCalendarId", id: "", verdict: "fail", reason: "No Calendar assigned." });
    await appendAudit({ resource: "googleCalendarId", action: "validated", result: "fail: no ID provided" });
  } else {
    try {
      const cal = await getUncachableGoogleCalendarClient();
      const eventsRes = await cal.events.list({
        calendarId: calId,
        maxResults: 1,
        singleEvents: true,
        timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      results.push({
        role: "googleCalendarId",
        id: calId,
        verdict: "pass",
        reason: `Calendar is accessible. Found ${eventsRes.data.items?.length ?? 0} recent event(s).`,
      });
      await appendAudit({ resource: "googleCalendarId", action: "validated", result: "pass: calendar reachable" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ role: "googleCalendarId", id: calId, verdict: "fail", reason: `Calendar error: ${msg.slice(0, 200)}` });
      await appendAudit({ resource: "googleCalendarId", action: "validated", result: `fail: ${msg.slice(0, 200)}` });
    }
  }

  // allPass only when every result is "pass" — warns are not sufficient
  const allPass = results.every((r) => r.verdict === "pass");
  res.json({ results, allPass });
});

// -------------------------------------------------------------------------
// Confirm endpoint — writes validated IDs to settings DB
// -------------------------------------------------------------------------

router.post("/connections/confirm", async (req, res): Promise<void> => {
  const mapping = req.body as Partial<Record<ResourceRole, string>>;

  const settingsToWrite: Record<string, string | number> = {};
  for (const role of [...EXPECTED_NOTION_ROLES, ...EXPECTED_DRIVE_ROLES, ...EXPECTED_CALENDAR_ROLES]) {
    const id = mapping[role];
    if (id) settingsToWrite[role] = id;
  }
  if (mapping["sponsorCallEventId"]) settingsToWrite["sponsorCallEventId"] = mapping["sponsorCallEventId"];

  if (Object.keys(settingsToWrite).length === 0) {
    res.status(400).json({ error: "No IDs provided to confirm." });
    return;
  }

  await updateSettings(settingsToWrite as Parameters<typeof updateSettings>[0]);
  await appendAudit({ resource: "all", action: "confirmed", result: `Settings written: ${Object.keys(settingsToWrite).join(", ")}` });

  res.json({ ok: true, written: Object.keys(settingsToWrite) });
});

// -------------------------------------------------------------------------
// Audit log
// -------------------------------------------------------------------------

router.get("/connections/audit", async (_req, res): Promise<void> => {
  const entries = await getAuditLog(50);
  res.json({ entries });
});

export default router;
