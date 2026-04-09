/**
 * seed-demo.ts
 *
 * Populates demo data for the Clinical Trials Co-Pilot.
 *
 * Usage:
 *   NOTION_TOKEN=xxx pnpm --filter @workspace/scripts run seed
 *
 * Optional env vars:
 *   NOTION_TOKEN   — your Notion integration token (required for Notion seed)
 *
 * All Google Workspace writes (Sheets) use the Replit Connectors proxy
 * (same as the main API server). The Google Drive connector must be connected.
 *
 * Notion DB IDs and Google Sheets ID must be saved in app Settings first.
 */

import Database from "@replit/database";

const db = new Database();
const SETTINGS_KEY = "app:settings";

interface AppSettings {
  notionRegulatoryDbId: string;
  notionAeLogDbId: string;
  notionDeviationLogDbId: string;
  googleSheetsId: string;
  googleSheetTab: string;
  googleSheetHeaderRow: number;
  googleDocsTemplateId: string;
  piEmail: string;
  sponsorEmail: string;
  nagIntervalHours: number;
  googleCalendarId: string;
  sponsorCallEventId: string;
}

async function getSettings(): Promise<AppSettings> {
  const stored = await db.get(SETTINGS_KEY);
  return (stored ?? {}) as unknown as AppSettings;
}

const NOTION_HEADERS = {
  Authorization: `Bearer ${process.env.NOTION_TOKEN ?? ""}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28",
};

async function notionCreate(
  databaseId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: NOTION_HEADERS,
    body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion create failed (${res.status}): ${err}`);
  }
}

async function seedAeLog(dbId: string): Promise<void> {
  console.log("🔬 Seeding AE Log (4 entries)...");

  const aes = [
    { name: "Mild injection site reaction", grade: "Grade 1", date: "2026-03-05", resolved: true },
    { name: "Mild fatigue", grade: "Grade 1", date: "2026-03-12", resolved: true },
    { name: "Moderate nausea and vomiting", grade: "Grade 2", date: "2026-03-20", resolved: false },
    { name: "Severe transaminase elevation", grade: "Grade 3", date: "2026-04-01", resolved: false },
  ];

  for (const ae of aes) {
    await notionCreate(dbId, {
      "AE Description": { title: [{ type: "text", text: { content: ae.name } }] },
      Grade: { select: { name: ae.grade } },
      "Date Reported": { date: { start: ae.date } },
      Resolved: { checkbox: ae.resolved },
    });
    console.log(`  ✓ ${ae.name} (${ae.grade})`);
  }
}

async function seedDeviationLog(dbId: string): Promise<void> {
  console.log("📋 Seeding Deviation Log (2 entries)...");

  const devs = [
    { name: "Missed protocol-required visit window (±3 days)", date: "2026-03-15", severity: "Minor" },
    { name: "Study drug administered outside protocol temperature range", date: "2026-04-02", severity: "Major" },
  ];

  for (const dev of devs) {
    await notionCreate(dbId, {
      "Deviation Type": { title: [{ type: "text", text: { content: dev.name } }] },
      Date: { date: { start: dev.date } },
      Severity: { select: { name: dev.severity } },
    });
    console.log(`  ✓ ${dev.name} (${dev.severity})`);
  }
}

async function seedRegulatoryMilestones(dbId: string): Promise<void> {
  console.log("📅 Seeding Regulatory Milestones (3 entries)...");

  const today = new Date();
  const soon = new Date(today);
  soon.setDate(today.getDate() + 12);
  const future = new Date(today);
  future.setDate(today.getDate() + 90);
  const past = new Date(today);
  past.setDate(today.getDate() - 15);

  const milestones = [
    { name: "IRB Approval — Initial", date: past.toISOString().split("T")[0], status: "Expired" },
    { name: "Informed Consent Form v2.1", date: soon.toISOString().split("T")[0], status: "Expiring Soon" },
    { name: "FDA Form 1572 — Site Investigator", date: future.toISOString().split("T")[0], status: "Current" },
  ];

  for (const m of milestones) {
    await notionCreate(dbId, {
      "Document Name": { title: [{ type: "text", text: { content: m.name } }] },
      "Expiration Date": { date: { start: m.date } },
      Status: { select: { name: m.status } },
    });
    console.log(`  ✓ ${m.name} (${m.status}, expires ${m.date})`);
  }
}

async function getConnectorsToken(): Promise<string | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) return null;

  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) return null;

  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=google-drive`,
    {
      headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
    },
  );
  const data = (await res.json()) as { items?: Array<{ settings?: { access_token?: string; oauth?: { credentials?: { access_token?: string } } } }> };
  const conn = (data.items ?? [])[0];
  return (
    conn?.settings?.access_token ??
    conn?.settings?.oauth?.credentials?.access_token ??
    null
  );
}

async function sheetsApiPut(
  sheetId: string,
  range: string,
  values: string[][],
  accessToken: string,
): Promise<void> {
  const encodedRange = encodeURIComponent(range);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets PUT failed (${res.status}): ${err}`);
  }
}

