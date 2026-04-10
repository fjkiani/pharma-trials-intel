import type { TrialData } from "./clinicalTrialsClient.js";

export interface DetectedDelta {
  changedFields: string[];
  changeSummary: string;
  clinicalInterpretation: string;
}

function compareFields(oldData: TrialData, newData: TrialData): { field: string; from: string; to: string }[] {
  const changes: { field: string; from: string; to: string }[] = [];

  if (oldData.overallStatus !== newData.overallStatus) {
    changes.push({ field: "overallStatus", from: oldData.overallStatus, to: newData.overallStatus });
  }

  if (oldData.primaryCompletionDate !== newData.primaryCompletionDate) {
    changes.push({
      field: "primaryCompletionDate",
      from: oldData.primaryCompletionDate ?? "N/A",
      to: newData.primaryCompletionDate ?? "N/A",
    });
  }

  if (oldData.enrollmentCount !== newData.enrollmentCount) {
    changes.push({
      field: "enrollmentCount",
      from: String(oldData.enrollmentCount ?? "N/A"),
      to: String(newData.enrollmentCount ?? "N/A"),
    });
  }

  if (oldData.enrollmentType !== newData.enrollmentType) {
    changes.push({
      field: "enrollmentType",
      from: oldData.enrollmentType ?? "N/A",
      to: newData.enrollmentType ?? "N/A",
    });
  }

  if (oldData.whyStopped !== newData.whyStopped && newData.whyStopped) {
    changes.push({
      field: "whyStopped",
      from: oldData.whyStopped ?? "N/A",
      to: newData.whyStopped,
    });
  }

  if (oldData.hasSeriousAdverseEvents !== newData.hasSeriousAdverseEvents && newData.hasSeriousAdverseEvents !== null) {
    changes.push({
      field: "hasSeriousAdverseEvents",
      from: oldData.hasSeriousAdverseEvents == null ? "Unknown" : String(oldData.hasSeriousAdverseEvents),
      to: String(newData.hasSeriousAdverseEvents),
    });
  }

  if (oldData.adverseEventsReportingStatus !== newData.adverseEventsReportingStatus && newData.adverseEventsReportingStatus) {
    changes.push({
      field: "adverseEventsReportingStatus",
      from: oldData.adverseEventsReportingStatus ?? "N/A",
      to: newData.adverseEventsReportingStatus,
    });
  }

  return changes;
}

export async function detectDeltas(
  oldData: TrialData,
  newData: TrialData,
): Promise<DetectedDelta | null> {
  const changes = compareFields(oldData, newData);
  if (changes.length === 0) return null;

  const changedFields = changes.map((c) => c.field);
  const changeLines = changes
    .map((c) => `- ${c.field}: "${c.from}" → "${c.to}"`)
    .join("\n");

  let changeSummary: string;
  let clinicalInterpretation: string;

  try {
    const { getOpenAIClient } = await import("./openaiClient.js");
    const openai = getOpenAIClient();

    const prompt = `You are a clinical research coordinator assistant. A competitor oncology trial has just been updated on ClinicalTrials.gov.

Trial: ${newData.studyTitle} (${newData.nctId})
Sponsor: ${newData.sponsor}
Conditions: ${newData.conditions.join(", ")}

Changes detected:
${changeLines}

Provide two things:
1. A plain-English one-sentence summary of what changed (start with the trial name).
2. A 1-2 sentence clinical interpretation of why this change matters and what the research coordinator should discuss with their PI.

Reply in JSON format:
{
  "changeSummary": "...",
  "clinicalInterpretation": "..."
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { changeSummary?: string; clinicalInterpretation?: string };
    changeSummary = parsed.changeSummary ?? buildFallbackSummary(newData, changes);
    clinicalInterpretation = parsed.clinicalInterpretation ?? buildFallbackInterpretation(changes);
  } catch {
    changeSummary = buildFallbackSummary(newData, changes);
    clinicalInterpretation = buildFallbackInterpretation(changes);
  }

  return { changedFields, changeSummary, clinicalInterpretation };
}

function buildFallbackSummary(trial: TrialData, changes: { field: string; from: string; to: string }[]): string {
  const parts = changes.map((c) => `${c.field} changed from "${c.from}" to "${c.to}"`);
  return `${trial.studyTitle} (${trial.nctId}): ${parts.join("; ")}.`;
}

function buildFallbackInterpretation(changes: { field: string; from: string; to: string }[]): string {
  const statusChange = changes.find((c) => c.field === "overallStatus");
  if (statusChange) {
    const to = statusChange.to.toLowerCase();
    if (to.includes("terminat") || to.includes("withdrawn") || to.includes("suspend")) {
      return "This trial appears to have stopped early — this may indicate safety, efficacy, or operational concerns. Discuss implications with your PI.";
    }
    if (to.includes("complet")) {
      return "This trial has completed, which may mean results publication is imminent. Consider monitoring for publications.";
    }
  }
  return "A significant change has been detected. Review the details and discuss with your PI as appropriate.";
}

export function buildPIBriefingContent(
  trial: TrialData,
  changeSummary: string,
  clinicalInterpretation: string,
): string {
  const now = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const aeSection = trial.hasSeriousAdverseEvents !== null
    ? `\nSafety / Adverse Events: ${trial.hasSeriousAdverseEvents ? "Serious adverse events reported" : "No serious adverse events in results"}`
    : "";
  const whyStoppedSection = trial.whyStopped
    ? `\nReason Stopped: ${trial.whyStopped}`
    : "";
  return `Competitor Trial Intelligence Briefing
Date: ${now}

Trial: ${trial.studyTitle}
NCT Number: ${trial.nctId}
Sponsor: ${trial.sponsor}
Conditions: ${trial.conditions.join(", ")}

CHANGE SUMMARY
${changeSummary}

CURRENT TRIAL STATUS
Overall Status: ${trial.overallStatus}${whyStoppedSection}
Primary Completion Date: ${trial.primaryCompletionDate ?? "N/A"}
Enrollment: ${trial.enrollmentCount ?? "N/A"} participants (${trial.enrollmentType ?? "N/A"})
Last Updated: ${trial.lastUpdatePostDate ?? "N/A"}${aeSection}

CLINICAL INTERPRETATION
${clinicalInterpretation}

RECOMMENDED ACTION
[PI to complete — based on the above, consider the following actions for our trial...]

---
Generated by Clinical Trials Co-Pilot — Competitor Watch`;
}
