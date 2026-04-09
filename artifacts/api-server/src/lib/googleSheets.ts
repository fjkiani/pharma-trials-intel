import { getFileModifiedTime, getSheetValues } from "./googleDriveClient.js";

export interface EnrollmentData {
  enrolled: number;
  screened: number;
  screenFailures: number;
  withdrawals: number;
}

export interface SheetFreshnessResult {
  lastModifiedAt: string;
  ageHours: number;
  isStale: boolean;
}

export async function getSheetFreshness(sheetFileId: string): Promise<SheetFreshnessResult> {
  const lastModifiedAt = await getFileModifiedTime(sheetFileId);
  const ageMs = Date.now() - new Date(lastModifiedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return { lastModifiedAt, ageHours, isStale: ageHours > 24 };
}

export async function readEnrollmentData(
  sheetId: string,
  tabName: string,
  headerRow: number,
): Promise<EnrollmentData> {
  const range = `'${tabName}'!A:B`;
  const rows = await getSheetValues(sheetId, range);

  const dataRows = rows.slice(headerRow);

  const lookup: Record<string, number> = {};
  for (const row of dataRows) {
    const metricRaw = (row[0] ?? "").trim().toLowerCase();
    const valueRaw = (row[1] ?? "0").replace(/[^0-9-]/g, "");
    const value = parseInt(valueRaw, 10) || 0;
    if (metricRaw) lookup[metricRaw] = value;
  }

  return {
    enrolled: lookup["enrolled"] ?? 0,
    screened: lookup["screened"] ?? 0,
    screenFailures: lookup["screen failures"] ?? 0,
    withdrawals: lookup["withdrawals"] ?? 0,
  };
}
