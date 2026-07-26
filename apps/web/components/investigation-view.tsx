"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Check,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  FileSearch,
  Link2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { SeverityBadge } from "@/components/severity";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { activeInvestigation } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

const tabs = [
  "Overview",
  "Timeline",
  "Alerts",
  "Hypotheses",
  "Findings",
  "Entities",
  "Observables",
  "Evidence",
  "Queries",
  "Agents",
  "Decisions",
  "Workflows",
];

function Context() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b p-4">
        <h2 className="font-display text-sm font-bold">Promotion readiness</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Kelpie remains authoritative after promotion.
        </p>
      </div>
      <div className="space-y-3 p-4">
        {[
          ["Summary reviewed", true],
          ["2 alerts linked", true],
          ["3 findings reviewed", false],
          ["Evidence hashes verified", true],
          ["Human approval", false],
        ].map(([label, done]) => (
          <div key={String(label)} className="flex items-center gap-2 text-xs">
            {done ? (
              <Check className="size-4 text-[var(--color-success)]" />
            ) : (
              <CircleDashed className="size-4 text-[var(--color-warning)]" />
            )}
            <span className="flex-1">{label}</span>
          </div>
        ))}
        <div className="border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-xs leading-5">
          Human approval required before case creation.
        </div>
        <Button
          className="w-full"
          disabled
          title="Approval workflow is not available yet"
        >
          <ShieldCheck />
          Review promotion
        </Button>
      </div>
    </div>
  );
}

