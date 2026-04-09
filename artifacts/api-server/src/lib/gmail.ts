import { sendEmail } from "./gmailClient.js";

export async function sendPiReviewEmail(opts: {
  piEmail: string;
  docUrl: string;
  reportDate: string;
}): Promise<void> {
  const subject = `Sponsor Report Ready for Review — ${opts.reportDate}`;
  const htmlBody = `
<p>Hello,</p>
<p>A draft sponsor report has been generated and is ready for your review.</p>
<p><strong><a href="${opts.docUrl}">Open Report in Google Docs</a></strong></p>
<p>Please review, annotate, and notify the study coordinator when you have approved the content.</p>
<p>Thank you,<br/>Clinical Trials Co-Pilot</p>
  `.trim();

  await sendEmail({ to: opts.piEmail, subject, htmlBody });
}

export async function sendNagEmail(opts: {
  piEmail: string;
  docUrl: string;
  reportDate: string;
  nagCount: number;
}): Promise<void> {
  const subject = `Reminder: Sponsor Report Awaiting Your Review — ${opts.reportDate}`;
  const htmlBody = `
<p>Hello,</p>
<p>This is a reminder that the sponsor report from <strong>${opts.reportDate}</strong> is still awaiting your review and approval.</p>
<p><strong><a href="${opts.docUrl}">Open Report in Google Docs</a></strong></p>
<p>Please review and notify the study coordinator as soon as possible.</p>
<p>Thank you,<br/>Clinical Trials Co-Pilot</p>
  `.trim();

  await sendEmail({ to: opts.piEmail, subject, htmlBody });
}
