"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ShieldCheck, X } from "lucide-react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { ApprovalStateBadge, SeverityBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useApprovalDecision,
  useApprovals,
  type ApprovalRecord,
} from "@/lib/queries/hooks";
import { relativeTime } from "@/lib/utils";
import { toApprovalState } from "@/types/status";

function riskSeverity(summary: string): "medium" | "high" | "critical" {
  const lower = summary.toLowerCase();
  if (lower.includes("isolate") || lower.includes("disable") || lower.includes("delete"))
    return "critical";
  if (lower.includes("modify") || lower.includes("publish") || lower.includes("enrich"))
    return "high";
  return "medium";
}

export function GovernanceInbox() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const approvals = useApprovals();
  const decision = useApprovalDecision();
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [reason, setReason] = useState("");
  const [confirmHighImpact, setConfirmHighImpact] = useState(false);
  const [message, setMessage] = useState("");

  const rows = approvals.data ?? [];
  const selected =
    rows.find((row) => row.id === selectedId) ??
    rows.find((row) => row.id === focusId) ??
    rows[0] ??
    null;

  const pending = useMemo(
    () => rows.filter((row) => row.status === "pending"),
    [rows],
  );

  async function act(status: "approved" | "rejected") {
    if (!selected) return;
    setMessage("");
    if (status === "rejected" && reason.trim().length < 3) {
      setMessage("Rejection requires a reason.");
      return;
    }
    if (status === "approved" && reason.trim().length < 3) {
      setMessage("Approval requires a decision reason for the audit trail.");
      return;
    }
    const highImpact =
      riskSeverity(selected.riskSummary) === "critical" ||
      selected.actionType.includes("isolate") ||
      selected.actionType.includes("disable");
    if (status === "approved" && highImpact && !confirmHighImpact) {
      setMessage("Confirm high-impact approval before proceeding.");
      return;
    }
    try {
      const result = await decision.mutateAsync({
        id: selected.id,
        status,
        reason: reason.trim(),
      });
      setMessage(
        result.duplicate
          ? `Already recorded as ${result.status}.`
          : `Decision recorded: ${result.status}.`,
      );
      setReason("");
      setConfirmHighImpact(false);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Decision failed.",
      );
    }
  }

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Govern"
        title="Approvals"
        description="Governed inbox for dangerous actions. Decisions are written to the backend and audited."
      />
      <PageBody className="grid xl:grid-cols-[22rem_1fr]">
        {approvals.isError ? (
          <div className="xl:col-span-2">
            <ErrorState
              error={approvals.error}
              onRetry={() => void approvals.refetch()}
            />
          </div>
        ) : null}

        <section
          aria-labelledby="approval-list"
          className="rounded-md border border-border bg-card"
        >
          <div className="border-b border-border px-3 py-2">
            <h2 id="approval-list" className="text-sm font-semibold">
              Inbox
            </h2>
            <p className="text-xs text-muted-foreground">
              {pending.length} pending · {rows.length} total
            </p>
          </div>
          {approvals.isLoading ? (
            <div className="p-3">
              <SkeletonRows rows={5} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-3">
              <EmptyState
                title="No approval records"
                description="When agents or operators request gated actions, they appear here."
              />
            </div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={`w-full px-3 py-3 text-left hover:bg-muted/50 ${
                      selected?.id === row.id ? "bg-muted/70" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{row.actionType}</span>
                      <ApprovalStateBadge state={toApprovalState(row.status)} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {row.riskSummary}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {relativeTime(row.requestedAt)} · expires{" "}
                      {relativeTime(row.expiresAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="approval-detail"
          className="rounded-md border border-border bg-card"
        >
          {!selected ? (
            <div className="p-6">
              <EmptyState title="Select an approval" />
            </div>
          ) : (
            <ApprovalDetail
              approval={selected}
              reason={reason}
              setReason={setReason}
              confirmHighImpact={confirmHighImpact}
              setConfirmHighImpact={setConfirmHighImpact}
              message={message}
              busy={decision.isPending}
              onApprove={() => void act("approved")}
              onReject={() => void act("rejected")}
            />
          )}
        </section>
      </PageBody>
    </CompanyOsShell>
  );
}

function ApprovalDetail({
  approval,
  reason,
  setReason,
  confirmHighImpact,
  setConfirmHighImpact,
  message,
  busy,
  onApprove,
  onReject,
}: {
  approval: ApprovalRecord;
  reason: string;
  setReason: (value: string) => void;
  confirmHighImpact: boolean;
  setConfirmHighImpact: (value: boolean) => void;
  message: string;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const severity = riskSeverity(approval.riskSummary);
  const highImpact = severity === "critical";
  const pending = approval.status === "pending";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-warning)]/40 bg-[var(--color-warning-soft)] px-4 py-3">
        <ShieldCheck className="size-4" aria-hidden />
        <h2 id="approval-detail" className="min-w-0 flex-1 font-display text-sm font-bold">
          {approval.actionType}
        </h2>
        <ApprovalStateBadge state={toApprovalState(approval.status)} />
        <SeverityBadge severity={severity} />
      </div>

      <div className="space-y-4 p-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Requested action
          </h3>
          <p className="mt-1 text-sm leading-6">{approval.riskSummary}</p>
        </div>

        <dl className="grid gap-3 text-sm tablet:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Required capability
            </dt>
            <dd className="mt-0.5 font-mono text-xs">{approval.requiredCapability}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Approvals required
            </dt>
            <dd className="mt-0.5">{approval.requiredApprovalCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Requested
            </dt>
            <dd className="mt-0.5 font-mono text-xs">
              {new Date(approval.requestedAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Expires
            </dt>
            <dd className="mt-0.5 font-mono text-xs">
              {new Date(approval.expiresAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Approval id
            </dt>
            <dd className="mt-0.5 font-mono text-xs break-all">{approval.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Affected system
            </dt>
            <dd className="mt-0.5">
              <Badge className="bg-muted text-muted-foreground">
                Muster governed action
              </Badge>
            </dd>
          </div>
        </dl>

        {pending ? (
          <div className="space-y-3 rounded-md border border-border bg-[var(--color-paper)] p-3">
            <label className="block text-xs font-semibold" htmlFor="decision-reason">
              Decision reason (required)
            </label>
            <textarea
              id="decision-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="Explain the decision for the audit trail…"
            />
            {highImpact ? (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={confirmHighImpact}
                  onChange={(event) =>
                    setConfirmHighImpact(event.target.checked)
                  }
                  className="mt-0.5"
                />
                <span>
                  I confirm this high-impact action was reviewed and is within
                  policy for the current organisation.
                </span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={onApprove}
              >
                <Check className="size-4" />
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onReject}
              >
                <X className="size-4" />
                Reject
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This approval is no longer pending.
            {approval.reason ? ` Reason: ${approval.reason}` : ""}
          </p>
        )}

        {message ? (
          <p role="status" className="rounded-md border border-border bg-card p-3 text-sm">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
