import { getGmailComposeUrl } from "./gmailClient.js";

export async function sendPiReviewEmail(opts: {
  piEmail: string;
  docUrl: string;
  reportDate: string;
}): Promise<string> {
  const subject = `Sponsor Report Ready for Review — ${opts.reportDate}`;
  const body = [
    "Hello,",
    "",
    "A draft sponsor report has been generated and is ready for your review.",
    "",
    `Open Report: ${opts.docUrl}`,
    "",
    "Please review, annotate, and notify the study coordinator when you have approved the content.",
    "",
    "Thank you,",
    "Clinical Trials Co-Pilot",
  ].join("\n");

  return getGmailComposeUrl({ to: opts.piEmail, subject, bodyText: body });
}

export async function sendNagEmail(opts: {
  piEmail: string;
  docUrl: string;
  reportDate: string;
  nagCount: number;
}): Promise<string> {
  const subject = `Reminder: Sponsor Report Awaiting Your Review — ${opts.reportDate}`;
  const body = [
    "Hello,",
    "",
    `This is a reminder that the sponsor report from ${opts.reportDate} is still awaiting your review and approval.`,
    "",
    `Open Report: ${opts.docUrl}`,
    "",
    "Please review and notify the study coordinator as soon as possible.",
    "",
    "Thank you,",
    "Clinical Trials Co-Pilot",
  ].join("\n");

  return getGmailComposeUrl({ to: opts.piEmail, subject, bodyText: body });
}
