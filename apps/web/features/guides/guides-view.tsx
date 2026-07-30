"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

type Guide = {
  id: string;
  title: string;
  summary: string;
  body: string[];
};

const guides: Guide[] = [
  {
    id: "what-muster-is",
    title: "What Muster is (and is not)",
    summary: "Governed OS for an AI-enabled security company",
    body: [
      "Muster coordinates people, agents, missions, approvals, evidence, and integrations under organisation policy.",
      "It is not a SIEM, EDR, SOAR, case system, or chat product.",
      "Kelpie remains formal case system of record. Tawny, Bower, Sentinel, Defender, cloud platforms, and similar tools remain authoritative for their own records.",
      "Chat with Parker, Jessie, and Alfie happens in Slack (or Hermes via MCP) — not inside this web UI.",
    ],
  },
  {
    id: "real-vs-empty",
    title: "Real data vs empty states",
    summary: "No demo seed in the operational UI",
    body: [
      "Command, Approvals, Agents, Operations, Missions, Audit, and Integrations load organisation-scoped rows from the API.",
      "Empty lists mean no records for your organisation yet — not a broken UI.",
      "Teams and Capabilities stay empty until governed APIs exist. The product does not inject sample SOC teams or fake skill installs.",
      "Bootstrap creates your organisation and admin actor only. Optional demo seed (MUSTER_DEMO_MODE) is separate and must not run on private homelab.",
    ],
  },
  {
    id: "command",
    title: "Command",
    summary: "What needs attention now",
    body: [
      "Open Command first. Metrics and the attention queue come from live approvals, tasks, agents, missions, and connector health (subject to your capabilities).",
      "Risk radar cells are labelled heuristic summaries from counts — not a hidden composite score.",
      "If a metric is missing, you may lack a capability such as administration.manage or workflows.approve.",
    ],
  },
  {
    id: "operations",
    title: "Operations work queue",
    summary: "List and drag-and-drop board",
    body: [
      "Operations shows coordination tasks for your organisation.",
      "Board mode (default): drag a card between Backlog, Ready, In progress, Review, and Done. Status updates call PATCH /api/v1/tasks/:id and require tasks.update.",
      "List mode: denser table with the same detail drawer.",
      "Linked external IDs (for example a Kelpie case id) are references only — open the system of record for the full case.",
    ],
  },
  {
    id: "approvals",
    title: "Governance Inbox (Approvals)",
    summary: "Dangerous actions stay human-gated",
    body: [
      "Approvals list pending and historical decisions for gated actions (host isolate, case enrichment, and similar).",
      "Every decision needs a written reason for the audit trail. High-impact actions require an extra confirmation.",
      "Approve/reject never succeeds only in the browser — the backend ApprovalDomainService writes status and audit events.",
    ],
  },
  {
    id: "agents",
    title: "Agents",
    summary: "Onboard pack agents and see readiness",
    body: [
      "Open Agents → Onboard agent to create a new pack agent (needs agents.manage). Teams has the same action for humans + agents.",
      "After create: open the agent profile, confirm capabilities (e.g. tawny.hunts.execute, kelpie.cases.read, brolga.context.read), expose in Slack if chat is required, then assign work from Operations.",
      "The scoreboard shows kill switch, runtime, and readiness evidence. Chat is Slack or Hermes — not a second chat surface here.",
    ],
  },
  {
    id: "missions-audit",
    title: "Missions and Audit",
    summary: "UI CRUD + append-only history",
    body: [
      "Missions: create, edit (versioned revisions), and archive from the Missions page (workflows.manage).",
      "Hermes can still accept runs with muster_accept_mission_run when the installation has that scope.",
      "Audit is organisation-scoped, redacted, and capped. External connector content is untrusted evidence — never treat it as agent instructions.",
    ],
  },
  {
    id: "integrations",
    title: "Integrations — Kelpie, Tawny, Brolga",
    summary: "How external product data enters Muster",
    body: [
      "Integrations cards are health + enablement for governed connectors. Credentials never appear in the UI.",
      "Kelpie: case SoR. Access via connector queries, MCP muster_search_kelpie_cases / muster_get_kelpie_case, or agents with kelpie.cases.read.",
      "Tawny: endpoint inventory, alerts, hunts. Access via Jessie (tawny.* caps), MCP muster_list_tawny_* / muster_run_tawny_hunt, or Connector admin test queries.",
      "Brolga: normalised TI context packs. Access via brolga.context.read on an agent or MCP muster_get_brolga_context (kind + value). unknown ≠ benign.",
      "Path for all three: capability check → queue connector query → worker → product API → redacted evidence. Configure under Connector admin; Slack under Settings → Slack.",
    ],
  },
  {
    id: "teams",
    title: "Teams — humans and agents",
    summary: "Invite people and clean demo roster",
    body: [
      "Teams is the governed directory. Add human creates a login + actor with a starter role (administration.manage).",
      "Onboard agent is also available from Teams; prefer Agents → Onboard agent when you are already staffing the pack.",
      "Remove demo members deactivates @yuma.example humans and orphan agents without definitions. Deactivate never hard-deletes.",
    ],
  },
];

export function GuidesView() {
  const [activeId, setActiveId] = useState(guides[0]?.id ?? "");
  const active = useMemo(
    () => guides.find((guide) => guide.id === activeId) ?? guides[0] ?? null,
    [activeId],
  );

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Configure"
        title="Guides"
        description="How to operate Muster as the Security Company OS. Product documentation — not live operational records."
      />
      <PageBody className="grid xl:grid-cols-[16rem_1fr]">
        <nav
          aria-label="Guides"
          className="rounded-md border border-border bg-card p-2"
        >
          <ul className="space-y-0.5">
            {guides.map((guide) => (
              <li key={guide.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(guide.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm",
                    active?.id === guide.id
                      ? "bg-muted font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <BookOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="block">{guide.title}</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {guide.summary}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {active ? (
          <article className="rounded-md border border-border bg-card p-4 tablet:p-5">
            <h2 className="font-display text-lg font-semibold">{active.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{active.summary}</p>
            <div className="mt-4 space-y-3 text-sm leading-6">
              {active.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-4 text-xs">
              <Link href="/" className="font-medium underline-offset-2 hover:underline">
                Open Command
              </Link>
              <Link
                href="/operations"
                className="font-medium underline-offset-2 hover:underline"
              >
                Open Operations board
              </Link>
              <Link
                href="/approvals"
                className="font-medium underline-offset-2 hover:underline"
              >
                Open Approvals
              </Link>
            </div>
          </article>
        ) : null}
      </PageBody>
    </CompanyOsShell>
  );
}
