import { google } from "googleapis";
import { getGoogleOAuth2Client } from "./googleOAuthClient.js";

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
  const auth = await getGoogleOAuth2Client("google-drive");
  const drive = google.drive({ version: "v3", auth });

  const file = await drive.files.get({
    fileId: sheetFileId,
    fields: "modifiedTime",
  });

  const modifiedTime = file.data.modifiedTime;
  if (!modifiedTime) throw new Error("Could not read modifiedTime from Drive file");

  const lastModifiedAt = modifiedTime;
  const ageMs = Date.now() - new Date(lastModifiedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return { lastModifiedAt, ageHours, isStale: ageHours > 24 };
}

export async function readEnrollmentData(
  sheetId: string,
  tabName: string,
  headerRow: number,
): Promise<EnrollmentData> {
  const auth = await getGoogleOAuth2Client("google-sheet");
  const sheets = google.sheets({ version: "v4", auth });

  const range = `'${tabName}'!A:B`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });

  const rows = resp.data.values ?? [];

  const dataRows = rows.slice(headerRow);

  const lookup: Record<string, number> = {};
  for (const row of dataRows) {
    const metricRaw = (row[0] as string | undefined) ?? "";
    const valueRaw = (row[1] as string | undefined) ?? "0";
    const metric = metricRaw.trim().toLowerCase();
    const value = parseInt(valueRaw.replace(/[^0-9-]/g, ""), 10) || 0;
    lookup[metric] = value;
  }

  return {
    enrolled: lookup["enrolled"] ?? 0,
    screened: lookup["screened"] ?? 0,
    screenFailures: lookup["screen failures"] ?? 0,
    withdrawals: lookup["withdrawals"] ?? 0,
  };
}
