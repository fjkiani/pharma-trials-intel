import { getSettings } from "./settings.js";
import type { NotionProxyClient } from "./notionClient.js";

export interface NotionRegulatoryDoc {
  id: string;
  name: string;
  expirationDate: string | null;
  status: "Current" | "Expiring Soon" | "Expired" | "Unknown";
  fileLink: string | null;
  daysUntilExpiration: number | null;
  calendarEventCreated: boolean;
}

function computeStatus(
  expirationDate: string | null,
): "Current" | "Expiring Soon" | "Expired" | "Unknown" {
  if (!expirationDate) return "Unknown";
  const now = new Date();
  const expiry = new Date(expirationDate);
  const daysUntil = Math.ceil(
    (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysUntil < 0) return "Expired";
  if (daysUntil <= 30) return "Expiring Soon";
  return "Current";
}

function computeDaysUntil(expirationDate: string | null): number | null {
  if (!expirationDate) return null;
  const now = new Date();
  const expiry = new Date(expirationDate);
  return Math.ceil(
    (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
}

async function fetchAllNotionPages(
  client: NotionProxyClient,
  databaseId: string,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let cursor: string | undefined = undefined;

  do {
    const response = await client.queryDatabase(databaseId, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    pages.push(...response.results);
    cursor =
      response.has_more && response.next_cursor
        ? response.next_cursor
        : undefined;
  } while (cursor);

  return pages;
}

export async function listRegulatoryDocuments(
  notionClient: NotionProxyClient,
): Promise<NotionRegulatoryDoc[]> {
  const settings = await getSettings();

  if (!settings.notionRegulatoryDbId) {
    return [];
  }

  const pages = await fetchAllNotionPages(
    notionClient,
    settings.notionRegulatoryDbId,
  );

  const docs: NotionRegulatoryDoc[] = (
    pages as Record<string, unknown>[]
  ).map((page) => {
    const props =
      (page.properties as Record<string, Record<string, unknown>>) ?? {};

    const nameProperty = props["Document Name"] as
      | Record<string, unknown>
      | undefined;
    const titleArr = nameProperty?.title as
      | Array<{ plain_text?: string }>
      | undefined;
    const name = titleArr?.[0]?.plain_text ?? "Untitled";

    const expirationProperty = props["Expiration Date"] as
      | Record<string, unknown>
      | undefined;
    const expirationDate =
      (expirationProperty?.date as Record<string, string> | undefined)
        ?.start ?? null;

    const statusProperty = props["Status"] as
      | Record<string, unknown>
      | undefined;
    const notionStatus =
      (statusProperty?.select as Record<string, string> | undefined)?.name ??
      null;

    const fileLinkProperty = props["File Link"] as
      | Record<string, unknown>
      | undefined;
    const fileLink = (fileLinkProperty?.url as string) ?? null;

    const knownStatuses = new Set(["Current", "Expiring Soon", "Expired"]);
    const status =
      notionStatus && knownStatuses.has(notionStatus)
        ? (notionStatus as "Current" | "Expiring Soon" | "Expired")
        : computeStatus(expirationDate);

    return {
      id: page.id as string,
      name,
      expirationDate,
      status,
      fileLink,
      daysUntilExpiration: computeDaysUntil(expirationDate),
      calendarEventCreated: false,
    };
  });

  docs.sort((a, b) => {
    if (!a.expirationDate) return 1;
    if (!b.expirationDate) return -1;
    return (
      new Date(a.expirationDate).getTime() -
      new Date(b.expirationDate).getTime()
    );
  });

  return docs;
}
