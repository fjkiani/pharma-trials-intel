/**
 * Notion C2 Integration — notionSink.ts
 *
 * Two entry points:
 *   writeIntelligenceToNotion  — writes a formatted intelligence page into
 *                                NOTION_COMPETITOR_DB_ID
 *   injectNotionTask           — creates an action-item row in
 *                                NOTION_TASKS_DB_ID (due: now + 48h)
 *
 * Auth:
 *   Uses @notionhq/client.  Auth token resolved in this priority order:
 *     1. process.env.NOTION_API_KEY          (raw integration secret)
 *     2. Replit connector proxy              (via @replit/connectors-sdk)
 *
 * If neither NOTION_COMPETITOR_DB_ID nor NOTION_TASKS_DB_ID is set,
 * the functions log a warning and return immediately — they never crash.
 */

import { logger } from "../../lib/logger.js";
import type { FormattedPayload } from "./formatter.js";

// ── Notion block builders ─────────────────────────────────────────────────────

interface RichTextItem {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
  };
}

interface NotionBlock {
  object: "block";
  type: string;
  [key: string]: unknown;
}

function rt(content: string, opts?: { bold?: boolean; italic?: boolean; link?: string }): RichTextItem {
  return {
    type: "text",
    text: { content, link: opts?.link ? { url: opts.link } : null },
    annotations: { bold: opts?.bold, italic: opts?.italic },
  };
}

function heading1(text: string): NotionBlock {
  return { object: "block", type: "heading_1", heading_1: { rich_text: [rt(text)] } };
}

function heading2(text: string): NotionBlock {
  return { object: "block", type: "heading_2", heading_2: { rich_text: [rt(text)] } };
}

function heading3(text: string): NotionBlock {
  return { object: "block", type: "heading_3", heading_3: { rich_text: [rt(text)] } };
}

function para(items: RichTextItem[]): NotionBlock {
  return { object: "block", type: "paragraph", paragraph: { rich_text: items } };
}

function quote(text: string): NotionBlock {
  return { object: "block", type: "quote", quote: { rich_text: [rt(text)] } };
}

function bullet(items: RichTextItem[]): NotionBlock {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: items } };
}

function divider(): NotionBlock {
  return { object: "block", type: "divider", divider: {} };
}

// ── Markdown → Notion block converter ────────────────────────────────────────

function parseMarkdownToBlocks(md: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  const lines = md.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines (they create natural spacing via the surrounding blocks)
    if (line.trim() === "") continue;

    // Horizontal rule ---
    if (/^---+$/.test(line.trim())) {
      blocks.push(divider());
      continue;
    }

    // H1
    if (line.startsWith("# ")) {
      blocks.push(heading1(line.slice(2).trim()));
      continue;
    }

    // H2
    if (line.startsWith("## ")) {
      blocks.push(heading2(line.slice(3).trim()));
      continue;
    }

    // H3
    if (line.startsWith("### ")) {
      blocks.push(heading3(line.slice(4).trim()));
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      blocks.push(quote(line.slice(2).trim()));
      continue;
    }

    // Bullet list item
    if (line.startsWith("- ")) {
      const content = line.slice(2).trim();
      // URL bullets — detect URL and make it a link
      const urlMatch = content.match(/^(https?:\/\/\S+)$/);
      if (urlMatch) {
        blocks.push(bullet([rt(urlMatch[1], { link: urlMatch[1] })]));
      } else {
        blocks.push(bullet([rt(content)]));
      }
      continue;
    }

    // Bold/italic inline within a paragraph line
    const rtItems = parseInlineMarkdown(line);
    if (rtItems.length > 0) {
      blocks.push(para(rtItems));
    }
  }

  return blocks;
}

