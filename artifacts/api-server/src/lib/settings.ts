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
  notionRegulatoryDbId: "33d95050449b8067a30df107c7ad0b4d",
  notionAeLogDbId: "33d95050449b8028ab2ce5efd0b9e95c",
  notionDeviationLogDbId: "33d95050449b80cd9429c8dd3ea02e65",
  googleCalendarId: "fjkiani1@gmail.com",
  sponsorCallEventId: "1tt71ni9k949rdus5b478mmkpg",
  googleSheetsId: "1iOlglwaiNmILEE0KxFKlO0Xg4OWHWfeHMqJU46zCnu8",
  googleDocsTemplateId: "147su4CkTd1rjh6MeVryrVTKDnj4mEJjWwVLaEwgGrys",
  googleSheetTab: "Sheet1",
  googleSheetHeaderRow: 1,
  piEmail: "fjkiani1@gmail.com",
  sponsorEmail: "fjkiani1@gmail.com",
  nagIntervalHours: 4,
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await db.get(SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_SETTINGS };
  // Merge stored values, but fall back to defaults for any empty-string fields
  // so hard-coded defaults always fill gaps left by a previous blank save.
  const s = stored as Partial<AppSettings>;
  const result = { ...DEFAULT_SETTINGS };
  for (const _key of Object.keys(DEFAULT_SETTINGS)) {
    const key = _key as keyof AppSettings;
    const val = s[key];
    if (val !== undefined && val !== "") {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

export async function updateSettings(
  updates: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings();
  const updated = { ...current, ...updates };
  await db.set(SETTINGS_KEY, updated);
  return updated;
}
