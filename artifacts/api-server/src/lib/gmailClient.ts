import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

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
  const raw = encodeRfc2822(opts.to, opts.subject, opts.htmlBody);

  const res = (await connectors.proxy("google-mail", "/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
    headers: { "Content-Type": "application/json" },
  })) as unknown as Response;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${text}`);
  }
}
