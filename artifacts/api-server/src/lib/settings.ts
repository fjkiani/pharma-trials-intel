import Database from "@replit/database";

const db = new Database();
const SETTINGS_KEY = "app:settings";

export interface AppSettings {
  notionRegulatoryDbId: string;
  googleCalendarId: string;
  notionAeLogDbId: string;
  notionDeviationLogDbId: string;
  googleSheetsId: string;
  googleSheetTab: string;
  googleSheetHeaderRow: number;
  googleDocsTemplateId: string;
  sponsorCallEventId: string;
  piEmail: string;
  sponsorEmail: string;
  nagIntervalHours: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  notionRegulatoryDbId: "",
  googleCalendarId: "",
  notionAeLogDbId: "",
  notionDeviationLogDbId: "",
  googleSheetsId: "",
  googleSheetTab: "Sheet1",
  googleSheetHeaderRow: 1,
  googleDocsTemplateId: "",
  sponsorCallEventId: "",
  piEmail: "",
  sponsorEmail: "",
  nagIntervalHours: 4,
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await db.get(SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<AppSettings>) };
}

export async function updateSettings(
  updates: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings();
  const updated = { ...current, ...updates };
  await db.set(SETTINGS_KEY, updated);
  return updated;
}