function Overview() {
  return (
    <div className="grid gap-4 wide:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <section className="border bg-card p-4">
          <h2 className="font-display text-sm font-bold">Current summary</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">
            {activeInvestigation.summary}
          </p>
          <div className="mt-4 rounded-md border bg-[var(--color-accent-soft)] p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Recommended disposition
            </p>
            <p className="mt-1 text-sm font-semibold">
              {activeInvestigation.recommendation}
            </p>
          </div>
        </section>
        <section className="border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <h2 className="font-display text-sm font-bold">
              Important findings
            </h2>
            <Link
              href="INV-2026-0178/findings"
              className="text-xs text-[var(--color-accent)]"
            >
              View all
            </Link>
          </div>
          {activeInvestigation.findings.map((finding) => (
            <div
              key={finding.id}
              className="grid grid-cols-[auto_1fr_auto] gap-3 border-b p-3 last:border-0"
            >
              <SeverityBadge severity={finding.severity} compact />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{finding.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {finding.summary}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {finding.author} · {finding.evidence} evidence references
                </p>
              </div>
              <Badge
                className={
                  finding.reviewed
                    ? "success-surface text-[var(--color-success)]"
                    : "approval-surface text-[var(--color-warning)]"
                }
              >
                {finding.reviewed ? "Reviewed" : "Review needed"}
              </Badge>
            </div>
          ))}
        </section>
        <section className="border bg-card">
          <div className="border-b px-3 py-2.5">
            <h2 className="font-display text-sm font-bold">Recent activity</h2>
          </div>
          {[
            ["2 min", "Triage Agent", "Recommended promotion to a formal case"],
            ["6 min", "Priya Nair", "Requested endpoint isolation approval"],
            [
              "11 min",
              "Threat Intelligence Agent",
              "Added newly observed domain finding",
            ],
            ["18 min", "Muster", "Correlated Bower and Tawny alerts"],
          ].map(([time, actor, activity]) => (
            <div
              key={time}
              className="flex gap-3 border-b p-3 text-xs last:border-0"
            >
              <Clock3 className="size-4 text-muted-foreground" />
              <span className="w-12 text-muted-foreground">{time}</span>
              <strong>{actor}</strong>
              <span className="text-muted-foreground">{activity}</span>
            </div>
          ))}
        </section>
      </div>
      <aside className="space-y-4">
        <section className="border bg-card p-3">
          <h2 className="font-display text-sm font-bold">Key observables</h2>
          <div className="mt-3 space-y-2">
            {[
              "203.0.113.44",
              "cdn-auth-check.example",
              "jsmith",
              "WS-1042",
              "68b3…91ad",
            ].map((value) => (
              <code
                key={value}
                className="block select-all border bg-muted px-2 py-1.5 text-xs"
              >
                {value}
              </code>
            ))}
          </div>
        </section>
        <section className="border border-[var(--color-agent)] bg-[var(--color-agent-soft)] p-3">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-[var(--color-agent)]" />
            <h2 className="font-display text-sm font-bold">Agent activity</h2>
          </div>
          <div className="mt-3 space-y-3 text-xs">
            <div>
              <p className="font-semibold">Detection Engineering Agent</p>
              <p className="text-muted-foreground">
                Drafting Sigma and KQL · 01:18
              </p>
            </div>
            <div>
              <p className="font-semibold">Tawny Hunt Agent</p>
              <p className="text-muted-foreground">
                Completed · 5 evidence · 94%
              </p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

function Hypotheses() {
  const statuses = [
    "unverified",
    "supported",
    "contradicted",
    "inconclusive",
  ] as const;
  return (
    <div className="grid gap-3 wide:grid-cols-4">
      {statuses.map((status) => (
        <section key={status}>
          <div className="mb-2 flex items-center justify-between border-b pb-2">
            <h2 className="text-xs font-bold capitalize">{status}</h2>
            <Badge className="bg-muted text-muted-foreground">
              {
                activeInvestigation.hypotheses.filter(
                  (item) => item.status === status,
                ).length
              }
            </Badge>
          </div>
          {activeInvestigation.hypotheses
            .filter((item) => item.status === status)
            .map((hypothesis) => (
              <article key={hypothesis.id} className="border bg-card p-3">
                <p className="mono text-xs text-muted-foreground">
                  {hypothesis.id}
                </p>
                <h3 className="mt-2 text-sm font-semibold leading-5">
                  {hypothesis.statement}
                </h3>
                <div className="mt-3 h-1.5 bg-muted">
                  <div
                    className="h-full bg-[var(--color-accent)]"
                    style={{ width: `${hypothesis.confidence}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span>{hypothesis.confidence}% confidence</span>
                  <span>
                    +{hypothesis.support} / −{hypothesis.contradict}
                  </span>
                </div>
                <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                  {hypothesis.owner}
                </p>
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}

function Findings() {
  return (
    <div className="space-y-3">
      {activeInvestigation.findings.map((finding) => (
        <article key={finding.id} className="border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <SeverityBadge severity={finding.severity} />
            <h2 className="flex-1 font-display text-sm font-bold">
              {finding.title}
            </h2>
            <Badge
              className={
                finding.authorType === "agent"
                  ? "agent-surface"
                  : "bg-muted text-muted-foreground"
              }
            >
              {finding.authorType === "agent"
                ? "Agent finding"
                : "Human finding"}
            </Badge>
            <Badge
              className={
                finding.reviewed
                  ? "success-surface text-[var(--color-success)]"
                  : "approval-surface text-[var(--color-warning)]"
              }
            >
              {finding.reviewed ? "Human reviewed" : "Review required"}
            </Badge>
          </div>
          <div className="grid gap-4 p-4 tablet:grid-cols-[minmax(0,1fr)_15rem]">
            <div>
              <p className="text-sm leading-6">{finding.summary}</p>
              <div className="mt-3 rounded-md border bg-[var(--color-warning-soft)] p-3">
                <p className="text-xs font-bold uppercase text-muted-foreground">
                  Recommended action
                </p>
                <p className="mt-1 text-xs">{finding.action}</p>
              </div>
            </div>
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Author</dt>
                <dd className="font-semibold">{finding.author}</dd>
              </div>
              {"runtime" in finding && (
                <div>
                  <dt className="text-muted-foreground">Runtime / model</dt>
                  <dd>{finding.runtime}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Confidence</dt>
                <dd className="font-semibold">{finding.confidence}%</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Evidence</dt>
                <dd>{finding.evidence} references</dd>
              </div>
            </dl>
          </div>
        </article>
      ))}
    </div>
  );
}

export function InvestigationView({ tab = "overview" }: { tab?: string }) {
  const [promotionOpen, setPromotionOpen] = useState(false);

  return (
    <AppShell context={<Context />}>
      <PageHeader
        eyebrow={`Investigation · ${activeInvestigation.number}`}
        title={activeInvestigation.title}
        description={`Created ${activeInvestigation.created} · Last activity ${activeInvestigation.lastActivity}`}
        actions={
          <>
            <Button
              variant="outline"
              disabled
              title="Case closure is not available yet"
            >
              <ClipboardCheck />
              Close
            </Button>
            <Button onClick={() => setPromotionOpen(true)}>
              <ArrowUpRight />
              Promote to Kelpie
            </Button>
          </>
        }
      />
      {promotionOpen && (
        <section
          id="promotion-readiness"
          aria-label="Promotion readiness"
          className="max-h-[55dvh] overflow-y-auto border-b bg-[var(--color-paper-2)] desktop:hidden"
        >
          <Context />
        </section>
      )}
      <div className="border-b bg-[var(--color-paper-2)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={activeInvestigation.severity} />
          <Badge className="approval-surface text-[var(--color-warning)]">
            {activeInvestigation.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Lead{" "}
            <strong className="text-foreground">
              {activeInvestigation.lead}
            </strong>
          </span>
          <span className="text-xs text-muted-foreground">
            {activeInvestigation.linkedAlerts} alerts
          </span>
          <Badge className="active-indicator">
            {activeInvestigation.linkedCase}
          </Badge>
          <div className="ml-auto flex -space-x-1">
            {activeInvestigation.participants.map((initials) => (
              <Avatar
                key={initials}
                initials={initials}
                size="sm"
                agent={initials === "TA" || initials === "TH"}
                className="ring-2 ring-[var(--color-paper-2)]"
              />
            ))}
          </div>
        </div>
      </div>
      <nav
        aria-label="Investigation sections"
        className="scroll-region flex shrink-0 overflow-x-auto border-b px-3"
      >
        {tabs.map((item) => {
          const key = item.toLowerCase();
          const href =
            key === "overview"
              ? `/investigations/${activeInvestigation.number}`
              : `/investigations/${activeInvestigation.number}/${key}`;
          return (
            <Link
              key={item}
              href={href}
              className={cn(
                "shrink-0 border-b-2 border-transparent px-3 py-2.5 text-xs font-semibold text-muted-foreground",
                tab === key && "border-[var(--color-accent)] text-foreground",
              )}
            >
              {item}
            </Link>
          );
        })}
      </nav>
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-6xl">
          {tab === "hypotheses" ? (
            <Hypotheses />
          ) : tab === "findings" ? (
            <Findings />
          ) : (
            <Overview />
          )}
        </div>
      </div>
    </AppShell>
  );
}