async function seedGoogleSheet(
  sheetId: string,
  tabName: string,
  headerRow: number,
): Promise<void> {
  console.log("📊 Seeding Google Sheet enrollment data...");

  const accessToken = await getConnectorsToken();
  if (!accessToken) {
    console.log("  ⚠️  Google Drive connector not available in this context.");
    console.log("     Manually populate the sheet with:");
    console.log(`       Row ${headerRow}: Metric | Value`);
    console.log(`       Row ${headerRow + 1}: Enrolled | 42`);
    console.log(`       Row ${headerRow + 2}: Screened | 67`);
    console.log(`       Row ${headerRow + 3}: Screen Failures | 18`);
    console.log(`       Row ${headerRow + 4}: Withdrawals | 7`);
    return;
  }

  const startRow = headerRow;
  const range = `'${tabName}'!A${startRow}:B${startRow + 4}`;
  const values = [
    ["Metric", "Value"],
    ["Enrolled", "42"],
    ["Screened", "67"],
    ["Screen Failures", "18"],
    ["Withdrawals", "7"],
  ];

  try {
    await sheetsApiPut(sheetId, range, values, accessToken);
    console.log("  ✓ Wrote enrollment rows: Enrolled=42, Screened=67, Screen Failures=18, Withdrawals=7");
  } catch (err) {
    console.log(`  ⚠️  Sheet write failed: ${err}`);
    console.log("     Populate manually with: Enrolled=42, Screened=67, Screen Failures=18, Withdrawals=7");
    return;
  }

  // ─── Staleness trigger via write+revert ──────────────────────────────────
  // The staleness check reads Google Drive's modifiedTime for the sheet file.
  // We write a dummy marker to a scratch cell, immediately revert it, so the
  // modifiedTime of the file gets bumped to NOW — which also means that
  // simply running the seed sets the clock at T=0.
  // To actually SEE the staleness warning in the demo, do NOT touch the sheet
  // for 26+ hours after seeding (the staleness threshold is 25 h).
  //
  // If you want to demo the warning immediately without waiting, open the
  // sheet in Google Drive, edit any cell, save, then manually revert — or ask
  // a tool like `gcloud` to backdate the modifiedTime.
  const scratchRange = `'${tabName}'!Z1`;
  const scratchMarker = "__seed_ts__";
  try {
    await sheetsApiPut(sheetId, scratchRange, [[scratchMarker]], accessToken);
    // Immediately revert so the cell stays clean
    await sheetsApiPut(sheetId, scratchRange, [[""]], accessToken);
    console.log("  ✓ Staleness clock reset (sheet modifiedTime = now).");
    console.log("     The staleness warning appears on /reports after 25+ hours without a sheet edit.");
  } catch {
    // Non-fatal — enrollment data is already written
    console.log("  ℹ️  Could not reset staleness clock (scratch-cell write failed); enrollment data is still set.");
  }
}

async function main() {
  console.log("🌱 Clinical Trials Co-Pilot — Demo Seed Script");
  console.log("================================================\n");

  const settings = await getSettings();

  const useNotion = !!process.env.NOTION_TOKEN;
  const requiredNotionSettings = [
    ["notionAeLogDbId", "AE Log Notion DB ID"],
    ["notionDeviationLogDbId", "Deviation Log Notion DB ID"],
    ["notionRegulatoryDbId", "Regulatory Milestones Notion DB ID"],
  ] as const;

  if (useNotion) {
    let hasErrors = false;
    for (const [key, label] of requiredNotionSettings) {
      if (!settings[key]) {
        console.error(`❌ ${label} not set in app settings (Settings page → ${label})`);
        hasErrors = true;
      }
    }
    if (hasErrors) {
      console.error("\nConfigure all Notion settings in the app, then rerun.\n");
      process.exit(1);
    }
  } else {
    console.log("ℹ️  NOTION_TOKEN not set — skipping Notion seeding.");
  }

  try {
    if (useNotion) {
      await seedAeLog(settings.notionAeLogDbId);
      await seedDeviationLog(settings.notionDeviationLogDbId);
      await seedRegulatoryMilestones(settings.notionRegulatoryDbId);
    }

    if (settings.googleSheetsId) {
      await seedGoogleSheet(
        settings.googleSheetsId,
        settings.googleSheetTab || "Sheet1",
        settings.googleSheetHeaderRow ?? 1,
      );
    } else {
      console.log("⚠️  Google Sheets ID not configured — skipping sheet seed.");
    }

    console.log("\n✅ Demo seed complete!");
    console.log("\nNext steps:");
    console.log("1. Create a Google Doc template with the placeholders listed in Settings");
    console.log("2. Set the Google Docs Template ID in Settings");
    console.log("3. Set PI Email in Settings");
    console.log("4. Open Sponsor Reports → Generate Report");
  } catch (err) {
    console.error("\n❌ Seed failed:", err);
    process.exit(1);
  }
}

main();
