import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export async function driveProxy(
  path: string,
  options: {
    method?: string;
    body?: string;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const { method = "GET", body, params } = options;
  const url = params
    ? `${path}?${new URLSearchParams(params).toString()}`
    : path;

  return connectors.proxy("google-drive", url, {
    method,
    body,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  }) as unknown as Response;
}

export async function getFileModifiedTime(fileId: string): Promise<string> {
  const res = await driveProxy(`/drive/v3/files/${fileId}`, {
    params: { fields: "modifiedTime" },
  });
  if (!res.ok) {
    const text = await (res as Response).text();
    throw new Error(`Drive files.get failed (${res.status}): ${text}`);
  }
  const data = (await (res as Response).json()) as { modifiedTime?: string };
  if (!data.modifiedTime) throw new Error("modifiedTime not returned from Drive API");
  return data.modifiedTime;
}

export async function copyFile(fileId: string, name: string): Promise<string> {
  const res = await driveProxy(`/drive/v3/files/${fileId}/copy`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await (res as Response).text();
    throw new Error(`Drive files.copy failed (${res.status}): ${text}`);
  }
  const data = (await (res as Response).json()) as { id?: string };
  if (!data.id) throw new Error("Drive copy returned no file ID");
  return data.id;
}

export async function createWriterPermission(fileId: string, email: string): Promise<void> {
  const res = await driveProxy(`/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    params: { sendNotificationEmail: "false" },
    body: JSON.stringify({ role: "writer", type: "user", emailAddress: email }),
  });
  if (!res.ok) {
    const text = await (res as Response).text();
    throw new Error(`Drive permissions.create failed (${res.status}): ${text}`);
  }
}

export async function deleteFile(fileId: string): Promise<void> {
  const res = await driveProxy(`/drive/v3/files/${fileId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const text = await (res as Response).text();
    throw new Error(`Drive files.delete failed (${res.status}): ${text}`);
  }
}

/**
 * Exports a Google Sheet as CSV via the Drive API and parses it into rows.
 * Uses the Drive export endpoint (/drive/v3/files/{id}/export) which is covered
 * by the google-drive connector scope.  For a specific tab, pass its numeric gid
 * (0 = first sheet, the default "Sheet1").
 */
export async function getSheetValues(
  spreadsheetId: string,
  _range: string,
): Promise<string[][]> {
  const res = await driveProxy(
    `/drive/v3/files/${spreadsheetId}/export`,
    { params: { mimeType: "text/csv" } },
  );
  if (!res.ok) {
    const text = await (res as Response).text();
    throw new Error(`Sheets export failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const csv = await (res as Response).text();
  return parseCSV(csv);
}

function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  for (const line of csv.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    // Basic CSV parse — handles quoted fields with commas
    const cols: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '"') {
        if (inQuotes && trimmed[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        cols.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    cols.push(current);
    rows.push(cols);
  }
  return rows;
}
