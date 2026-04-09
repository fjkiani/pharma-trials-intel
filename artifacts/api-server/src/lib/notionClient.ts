import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export interface NotionProxyClient {
  queryDatabase(databaseId: string, params?: { start_cursor?: string; page_size?: number }): Promise<{
    results: unknown[];
    has_more: boolean;
    next_cursor: string | null;
  }>;
}

/** Normalise a Notion ID to the 8-4-4-4-12 UUID format the API requires. */
function toNotionUuid(id: string): string {
  const raw = id.replace(/-/g, "");
  if (raw.length !== 32) return id;
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}

export function getUncachableNotionClient(): NotionProxyClient {
  return {
    async queryDatabase(databaseId, params = {}) {
      const uuid = toNotionUuid(databaseId);
      const response = await connectors.proxy(
        "notion",
        `/v1/databases/${uuid}/query`,
        {
          method: "POST",
          body: JSON.stringify({ page_size: 100, ...params }),
        },
      );

      if (!response.ok) {
        const text = await (response as unknown as Response).text();
        throw new Error(`Notion API error (${response.status}) for database ${uuid}: ${text.slice(0, 300)}`);
      }

      const data = await (response as unknown as Response).json() as {
        results?: unknown[];
        has_more?: boolean;
        next_cursor?: string | null;
        object?: string;
        message?: string;
      };

      if (data.object === "error") {
        throw new Error(`Notion error for database ${uuid}: ${data.message ?? JSON.stringify(data)}`);
      }

      return {
        results: data.results ?? [],
        has_more: data.has_more ?? false,
        next_cursor: data.next_cursor ?? null,
      };
    },
  };
}
