import { getSettings } from "./settings.js";
import type { NotionRegulatoryDoc } from "./notion.js";

export interface CalendarSyncResult {
  eventsCreated: number;
  eventsSkipped: number;
  errors: string[];
}

function buildReminderDate(expirationDate: string): string {
  const expiry = new Date(expirationDate);
  const reminder = new Date(expiry.getTime() - 30 * 24 * 60 * 60 * 1000);
  return reminder.toISOString().split("T")[0];
}

function makeEventKey(docId: string, expirationDate: string): string {
  return `regulatory-renewal-${docId}-${expirationDate}`;
}

export async function syncCalendarReminders(
  calendarClient: {
    events: {
      list: (args: Record<string, unknown>) => Promise<{ data: { items?: unknown[] } }>;
      insert: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
    };
  },
  docs: NotionRegulatoryDoc[],
): Promise<CalendarSyncResult> {
  const settings = await getSettings();
  const result: CalendarSyncResult = { eventsCreated: 0, eventsSkipped: 0, errors: [] };

  if (!settings.googleCalendarId) {
    result.errors.push("Google Calendar ID not configured in settings.");
    return result;
  }

  const expiringDocs = docs.filter(
    (doc) =>
      doc.expirationDate &&
      doc.daysUntilExpiration !== null &&
      doc.daysUntilExpiration > 0 &&
      doc.daysUntilExpiration <= 30,
  );

  for (const doc of expiringDocs) {
    try {
      const reminderDate = buildReminderDate(doc.expirationDate!);
      const eventKey = makeEventKey(doc.id, doc.expirationDate!);

      const existing = await calendarClient.events.list({
        calendarId: settings.googleCalendarId,
        privateExtendedProperty: `regulatoryEventKey=${eventKey}`,
        timeMin: new Date(reminderDate + "T00:00:00Z").toISOString(),
        timeMax: new Date(reminderDate + "T23:59:59Z").toISOString(),
        singleEvents: true,
      });

      const items = (existing.data.items ?? []) as unknown[];
      if (items.length > 0) {
        result.eventsSkipped++;
        continue;
      }

      await calendarClient.events.insert({
        calendarId: settings.googleCalendarId,
        requestBody: {
          summary: `Renewal Reminder: ${doc.name}`,
          description: `Regulatory document "${doc.name}" expires on ${doc.expirationDate}. Review and renew before the deadline.${doc.fileLink ? `\n\nDocument: ${doc.fileLink}` : ""}`,
          start: { date: reminderDate },
          end: { date: reminderDate },
          extendedProperties: {
            private: { regulatoryEventKey: eventKey },
          },
          reminders: {
            useDefault: false,
            overrides: [{ method: "email", minutes: 24 * 60 }],
          },
        },
      });

      result.eventsCreated++;
    } catch (err) {
      result.errors.push(
        `Failed to create reminder for "${doc.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
