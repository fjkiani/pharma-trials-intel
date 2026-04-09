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

export async function getSheetValues(
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const encodedRange = encodeURIComponent(range);
  const res = await driveProxy(
    `/sheets/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`,
  );
  if (!res.ok) {
    const text = await (res as Response).text();
    throw new Error(`Sheets values.get failed (${res.status}): ${text}`);
  }
  const data = (await (res as Response).json()) as { values?: string[][] };
  return data.values ?? [];
}
