import { google } from "googleapis";
import { getGoogleOAuth2Client } from "./googleOAuthClient.js";
import {
  copyFile,
  createWriterPermission,
  deleteFile as driveDeleteFile,
} from "./googleDriveClient.js";

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
  const auth = await getGoogleOAuth2Client("google-docs");
  const docs = google.docs({ version: "v1", auth });

  const requests = replacements.map((r) => ({
    replaceAllText: {
      containsText: { text: r.placeholder, matchCase: true },
      replaceText: r.value,
    },
  }));

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });
}

export async function scanForUnreplacedPlaceholders(docId: string): Promise<string[]> {
  const auth = await getGoogleOAuth2Client("google-docs");
  const docs = google.docs({ version: "v1", auth });

  const doc = await docs.documents.get({ documentId: docId });
  const content = doc.data.body?.content ?? [];

  const text = content
    .flatMap((block) => block.paragraph?.elements ?? [])
    .map((el) => el.textRun?.content ?? "")
    .join("");

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
