import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/layout-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

interface KillChainRule {
  id: string;
  vectorName: string;
  category: "Math & Logic" | "Semantic" | "Operational";
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  triggerCondition: string;
  mode: "absolute" | "delta" | "absolute + delta";
  status: "active";
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchRules(): Promise<KillChainRule[]> {
  const res = await fetch(`${BASE}/api/strike/rules`);
  if (!res.ok) throw new Error(`Failed to load rules: ${res.status}`);
  return res.json() as Promise<KillChainRule[]>;
}

function severityVariant(s: KillChainRule["severity"]) {
  switch (s) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-200";
    case "high":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "medium":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "low":
      return "bg-blue-100 text-blue-800 border-blue-200";
  }
}

function modeLabel(mode: KillChainRule["mode"]) {
  switch (mode) {
    case "absolute":
      return "Absolute (any fetch)";
    case "delta":
      return "Delta (change detection)";
    case "absolute + delta":
      return "Absolute + Delta";
  }
}

const CATEGORY_ORDER: KillChainRule["category"][] = [
  "Math & Logic",
  "Semantic",
  "Operational",
];

const CATEGORY_DESCRIPTIONS: Record<KillChainRule["category"], string> = {
  "Math & Logic":
    "Rules that compute numeric thresholds or date comparisons against stored baseline values.",
  Semantic:
    "Rules that interpret the presence or absence of structured clinical data fields — no threshold arithmetic required.",
  Operational:
    "Rules that track status-machine transitions and lifecycle events in the trial registry.",
};

function RuleCard({ rule }: { rule: KillChainRule }) {
  return (
    <Card className="border border-border shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-bold text-base font-mono tracking-tight text-foreground">
              {rule.vectorName}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              {modeLabel(rule.mode)}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${severityVariant(rule.severity)}`}
            >
              {rule.severity}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              Active
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {rule.description}
        </p>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Trigger Logic
          </p>
          <pre className="rounded-md bg-muted border border-border px-4 py-3 text-xs font-mono text-foreground leading-relaxed overflow-x-auto whitespace-pre">
            {rule.triggerCondition}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminRules() {
  const { data: rules, isLoading, error } = useQuery({
    queryKey: ["kill-chain-rules"],
    queryFn: fetchRules,
    staleTime: Infinity,
  });

  return (
    <LayoutShell>
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">
            Signal Engine Configuration
          </h1>
          <p className="text-muted-foreground text-base">
            The deterministic rule set currently monitoring competitor trials across the watchlist.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading ruleset…</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" />
            <span>Failed to load rules: {(error as Error).message}</span>
          </div>
        )}

        {rules && (
          <div className="space-y-10">
            {CATEGORY_ORDER.map((category) => {
              const group = rules.filter((r) => r.category === category);
              if (group.length === 0) return null;
              return (
                <section key={category} className="space-y-4">
                  <div className="space-y-0.5 border-b border-border pb-3">
                    <h2 className="text-lg font-semibold tracking-tight">
                      {category}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {CATEGORY_DESCRIPTIONS[category]}
                    </p>
                  </div>
                  <div className="grid gap-4">
                    {group.map((rule) => (
                      <RuleCard key={rule.id} rule={rule} />
                    ))}
                  </div>
                </section>
              );
            })}

            <div className="rounded-md border border-border bg-muted/40 px-5 py-4 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {rules.length} rules active.
              </span>{" "}
              All alerts surface through this deterministic engine — no
              generative AI is involved in signal detection. Every alert maps
              directly to one of the conditions above.
            </div>
          </div>
        )}
      </div>
    </LayoutShell>
  );
}
