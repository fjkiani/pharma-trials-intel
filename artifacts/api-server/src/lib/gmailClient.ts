/**
 * Gmail compose URL helper.
 * Opens a pre-filled Gmail compose window in the browser instead of
 * calling the Gmail API (which requires gmail.send scope — not available
 * in the Replit google-mail integration).
 */

export interface GmailComposeOpts {
  to: string;
  subject: string;
  /** Plain text body (HTML tags stripped for the compose URL) */
  bodyText: string;
}

/**
 * Returns a Gmail compose URL that, when opened in a browser, pre-fills
 * the To, Subject, and body fields.  The user reviews and clicks Send.
 */
export function getGmailComposeUrl(opts: GmailComposeOpts): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: opts.to,
    su: opts.subject,
    body: opts.bodyText,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Legacy compatibility wrapper — kept so existing `sendEmail` call-sites
 * that cannot receive a URL still compile.  Use `getGmailComposeUrl`
 * in any route that can surface the URL to the frontend.
 */
export async function sendEmail(_opts: {
  to: string;
  subject: string;
  htmlBody: string;
}): Promise<void> {
  // No-op: email is handled via compose URL returned by the route.
}
