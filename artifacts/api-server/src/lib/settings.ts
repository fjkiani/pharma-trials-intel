import Database from "@replit/database";

const db = new Database();
const SETTINGS_KEY = "app:settings";

type DbResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function dbGet<T>(key: string): Promise<T | null> {
  const result = await (
    db as unknown as { get(k: string): Promise<DbResult<T | null>> }
  ).get(key);
  if (!result.ok) {
    const statusCode = (
      (result as { ok: false; error: unknown }).error as {
        statusCode?: number;
      }
    )?.statusCode;
    if (statusCode === 404) return null;
    throw new Error(
      `DB error (get:${key}): ${JSON.stringify((result as { ok: false; error: unknown }).error)}`,
    );
  }
  return (result as { ok: true; value: T | null }).value;
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const result = await (
    db as unknown as {
      set(k: string, v: unknown): Promise<DbResult<void>>;
    }
  ).set(key, value);
  if (!result.ok)
    throw new Error(
      `DB error (set:${key}): ${JSON.stringify((result as { ok: false; error: unknown }).error)}`,
    );
}

export interface AppSettings {
  notionRegulatoryDbId: string;
  googleCalendarId: string;
  notionAeLogDbId: string;
  notionDeviationLogDbId: string;
  notionCompetitorDbId: string;
  notionTasksDbId: string;
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
  notionAeLogDbId: "",
  notionDeviationLogDbId: "",
  notionCompetitorDbId: "",
  notionTasksDbId: "",
  googleCalendarId: "",
  sponsorCallEventId: "",
  googleSheetsId: "",
  googleDocsTemplateId: "",
  googleSheetTab: "Sheet1",
  googleSheetHeaderRow: 1,
  piEmail: "",
  sponsorEmail: "",
  nagIntervalHours: 4,
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await dbGet<Partial<AppSettings>>(SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_SETTINGS };
  const result = { ...DEFAULT_SETTINGS };
  for (const _key of Object.keys(DEFAULT_SETTINGS)) {
    const key = _key as keyof AppSettings;
    const val = stored[key];
    if (val !== undefined && val !== ("" as unknown)) {
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
  await dbSet(SETTINGS_KEY, updated);
  return updated;
}
