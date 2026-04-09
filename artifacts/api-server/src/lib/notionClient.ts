import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export interface NotionProxyClient {
  queryDatabase(databaseId: string, params?: { start_cursor?: string; page_size?: number }): Promise<{
    results: unknown[];
    has_more: boolean;
    next_cursor: string | null;
  }>;
}

export function getUncachableNotionClient(): NotionProxyClient {
  return {
    async queryDatabase(databaseId, params = {}) {
      const response = await connectors.proxy(
        "notion",
        `/v1/databases/${databaseId}/query`,
        {
          method: "POST",
          body: JSON.stringify({ page_size: 100, ...params }),
        },
      );
      return response.json() as Promise<{
        results: unknown[];
        has_more: boolean;
        next_cursor: string | null;
      }>;
    },
  };
}
