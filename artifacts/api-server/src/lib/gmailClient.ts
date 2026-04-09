import { google } from "googleapis";
import { getGoogleOAuth2Client } from "./googleOAuthClient.js";

function encodeRfc2822(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    body,
  ].join("\n");

  return Buffer.from(lines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  htmlBody: string;
}): Promise<void> {
  const auth = await getGoogleOAuth2Client("google-mail");
  const gmail = google.gmail({ version: "v1", auth });

  const raw = encodeRfc2822(opts.to, opts.subject, opts.htmlBody);

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}
