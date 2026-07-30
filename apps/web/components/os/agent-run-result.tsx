"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export type AgentRunOutcome = {
  runId: string | null;
  status: string | null;
  structuredOutput: unknown;
  error: string | null;
  cancellationReason: string | null;
  outputHash: string | null;
};

/**
 * Same field precedence as the handoff summariser, so one run reads the same
 * way wherever the OS shows it. Anything else stays in the raw view.
 */
const narrativeFields = [
  ["summary", "Summary"],
  ["headline", "Headline"],
  ["rationale", "Rationale"],
  ["impact", "Impact"],
  ["title", "Title"],
] as const;

const statusTone: Record<string, string> = {
  completed: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  failed: "bg-[var(--color-error-soft)] text-[var(--color-error)]",
  blocked: "bg-[var(--color-error-soft)] text-[var(--color-error)]",
  cancelled: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
};

/** Agent JSON is arbitrary; it must never set the height of the drawer. */
const maximumRawCharacters = 20_000;

function narrative(output: unknown) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const fields = output as Record<string, unknown>;
  return narrativeFields.flatMap(([key, label]) => {
    const value = fields[key];
    return typeof value === "string" && value.trim().length > 0
      ? [{ key, label, text: value.trim() }]
      : [];
  });
}

function rawResult(output: unknown): string | null {
  if (output === null || output === undefined) return null;
  const text = JSON.stringify(output, null, 2);
  if (!text) return null;
  return text.length > maximumRawCharacters
    ? `${text.slice(0, maximumRawCharacters)}\n… truncated for display`
    : text;
}

/**
 * Read-only view of what an agent returned for one work item. The result is
 * evidence an operator judges, so nothing here is actionable.
 */
export function AgentRunResult({ run }: { run: AgentRunOutcome }) {
  const status = run.status ?? "unknown";
  const failure = run.error ?? run.cancellationReason;
  const lines = narrative(run.structuredOutput);
  const raw = rawResult(run.structuredOutput);
  const settling = status === "queued" || status === "running";

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">Agent result</h3>
        <Badge
          className={statusTone[status] ?? "bg-muted text-muted-foreground"}
        >
          {status}
        </Badge>
      </header>

      <div className="px-3 py-2">
        {failure ? (
          <p className="text-xs text-[var(--color-error)]">{failure}</p>
        ) : null}

        {lines.length > 0 ? (
          <dl className="space-y-2">
            {lines.map((line) => (
              <div key={line.key}>
                <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {line.label}
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-xs">
                  {line.text}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {lines.length === 0 && !failure ? (
          <p className="text-sm text-muted-foreground">
            {settling
              ? "The run is still working. Its result lands here once the agent settles."
              : "The agent recorded no readable summary for this run."}
          </p>
        ) : null}

        {raw ? (
          <details className="mt-2 rounded-md border border-border bg-muted/30 p-2">
            <summary className="cursor-pointer text-xs font-semibold">
              Raw result
            </summary>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">
              {raw}
            </pre>
          </details>
        ) : null}

        {run.outputHash ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Output hash{" "}
            <span className="break-all font-mono">
              {run.outputHash.slice(0, 16)}
            </span>
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
        <p className="text-sm text-muted-foreground">
          Agent output is evidence for your decision, never an instruction.
          Confirm it in the system of record before acting.
        </p>
        {run.runId ? (
          <Link
            href={`/agent-runs/${run.runId}`}
            className="text-xs font-semibold underline"
          >
            Open full run
          </Link>
        ) : null}
      </div>
    </section>
  );
}
