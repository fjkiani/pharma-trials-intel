import type { NotionProxyClient } from "./notionClient.js";

export interface AeSummary {
  totalAe: number;
  grade3PlusAe: number;
}

export interface DeviationSummary {
  totalDeviations: number;
  majorDeviations: number;
}

export interface MilestoneSummary {
  nextMilestoneName: string;
  nextMilestoneDate: string;
}

/**
 * Fetches all pages from a Notion database (paginated).
 * Throws on API errors so callers can distinguish empty DB from failures.
 */
async function fetchAllPages(
  client: NotionProxyClient,
  databaseId: string,
): Promise<Record<string, unknown>[]> {
  const pages: Record<string, unknown>[] = [];
  let cursor: string | undefined = undefined;

  do {
    const response = await client.queryDatabase(databaseId, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...(response.results as Record<string, unknown>[]));
    cursor =
      response.has_more && response.next_cursor
        ? response.next_cursor
        : undefined;
  } while (cursor);

  return pages;
}

function getProps(page: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (page.properties as Record<string, Record<string, unknown>>) ?? {};
}

/**
 * Reads AE summary from Notion.
 * - Returns zero counts for empty database (empty dbId or zero pages).
 * - Throws if Notion API call fails so callers can surface the error.
 */
export async function readAeSummary(
  client: NotionProxyClient,
  aeDbId: string,
): Promise<AeSummary> {
  if (!aeDbId) return { totalAe: 0, grade3PlusAe: 0 };

  // May throw — callers decide how to handle (warn+zero vs hard error)
  const pages = await fetchAllPages(client, aeDbId);

  let grade3Plus = 0;
  for (const page of pages) {
    const props = getProps(page);
    const gradeProp = props["Grade"] as Record<string, unknown> | undefined;
    const grade = (gradeProp?.select as Record<string, string> | undefined)?.name ?? "";
    if (["Grade 3", "Grade 4", "Grade 5"].includes(grade)) grade3Plus++;
  }

  return { totalAe: pages.length, grade3PlusAe: grade3Plus };
}

/**
 * Reads protocol deviation summary from Notion.
 * - Returns zero counts for empty database.
 * - Throws if Notion API call fails.
 */
export async function readDeviationSummary(
  client: NotionProxyClient,
  devDbId: string,
): Promise<DeviationSummary> {
  if (!devDbId) return { totalDeviations: 0, majorDeviations: 0 };

  const pages = await fetchAllPages(client, devDbId);

  let major = 0;
  for (const page of pages) {
    const props = getProps(page);
    // "Severity" is the preferred field; fall back to "Type" if absent
    const sevProp = (props["Severity"] ?? props["Type"]) as Record<string, unknown> | undefined;
    const sev = (sevProp?.select as Record<string, string> | undefined)?.name ?? "";
    if (sev === "Major") major++;
  }

  return { totalDeviations: pages.length, majorDeviations: major };
}

/**
 * Reads the next upcoming regulatory milestone from Notion.
 * - Returns "N/A" fallback for empty database or missing expiration dates.
 * - Throws if Notion API call fails.
 */
export async function readNextMilestone(
  client: NotionProxyClient,
  regulatoryDbId: string,
): Promise<MilestoneSummary> {
  const fallback: MilestoneSummary = { nextMilestoneName: "N/A", nextMilestoneDate: "N/A" };
  if (!regulatoryDbId) return fallback;

  const pages = await fetchAllPages(client, regulatoryDbId);

  interface MilestoneItem {
    name: string;
    date: Date;
    dateStr: string;
  }

  const upcoming: MilestoneItem[] = [];
  const now = new Date();

  for (const page of pages) {
    const props = getProps(page);

    // Title: find by property type so any column name works
    const titleProp = Object.values(props).find(
      (p) => (p as Record<string, unknown>).type === "title",
    ) as Record<string, unknown> | undefined;
    const nameArr = titleProp?.title as Array<{ plain_text?: string }> | undefined;
    const name = nameArr?.[0]?.plain_text ?? "Untitled";

    // Date: "Expiration Date" or "Due Date"
    const dateProp = (props["Expiration Date"] ?? props["Due Date"]) as Record<string, unknown> | undefined;
    const dateStr = (dateProp?.date as Record<string, string> | undefined)?.start;
    if (!dateStr) continue;

    const date = new Date(dateStr);
    if (date >= now) upcoming.push({ name, date, dateStr });
  }

  if (upcoming.length === 0) return fallback;

  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
  const next = upcoming[0];
  return { nextMilestoneName: next.name, nextMilestoneDate: next.dateStr };
}
