import { AlertOctagon, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";

interface TriggeredAlert {
  nctId: string;
  detectedAt: string;
  headline: string;
  detail: string;
  severity: "critical" | "high" | "medium" | "low";
}

const severityConfig = {
  critical: {
    borderClass: "border-red-500",
    iconClass: "text-red-500",
    Icon: AlertOctagon,
    labelClass: "text-red-600 font-bold",
    label: "Critical",
  },
  high: {
    borderClass: "border-orange-400",
    iconClass: "text-orange-400",
    Icon: AlertTriangle,
    labelClass: "text-orange-600 font-semibold",
    label: "High",
  },
  medium: {
    borderClass: "border-yellow-400",
    iconClass: "text-yellow-500",
    Icon: AlertCircle,
    labelClass: "text-yellow-700 font-medium",
    label: "Medium",
  },
  low: {
    borderClass: "border-gray-300",
    iconClass: "text-gray-400",
    Icon: Info,
    labelClass: "text-gray-500",
    label: "Low",
  },
};

export function StrikeCard({ alert }: { alert: TriggeredAlert }) {
  const config = severityConfig[alert.severity];
  const { Icon } = config;

  const relativeTime = (() => {
    try {
      return formatDistanceToNow(parseISO(alert.detectedAt), {
        addSuffix: true,
      });
    } catch {
      return alert.detectedAt;
    }
  })();

  return (
    <div
      className={`rounded-lg border-2 ${config.borderClass} bg-card p-4 shadow-sm space-y-2`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${config.iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`text-sm uppercase tracking-wide ${config.labelClass}`}>
              {config.label}
            </span>
            <span className="text-xs font-mono text-muted-foreground">{alert.nctId}</span>
            <span className="text-xs text-muted-foreground">{relativeTime}</span>
          </div>
          <p className="font-bold text-foreground mt-1 text-sm leading-snug">
            {alert.headline}
          </p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground pl-8 leading-relaxed">
        {alert.detail}
      </p>
    </div>
  );
}
