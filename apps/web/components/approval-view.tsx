"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, ShieldCheck, X } from "lucide-react";
import { OpsShell } from "@/components/ops-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Approval = {
  id: string;
  actionType: string;
  riskSummary: string;
  requiredCapability: string;
  requiredApprovalCount: number;
  status: string;
  requestedAt: string;
  expiresAt: string;
};

export function ApprovalView() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/v1/approvals", { cache: "no-store" });
    if (!response.ok) {
      setMessage("Approvals are unavailable for this account.");
      return;
    }
    const body = (await response.json()) as { data: Approval[] };
    setApprovals(body.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function decide(id: string, status: "approved" | "rejected") {
    setBusy(id);
    setMessage("");
    const response = await fetch(`/api/v1/approvals/${id}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status,
        reason:
          status === "approved"
            ? "Approved after reviewing the scoped synthetic action."
            : "Rejected after reviewing the scoped synthetic action.",
      }),
    });
    const body = (await response.json()) as {
      data?: { status: string };
      detail?: string;
    };
    setMessage(
      response.ok
        ? `Approval ${body.data?.status ?? status}.`
        : (body.detail ?? "Decision failed."),
    );
    await refresh();
    setBusy(null);
  }

  return (
    <OpsShell>
      <PageHeader
        eyebrow="Govern"
        title="Approvals"
        description="State-changing security actions requiring accountable human decisions"
      />
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-5xl space-y-3">
          {approvals.map((approval) => (
            <article
              key={approval.id}
              className="border border-[var(--color-warning)] bg-card"
            >
              <div className="flex flex-wrap items-center gap-2 border-b bg-[var(--color-warning-soft)] p-3">
                <ShieldCheck className="size-4" />
                <h2 className="flex-1 font-display text-sm font-bold">
                  {approval.actionType}
                </h2>
                <Badge>{approval.status}</Badge>
                <Badge className="approval-surface text-[var(--color-warning)]">
                  <Clock3 />
                  {new Date(approval.expiresAt).toLocaleString()}
                </Badge>
              </div>
              <div className="grid gap-4 p-4 tablet:grid-cols-[1fr_16rem]">
                <div>
                  <p className="text-xs font-bold uppercase text-muted-foreground">
                    Risk summary
                  </p>
                  <p className="mt-1 text-sm leading-6">
                    {approval.riskSummary}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Requires <code>{approval.requiredCapability}</code> and{" "}
                    {approval.requiredApprovalCount} decision
                    {approval.requiredApprovalCount === 1 ? "" : "s"}.
                  </p>
                </div>
                <div className="flex items-end gap-2 tablet:justify-end">
                  <Button
                    disabled={
                      approval.status !== "pending" || busy === approval.id
                    }
                    onClick={() => void decide(approval.id, "approved")}
                  >
                    <Check />
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      approval.status !== "pending" || busy === approval.id
                    }
                    onClick={() => void decide(approval.id, "rejected")}
                  >
                    <X />
                    Reject
                  </Button>
                </div>
              </div>
            </article>
          ))}
          {approvals.length === 0 && (
            <p className="border bg-card p-4 text-sm text-muted-foreground">
              No approval records.
            </p>
          )}
          {message && (
            <p role="status" className="border bg-card p-3 text-sm">
              {message}
            </p>
          )}
        </div>
      </div>
    </OpsShell>
  );
}
