export interface TriggeredAlert {
  nctId: string;
  detectedAt: string;
  module: string;
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  detail: string;
}
