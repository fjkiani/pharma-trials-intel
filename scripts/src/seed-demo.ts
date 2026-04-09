/**
 * seed-demo.ts
 *
 * Populates demo data for the Clinical Trials Co-Pilot.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed
 *
 * Prerequisites:
 * - Set NOTION_TOKEN env var (your Notion integration token)
 * - Set GOOGLE_SHEETS_ID env var (the ID of the enrollment sheet)
 * - Set GOOGLE_SERVICE_ACCOUNT_KEY env var (path to service account JSON) OR
 *   rely on Application Default Credentials
 *
 * OR configure all in the Settings page and this script reads from Replit DB.
 *
 * Notion DB IDs must be configured in the app settings first.
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
  return (stored ?? {}) as AppSettings;
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
  console.log("🔬 Seeding AE Log...");

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
  console.log("📋 Seeding Deviation Log...");

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
  console.log("📅 Seeding Regulatory Milestones...");

  const today = new Date();
  const soon = new Date(today);
  soon.setDate(today.getDate() + 12);
  const future = new Date(today);
  future.setDate(today.getDate() + 90);
  const past = new Date(today);
  past.setDate(today.getDate() - 15);

  const milestones = [
    {
      name: "IRB Approval — Initial",
      date: past.toISOString().split("T")[0],
      status: "Expired",
    },
    {
      name: "Informed Consent Form v2.1",
      date: soon.toISOString().split("T")[0],
      status: "Expiring Soon",
    },
    {
      name: "FDA Form 1572 — Site Investigator",
      date: future.toISOString().split("T")[0],
      status: "Current",
    },
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

async function seedGoogleSheet(sheetId: string, tabName: string): Promise<void> {
  console.log("📊 Seeding Google Sheet enrollment data...");
  console.log(
    "  ⚠️  Google Sheets seed requires googleapis credentials (service account or ADC).",
  );
  console.log("  Manual setup: open the sheet and populate:");
  console.log("    Row 1: Metric | Value (headers)");
  console.log("    Row 2: Enrolled | 42");
  console.log("    Row 3: Screened | 67");
  console.log("    Row 4: Screen Failures | 18");
  console.log("    Row 5: Withdrawals | 7");
  console.log("");
  console.log(
    `  Sheet ID: ${sheetId}  Tab: ${tabName}`,
  );
  console.log(
    "  To trigger the staleness warning in demo, do NOT update the sheet for 26+ hours.",
  );
}

async function main() {
  console.log("🌱 Clinical Trials Co-Pilot — Demo Seed Script");
  console.log("================================================\n");

  const settings = await getSettings();

  if (!process.env.NOTION_TOKEN) {
    console.error(
      "❌ NOTION_TOKEN env var not set. Please set it to your Notion integration token.",
    );
    process.exit(1);
  }

  const requiredSettings = [
    ["notionAeLogDbId", "AE Log Notion DB ID"],
    ["notionDeviationLogDbId", "Deviation Log Notion DB ID"],
    ["notionRegulatoryDbId", "Regulatory Milestones Notion DB ID"],
  ] as const;

  let hasErrors = false;
  for (const [key, label] of requiredSettings) {
    if (!settings[key]) {
      console.error(`❌ ${label} not set in app settings (Settings page → ${label})`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error(
      "\nPlease configure all required settings in the app before running the seed script.",
    );
    process.exit(1);
  }

  try {
    await seedAeLog(settings.notionAeLogDbId);
    await seedDeviationLog(settings.notionDeviationLogDbId);
    await seedRegulatoryMilestones(settings.notionRegulatoryDbId);

    if (settings.googleSheetsId) {
      await seedGoogleSheet(
        settings.googleSheetsId,
        settings.googleSheetTab || "Sheet1",
      );
    } else {
      console.log("⚠️  Google Sheets ID not configured — skipping sheet seed.");
    }

    console.log("\n✅ Demo seed complete!");
    console.log("\nNext steps for demo:");
    console.log("1. Create a Google Doc with the placeholder template (see SKILL.md)");
    console.log("2. Set the Google Docs Template ID in Settings");
    console.log("3. Set PI Email in Settings");
    console.log("4. Connect Google Sheets, Google Drive, Google Docs, and Gmail integrations");
    console.log("5. Click Generate Report in the Sponsor Reports page");
  } catch (err) {
    console.error("\n❌ Seed failed:", err);
    process.exit(1);
  }
}

main();
