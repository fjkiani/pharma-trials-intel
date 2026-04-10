import { getGmailComposeUrl } from "./gmailClient.js";

function notionDbUrl(rawId: string): string {
  return `https://www.notion.so/${rawId.replace(/-/g, "")}`;
}

export async function sendPiReviewEmail(opts: {
  piEmail: string;
  docUrl: string;
  reportDate: string;
  notionAeDbId?: string;
  notionDeviationDbId?: string;
  trialId?: string;
}): Promise<string> {
  const trial = opts.trialId ?? "ONCO-247";
  const subject = `[Action Required] Sponsor Report Ready for Review — ${opts.reportDate} — ${trial}`;

  const lines: string[] = [
    `Hello,`,
    ``,
    `The monthly Sponsor Report for trial ${trial} has been generated and is ready for your review and sign-off.`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `REPORT DETAILS`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Report Period: ${opts.reportDate}`,
    `Trial:         ${trial}`,
    ``,
    `This report was compiled automatically from enrollment data, adverse event records,`,
    `and protocol deviation logs. Please review carefully before forwarding to the sponsor.`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `REVIEW LINKS`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `📄  Draft Report (Google Docs):`,
    `    ${opts.docUrl}`,
  ];

  if (opts.notionAeDbId) {
    lines.push(
      ``,
      `🗂️  Adverse Events & Regulatory Database (Notion):`,
      `    ${notionDbUrl(opts.notionAeDbId)}`,
    );
  }
  if (opts.notionDeviationDbId) {
    lines.push(
      ``,
      `📋  Protocol Deviations Database (Notion):`,
      `    ${notionDbUrl(opts.notionDeviationDbId)}`,
    );
  }

  lines.push(
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `NEXT STEPS`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `1. Open the Draft Report link above and review all sections.`,
    `2. Cross-reference any AEs or deviations against the Notion records if needed.`,
    `3. Reply to this email to confirm receipt and advise on any required amendments.`,
    `4. Once approved, notify the study coordinator so the report can be marked Final and sent to sponsor.`,
    ``,
    `If you have any questions or spot discrepancies, please reply and we will investigate immediately.`,
    ``,
    `—`,
    `Clinical Trials Co-Pilot`,
    `Automated Reporting | ${trial}`,
  );

  const bodyText = lines.join("\n");
  return getGmailComposeUrl({ to: opts.piEmail, subject, bodyText });
}

export async function sendNagEmail(opts: {
  piEmail: string;
  docUrl: string;
  reportDate: string;
  nagCount: number;
  trialId?: string;
}): Promise<string> {
  const trial = opts.trialId ?? "ONCO-247";
  const subject = `[Reminder] Sponsor Report Awaiting Your Approval — ${opts.reportDate} — ${trial}`;

  const lines: string[] = [
    `Hello,`,
    ``,
    `This is a follow-up reminder that the ${trial} Sponsor Report for ${opts.reportDate} is still awaiting your review and approval.`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `PENDING REVIEW`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Report Period: ${opts.reportDate}`,
    `Trial:         ${trial}`,
    `Reminder #:    ${opts.nagCount}`,
    ``,
    `📄  Draft Report (Google Docs):`,
    `    ${opts.docUrl}`,
    ``,
    `Your approval is required before this report can be submitted to the sponsor.`,
    `Delays in sign-off may impact regulatory submission timelines.`,
    ``,
    `Please review at your earliest convenience and reply to confirm approval or flag any amendments needed.`,
    ``,
    `—`,
    `Clinical Trials Co-Pilot`,
    `Automated Reporting | ${trial}`,
  ];

  const bodyText = lines.join("\n");
  return getGmailComposeUrl({ to: opts.piEmail, subject, bodyText });
}
