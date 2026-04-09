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

/**
 * Staleness threshold in hours.
 * Override via STALE_THRESHOLD_HOURS env var for demo/testing
 * (e.g. STALE_THRESHOLD_HOURS=0.01 triggers stale after ~36 seconds).
 * Default: 24 hours (per US-2 requirement).
 */
export function getStaleThresholdHours(): number {
  const override = parseFloat(process.env.STALE_THRESHOLD_HOURS ?? "");
  return Number.isFinite(override) && override > 0 ? override : 24;
}

export async function getSheetFreshness(sheetFileId: string): Promise<SheetFreshnessResult> {
  const lastModifiedAt = await getFileModifiedTime(sheetFileId);
  const ageMs = Date.now() - new Date(lastModifiedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const threshold = getStaleThresholdHours();
  return { lastModifiedAt, ageHours, isStale: ageHours > threshold };
}

/**
 * @param headerRow 1-based row number of the header row (matches the Settings field).
 *   Rows above the header are skipped. Data rows start immediately after the header.
 *   Default: 1 (header in row 1, data from row 2 onward).
 */
export async function readEnrollmentData(
  sheetId: string,
  tabName: string,
  headerRow: number,
): Promise<EnrollmentData> {
  const range = `'${tabName}'!A:B`;
  const rows = await getSheetValues(sheetId, range);

  // headerRow is 1-based: slice(headerRow) skips rows 0..(headerRow-1),
  // i.e. the header row itself and any title rows above it.
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
