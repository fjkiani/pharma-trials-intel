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

export async function readAeSummary(
  client: NotionProxyClient,
  aeDbId: string,
): Promise<AeSummary> {
  if (!aeDbId) return { totalAe: 0, grade3PlusAe: 0 };

  let pages: Record<string, unknown>[];
  try {
    pages = await fetchAllPages(client, aeDbId);
  } catch {
    return { totalAe: 0, grade3PlusAe: 0 };
  }

  let grade3Plus = 0;
  for (const page of pages) {
    const props = getProps(page);
    const gradeProp = props["Grade"] as Record<string, unknown> | undefined;
    const grade = (gradeProp?.select as Record<string, string> | undefined)?.name ?? "";
    if (["Grade 3", "Grade 4", "Grade 5"].includes(grade)) grade3Plus++;
  }

  return { totalAe: pages.length, grade3PlusAe: grade3Plus };
}

export async function readDeviationSummary(
  client: NotionProxyClient,
  devDbId: string,
): Promise<DeviationSummary> {
  if (!devDbId) return { totalDeviations: 0, majorDeviations: 0 };

  let pages: Record<string, unknown>[];
  try {
    pages = await fetchAllPages(client, devDbId);
  } catch {
    return { totalDeviations: 0, majorDeviations: 0 };
  }

  let major = 0;
  for (const page of pages) {
    const props = getProps(page);
    const sevProp = props["Severity"] as Record<string, unknown> | undefined;
    const sev = (sevProp?.select as Record<string, string> | undefined)?.name ?? "";
    if (sev === "Major") major++;
  }

  return { totalDeviations: pages.length, majorDeviations: major };
}

export async function readNextMilestone(
  client: NotionProxyClient,
  regulatoryDbId: string,
): Promise<MilestoneSummary> {
  const fallback: MilestoneSummary = { nextMilestoneName: "N/A", nextMilestoneDate: "N/A" };
  if (!regulatoryDbId) return fallback;

  let pages: Record<string, unknown>[];
  try {
    pages = await fetchAllPages(client, regulatoryDbId);
  } catch {
    return fallback;
  }

  interface MilestoneItem {
    name: string;
    date: Date;
    dateStr: string;
  }

  const upcoming: MilestoneItem[] = [];
  const now = new Date();

  for (const page of pages) {
    const props = getProps(page);

    const nameProp = props["Document Name"] as Record<string, unknown> | undefined;
    const nameArr = nameProp?.title as Array<{ plain_text?: string }> | undefined;
    const name = nameArr?.[0]?.plain_text ?? "Untitled";

    const dateProp = props["Expiration Date"] as Record<string, unknown> | undefined;
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
