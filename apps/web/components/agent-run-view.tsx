"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

type HarnessRun = {
  protocolVersion: "muster.agent-harness/v1";
  runId: string;
  status: string;
  agentKey: string;
  correlationId: string;
  duplicate: boolean;
  result: unknown;
};

export function AgentRunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<HarnessRun | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/agent-harness/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          data?: HarnessRun;
          detail?: string;
        };
        if (!response.ok || !body.data)
          throw new Error(body.detail ?? "Agent run is unavailable.");
        setRun(body.data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Agent run is unavailable.",
          );
      });
    return () => controller.abort();
  }, [runId]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Agent harness"
        title={run ? `${run.agentKey} run` : "Agent run"}
        description="Authoritative governed run status and typed result"
      />
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-5xl space-y-3">
          {run && (
            <>
              <section className="border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-base font-bold">
                    {run.agentKey}
                  </h2>
                  <Badge>{run.status}</Badge>
                </div>
                <dl className="mt-4 grid gap-3 text-sm tablet:grid-cols-2">
                  <div>
                    <dt className="text-xs font-bold uppercase text-muted-foreground">
                      Run
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {run.runId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase text-muted-foreground">
                      Correlation
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {run.correlationId}
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="border bg-card p-4">
                <h2 className="font-display text-sm font-bold">Typed result</h2>
                <pre className="mt-3 max-h-[34rem] overflow-auto whitespace-pre-wrap break-words border bg-muted/30 p-3 text-xs leading-5">
                  {run.result === null
                    ? "No typed result is available yet."
                    : JSON.stringify(run.result, null, 2)}
                </pre>
              </section>
            </>
          )}
          {!run && !error && (
            <p role="status" className="border bg-card p-4 text-sm">
              Loading agent run…
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="border border-destructive bg-card p-4 text-sm"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
