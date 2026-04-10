const BASE_URL = "https://clinicaltrials.gov/api/v2/studies";

export interface TrialData {
  nctId: string;
  studyTitle: string;
  sponsor: string;
  conditions: string[];
  overallStatus: string;
  primaryCompletionDate: string | null;
  enrollmentCount: number | null;
  enrollmentType: string | null;
  lastUpdatePostDate: string | null;
  hasSeriousAdverseEvents: boolean | null;
  adverseEventsReportingStatus: string | null;
  whyStopped: string | null;
}

function extractField(study: Record<string, unknown>, ...path: string[]): unknown {
  let current: unknown = study;
  for (const key of path) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current ?? null;
}

export async function fetchTrial(nctId: string): Promise<TrialData | null> {
  const normalized = nctId.trim().toUpperCase();
  const url = `${BASE_URL}/${normalized}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClinicalTrials.gov API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  const protocolSection = extractField(data, "protocolSection") as Record<string, unknown> | null;
  if (!protocolSection) return null;

  const identificationModule = extractField(protocolSection, "identificationModule") as Record<string, unknown> | null;
  const statusModule = extractField(protocolSection, "statusModule") as Record<string, unknown> | null;
  const designModule = extractField(protocolSection, "designModule") as Record<string, unknown> | null;
  const sponsorCollaboratorsModule = extractField(protocolSection, "sponsorCollaboratorsModule") as Record<string, unknown> | null;
  const conditionsModule = extractField(protocolSection, "conditionsModule") as Record<string, unknown> | null;

  const title =
    (extractField(identificationModule ?? {}, "briefTitle") as string | null) ??
    (extractField(identificationModule ?? {}, "officialTitle") as string | null) ??
    normalized;

  const sponsor =
    (extractField(sponsorCollaboratorsModule ?? {}, "leadSponsor", "name") as string | null) ?? "Unknown";

  const conditions = (extractField(conditionsModule ?? {}, "conditions") as string[] | null) ?? [];

  const overallStatus = (extractField(statusModule ?? {}, "overallStatus") as string | null) ?? "Unknown";

  const primaryCompletionDateStruct = extractField(statusModule ?? {}, "primaryCompletionDateStruct") as Record<string, unknown> | null;
  const primaryCompletionDate = (primaryCompletionDateStruct?.date as string | null) ?? null;

  const lastUpdatePostDateStruct = extractField(statusModule ?? {}, "lastUpdatePostDateStruct") as Record<string, unknown> | null;
  const lastUpdatePostDate = (lastUpdatePostDateStruct?.date as string | null) ?? null;

  const enrollmentInfo = extractField(designModule ?? {}, "enrollmentInfo") as Record<string, unknown> | null;
  const enrollmentCount = enrollmentInfo?.count != null ? Number(enrollmentInfo.count) : null;
  const enrollmentType = (enrollmentInfo?.type as string | null) ?? null;

  const whyStopped = (extractField(statusModule ?? {}, "whyStopped") as string | null) ?? null;

  const resultsSection = (extractField(data, "resultsSection") as Record<string, unknown> | null) ?? null;
  const adverseEventsModule = (extractField(resultsSection ?? {}, "adverseEventsModule") as Record<string, unknown> | null) ?? null;
  const hasSeriousAdverseEvents = adverseEventsModule != null
    ? (Array.isArray(adverseEventsModule.seriousEvents) ? (adverseEventsModule.seriousEvents as unknown[]).length > 0 : false)
    : null;
  const adverseEventsReportingStatus = (extractField(adverseEventsModule ?? {}, "adverseEventsDescription") as string | null) ??
    (adverseEventsModule != null ? "Reported" : null);

  return {
    nctId: normalized,
    studyTitle: title,
    sponsor,
    conditions,
    overallStatus,
    primaryCompletionDate,
    enrollmentCount,
    enrollmentType,
    lastUpdatePostDate,
    hasSeriousAdverseEvents,
    adverseEventsReportingStatus,
    whyStopped,
  };
}

export async function fetchMultipleTrials(nctIds: string[]): Promise<Map<string, TrialData | null>> {
  const results = new Map<string, TrialData | null>();
  await Promise.all(
    nctIds.map(async (id) => {
      try {
        results.set(id, await fetchTrial(id));
      } catch {
        results.set(id, null);
      }
    }),
  );
  return results;
}