function parseInlineMarkdown(line: string): RichTextItem[] {
  // Handle **bold**, *italic*, and plain text mixed
  const items: RichTextItem[] = [];
  const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|([^*`]+))/g;
  let match;

  while ((match = regex.exec(line)) !== null) {
    if (match[2]) {
      items.push(rt(match[2], { bold: true }));
    } else if (match[3]) {
      items.push(rt(match[3], { italic: true }));
    } else if (match[4]) {
      items.push(rt(match[4], { code: true }));
    } else if (match[5] && match[5].trim()) {
      items.push(rt(match[5]));
    }
  }

  return items;
}

// ── Notion client factory ─────────────────────────────────────────────────────

interface NotionPageResult {
  id: string;
  url?: string;
}

interface SimpleNotionClient {
  createPage(databaseId: string, properties: Record<string, unknown>, children: NotionBlock[]): Promise<NotionPageResult>;
}

async function buildClient(): Promise<SimpleNotionClient> {
  const apiKey = process.env.NOTION_API_KEY;

  if (apiKey) {
    // Direct @notionhq/client path
    const { Client } = await import("@notionhq/client");
    const notion = new Client({ auth: apiKey });

    return {
      async createPage(databaseId, properties, children) {
        const CHUNK = 100;
        const firstChunk = children.slice(0, CHUNK);
        const rest = children.slice(CHUNK);

        const response = await notion.pages.create({
          parent: { type: "database_id", database_id: databaseId },
          properties: properties as Parameters<typeof notion.pages.create>[0]["properties"],
          children: firstChunk as Parameters<typeof notion.pages.create>[0]["children"],
        });

        if (rest.length > 0) {
          for (let i = 0; i < rest.length; i += CHUNK) {
            await notion.blocks.children.append({
              block_id: response.id,
              children: rest.slice(i, i + CHUNK) as Parameters<typeof notion.blocks.children.append>[0]["children"],
            });
          }
        }

        return { id: response.id, url: (response as { url?: string }).url };
      },
    };
  }

  // Replit connector fallback
  const { ReplitConnectors } = await import("@replit/connectors-sdk");
  const connectors = new ReplitConnectors();

  function toUuid(id: string): string {
    const raw = id.replace(/-/g, "");
    if (raw.length !== 32) return id;
    return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
  }

  return {
    async createPage(databaseId, properties, children) {
      const CHUNK = 100;
      const firstChunk = children.slice(0, CHUNK);
      const rest = children.slice(CHUNK);

      const body = JSON.stringify({
        parent: { database_id: toUuid(databaseId) },
        properties,
        children: firstChunk,
      });

      const res = await connectors.proxy("notion", "/v1/pages", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const text = await (res as unknown as Response).text();
        throw new Error(`Notion createPage failed (${res.status}): ${text.slice(0, 200)}`);
      }

      const data = await (res as unknown as Response).json() as { id?: string; url?: string; object?: string; message?: string; parent?: { type?: string } };
      if (data.object === "error") throw new Error(`Notion error: ${data.message}`);

      // Notion silently falls back to workspace root when the integration
      // doesn't have access to the target database. Catch this.
      if (data.parent?.type === "workspace") {
        throw new Error(
          `Notion accepted the page but placed it in the workspace root — the database has not been shared with the Replit integration. ` +
          `Open the database in Notion → Share → Add connections → select "Replit".`
        );
      }

      const pageId = data.id ?? "";

      if (rest.length > 0 && pageId) {
        for (let i = 0; i < rest.length; i += CHUNK) {
          const chunk = rest.slice(i, i + CHUNK);
          await connectors.proxy("notion", `/v1/blocks/${toUuid(pageId)}/children`, {
            method: "PATCH",
            body: JSON.stringify({ children: chunk }),
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return { id: pageId, url: data.url };
    },
  };
}

// ── 1. Intelligence sink ──────────────────────────────────────────────────────

export async function writeIntelligenceToNotion(
  formatted: FormattedPayload,
  severity: string,
): Promise<void> {
  const dbId = process.env.NOTION_COMPETITOR_DB_ID;

  if (!dbId) {
    logger.warn("NOTION_COMPETITOR_DB_ID not set — skipping Notion intelligence write-back. Set this env var to activate the C2 sink.");
    return;
  }

  try {
    const client = await buildClient();
    const blocks = parseMarkdownToBlocks(formatted.markdown);

    const properties: Record<string, unknown> = {
      Name: {
        title: [{ type: "text", text: { content: `🚨 THREAT: ${formatted.drugName} (${formatted.nctId})` } }],
      },
    };

    // Best-effort properties — Notion ignores unknown fields
    try {
      Object.assign(properties, {
        Severity: { select: { name: severity.toUpperCase() } },
        Vector: { select: { name: formatted.vector } },
        "Evidence Tier": { select: { name: formatted.zetaTier } },
        "NCT ID": { rich_text: [{ type: "text", text: { content: formatted.nctId } }] },
        Date: { date: { start: new Date().toISOString().split("T")[0] } },
      });
    } catch {
      // Ignore — DB may use different property names
    }

    const page = await client.createPage(dbId, properties, blocks);
    logger.info({ pageId: page.id, nctId: formatted.nctId }, "Notion intelligence page written");
  } catch (err) {
    logger.warn({ err }, "writeIntelligenceToNotion failed — non-fatal");
  }
}

// ── 2. Task injector ──────────────────────────────────────────────────────────

export async function injectNotionTask(
  drugName: string,
  vector: string,
  nctId: string,
  directive: string,
  docUrl: string,
  severity: string,
): Promise<void> {
  const dbId = process.env.NOTION_TASKS_DB_ID;

  if (!dbId) {
    logger.warn("NOTION_TASKS_DB_ID not set — skipping Notion task injection. Set this env var to activate autonomous task delegation.");
    return;
  }

  try {
    const client = await buildClient();

    const dueDate = new Date();
    dueDate.setTime(dueDate.getTime() + 48 * 60 * 60 * 1000);
    const dueDateStr = dueDate.toISOString().split("T")[0];

    const taskTitle = `Review Competitor Anomaly: ${drugName}`;

    const properties: Record<string, unknown> = {
      Name: {
        title: [{ type: "text", text: { content: taskTitle } }],
      },
    };

    try {
      Object.assign(properties, {
        "Due Date": { date: { start: dueDateStr } },
        Priority: { select: { name: severity === "critical" ? "High" : "Medium" } },
        Status: { status: { name: "Not started" } },
      });
    } catch {
      // Ignore unknown properties
    }

    const bodyBlocks: NotionBlock[] = [
      para([rt("The Strike Suite detected a critical competitor vulnerability. Review the linked intelligence brief and advise on protocol adjustments for ONCO-247.")]),
      divider(),
      heading3("Signal Details"),
      bullet([rt(`NCT ID: ${nctId}`)]),
      bullet([rt(`Failure Vector: ${vector}`)]),
      bullet([rt(`Severity: ${severity.toUpperCase()}`)]),
      bullet([rt(`Zeta-Core Verdict: ${severity === "critical" ? "CONFIRMED" : "PROBABLE"}`)]),
      divider(),
      heading3("Clinical Directive"),
      quote(directive),
      divider(),
      para([rt("Intelligence Brief: ", { bold: true }), rt(docUrl, { link: docUrl })]),
      para([rt(`Due: ${dueDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, { italic: true })]),
    ];

    const page = await client.createPage(dbId, properties, bodyBlocks);
    logger.info({ pageId: page.id, taskTitle, dueDate: dueDateStr }, "Notion action task injected");
  } catch (err) {
    logger.warn({ err }, "injectNotionTask failed — non-fatal");
  }
}
