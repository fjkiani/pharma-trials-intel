import { google } from "googleapis";
import { getGoogleOAuth2Client } from "./googleOAuthClient.js";

function encodeEmail(to: string, subject: string, body: string, from?: string): string {
  const lines = [
    from ? `From: ${from}` : "",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    body,
  ]
    .filter((l, i) => i !== 0 || l !== "")
    .join("\n");

  return Buffer.from(lines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendPiReviewEmail(opts: {
  piEmail: string;
  docUrl: string;
  reportDate: string;
}): Promise<void> {
  const auth = await getGoogleOAuth2Client("google-mail");
  const gmail = google.gmail({ version: "v1", auth });

  const subject = `Sponsor Report Ready for Review — ${opts.reportDate}`;
  const body = `
<p>Hello,</p>
<p>A draft sponsor report has been generated and is ready for your review.</p>
<p><strong><a href="${opts.docUrl}">Open Report in Google Docs</a></strong></p>
<p>Please review, annotate, and notify the study coordinator when you have approved the content.</p>
<p>Thank you,<br/>Clinical Trials Co-Pilot</p>
  `.trim();

  const raw = encodeEmail(opts.piEmail, subject, body);
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

export async function sendNagEmail(opts: {
  piEmail: string;
  docUrl: string;
  reportDate: string;
  nagCount: number;
}): Promise<void> {
  const auth = await getGoogleOAuth2Client("google-mail");
  const gmail = google.gmail({ version: "v1", auth });

  const subject = `Reminder: Sponsor Report Awaiting Your Review — ${opts.reportDate}`;
  const body = `
<p>Hello,</p>
<p>This is a reminder that the sponsor report from <strong>${opts.reportDate}</strong> is still awaiting your review and approval.</p>
<p><strong><a href="${opts.docUrl}">Open Report in Google Docs</a></strong></p>
<p>Please review and notify the study coordinator as soon as possible.</p>
<p>Thank you,<br/>Clinical Trials Co-Pilot</p>
  `.trim();

  const raw = encodeEmail(opts.piEmail, subject, body);
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}
