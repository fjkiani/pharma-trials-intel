import { google } from "googleapis";

type OAuthSettings = {
  settings: {
    expires_at?: string;
    access_token?: string;
    oauth?: { credentials?: { access_token?: string; refresh_token?: string } };
    refresh_token?: string;
  };
};

const cache: Record<string, { settings: OAuthSettings; fetchedAt: number }> = {};

function extractToken(s: OAuthSettings): string | undefined {
  return s.settings.access_token ?? s.settings.oauth?.credentials?.access_token;
}

async function fetchConnectionSettings(connectorName: string): Promise<OAuthSettings> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) throw new Error("X-Replit-Token not available");

  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=${connectorName}`,
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  );
  const data = (await res.json()) as { items?: OAuthSettings[] };
  const conn = (data.items ?? [])[0];
  if (!conn) throw new Error(`${connectorName} not connected`);
  return conn;
}

export async function getGoogleAccessToken(connectorName: string): Promise<string> {
  const cached = cache[connectorName];
  if (cached) {
    const tokenExpiry = cached.settings.settings.expires_at
      ? new Date(cached.settings.settings.expires_at).getTime()
      : 0;
    if (tokenExpiry > Date.now() + 60_000) {
      const token = extractToken(cached.settings);
      if (token) return token;
    }
  }

  const settings = await fetchConnectionSettings(connectorName);
  cache[connectorName] = { settings, fetchedAt: Date.now() };

  const token = extractToken(settings);
  if (!token) throw new Error(`${connectorName} access token missing`);
  return token;
}

export async function getGoogleOAuth2Client(connectorName: string) {
  const accessToken = await getGoogleAccessToken(connectorName);
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return oauth2;
}

export function clearGoogleTokenCache(connectorName?: string) {
  if (connectorName) {
    delete cache[connectorName];
  } else {
    Object.keys(cache).forEach((k) => delete cache[k]);
  }
}
