import { StrikeCard } from "./StrikeCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Radar } from "lucide-react";

interface TriggeredAlert {
  nctId: string;
  detectedAt: string;
  headline: string;
  detail: string;
  severity: "critical" | "high" | "medium" | "low";
}

interface StrikeFeedProps {
  alerts: TriggeredAlert[];
  isLoading: boolean;
}

export function StrikeFeed({ alerts, isLoading }: StrikeFeedProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array(3)
          .fill(0)
          .map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Radar className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground text-base font-medium">
          Swarm operational. No competitor anomalies detected.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert, idx) => (
        <StrikeCard key={`${alert.nctId}-${alert.detectedAt}-${idx}`} alert={alert} />
      ))}
    </div>
  );
}
