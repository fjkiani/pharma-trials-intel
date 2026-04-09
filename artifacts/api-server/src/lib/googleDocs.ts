import { google, docs_v1 } from "googleapis";
import { getGoogleOAuth2Client } from "./googleOAuthClient.js";
import {
  copyFile,
  createWriterPermission,
  deleteFile as driveDeleteFile,
} from "./googleDriveClient.js";

// Google Docs shares OAuth credentials with the Drive connector — same Google account.
const DOCS_CONNECTOR = "google-drive";

export interface PlaceholderReplacement {
  placeholder: string;
  value: string;
}

export async function copyTemplate(templateDocId: string, title: string): Promise<string> {
  return copyFile(templateDocId, title);
}

export async function fillPlaceholders(
  docId: string,
  replacements: PlaceholderReplacement[],
): Promise<void> {
  const auth = await getGoogleOAuth2Client(DOCS_CONNECTOR);
  const docs = google.docs({ version: "v1", auth });

  const requests = replacements.map((r) => ({
    replaceAllText: {
      containsText: { text: r.placeholder, matchCase: true },
      replaceText: r.value,
    },
  }));

  const res = await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  if (res.status !== 200) {
    throw new Error(`Docs batchUpdate returned status ${res.status}`);
  }
}

function extractTextFromStructuralElements(
  elements: docs_v1.Schema$StructuralElement[],
): string {
  let text = "";
  for (const el of elements) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements ?? []) {
        text += pe.textRun?.content ?? "";
      }
    } else if (el.table) {
      for (const row of el.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          text += extractTextFromStructuralElements(cell.content ?? []);
        }
      }
    } else if (el.tableOfContents) {
      text += extractTextFromStructuralElements(el.tableOfContents.content ?? []);
    }
  }
  return text;
}

export async function scanForUnreplacedPlaceholders(docId: string): Promise<string[]> {
  const auth = await getGoogleOAuth2Client(DOCS_CONNECTOR);
  const docs = google.docs({ version: "v1", auth });

  const doc = await docs.documents.get({ documentId: docId });
  const bodyContent = doc.data.body?.content ?? [];

  const text = extractTextFromStructuralElements(bodyContent);
  const matches = text.match(/\{\{[^}]+\}\}/g) ?? [];
  return [...new Set(matches)];
}

export async function grantWriterAccess(docId: string, email: string): Promise<void> {
  return createWriterPermission(docId, email);
}

export async function deleteDoc(docId: string): Promise<void> {
  return driveDeleteFile(docId);
}

export function buildDocUrl(docId: string): string {
  return `https://docs.google.com/document/d/${docId}/edit`;
}
