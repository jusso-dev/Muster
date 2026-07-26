"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import {
  Check,
  CircleCheck,
  Clock3,
  Code2,
  FlaskConical,
  Play,
  Save,
  Search,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workflowYaml, workflows } from "@/lib/demo-data";

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="grid h-[36rem] place-items-center bg-[var(--color-paper-2)] text-xs text-muted-foreground">Loading YAML editor…</div>,
});

export function WorkflowsView() {
  return (
    <AppShell>
      <PageHeader eyebrow="Tools" title="Workflows" description="Versioned, capability-scoped security operations" actions={<Button><Workflow />New workflow</Button>} />
      <div className="flex items-center gap-2 border-b bg-[var(--color-paper-2)] p-3"><label className="flex h-9 max-w-md flex-1 items-center gap-2 rounded-md border bg-background px-3"><Search className="size-4 text-muted-foreground" /><input aria-label="Search workflows" placeholder="Search workflows…" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label><Badge className="success-surface text-[var(--color-success)]">2 published</Badge><Badge className="bg-muted text-muted-foreground">1 draft</Badge></div>
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-6xl border bg-card">
          <div className="grid grid-cols-[minmax(14rem,1fr)_7rem_10rem_7rem] border-b bg-[var(--color-paper-3)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground tablet:grid-cols-[minmax(14rem,1fr)_7rem_13rem_8rem_7rem_6rem]"><span>Workflow</span><span>Version</span><span>Trigger</span><span className="hidden tablet:block">Owner</span><span className="hidden tablet:block">Last run</span><span>Status</span></div>
          {workflows.map((workflow) => <Link key={workflow.id} href={`/workflows/${workflow.id}`} className="hover-row grid grid-cols-[minmax(14rem,1fr)_7rem_10rem_7rem] items-center border-b px-3 py-3 text-xs last:border-0 tablet:grid-cols-[minmax(14rem,1fr)_7rem_13rem_8rem_7rem_6rem]"><div><p className="font-semibold">{workflow.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{workflow.steps} steps · {workflow.successRate} success</p></div><code>{workflow.version}</code><code className="truncate text-[10px]">{workflow.trigger}</code><span className="hidden tablet:block">{workflow.owner}</span><span className="hidden text-muted-foreground tablet:block">{workflow.lastRun}</span><Badge className={workflow.status === "published" ? "success-surface text-[var(--color-success)]" : "bg-muted text-muted-foreground"}>{workflow.status}</Badge></Link>)}
        </div>
      </div>
    </AppShell>
  );
}

export function WorkflowEditorView() {
  const [value, setValue] = useState(workflowYaml);
  const [validated, setValidated] = useState(true);
  return (
    <AppShell
      context={
        <div className="h-full overflow-y-auto">
          <div className="border-b p-4"><h2 className="font-display text-sm font-bold">Visual steps</h2><p className="mt-1 text-xs text-muted-foreground">Derived from current draft</p></div>
          <ol className="p-4">
            {["Create investigation","Gather endpoint context","Enrich observables","Analyst review","Promote"].map((step,index) => <li key={step} className="relative flex gap-3 pb-5 text-xs last:pb-0"><span className="z-10 grid size-6 shrink-0 place-items-center rounded-full border bg-background font-mono text-[10px]">{index + 1}</span>{index < 4 && <span className="absolute left-3 top-6 h-full w-px bg-border" />}<div><p className="font-semibold">{step}</p><p className="mt-1 text-[10px] text-muted-foreground">{index === 3 ? "Human approval · 30m timeout" : index === 4 ? "Kelpie case creation" : "Automatic · retry enabled"}</p></div></li>)}
          </ol>
        </div>
      }
    >
      <PageHeader eyebrow="Workflow · Draft" title="Suspicious PowerShell triage" description="Version 1.0.1 · based on published 1.0.0" actions={<><Button variant="outline"><FlaskConical />Dry run</Button><Button><Save />Save draft</Button></>} />
      <div className="flex flex-wrap items-center gap-2 border-b bg-[var(--color-paper-2)] px-3 py-2"><Badge className={validated ? "success-surface text-[var(--color-success)]" : "error-surface text-[var(--color-error)]"}>{validated ? <Check /> : <Code2 />}{validated ? "Schema valid" : "Validation failed"}</Badge><span className="text-[11px] text-muted-foreground">Unsaved changes remain a draft. Publish requires workflows.manage.</span><Button size="sm" variant="outline" className="ml-auto"><Play />Run test</Button></div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="yaml"
          value={value}
          onChange={(next) => { const text = next ?? ""; setValue(text); setValidated(text.includes("apiVersion: muster.security/v1") && text.includes("steps:")); }}
          theme="vs-dark"
          options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: "JetBrains Mono Variable", wordWrap: "on", automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 16, bottom: 16 } }}
          aria-label="Workflow YAML"
        />
      </div>
    </AppShell>
  );
}

export function WorkflowRunView() {
  return (
    <AppShell>
      <PageHeader eyebrow="Workflow run · WFR-2026-2281" title="Suspicious PowerShell triage" description="Triggered by ALT-2026-1042 · completed in 7m 18s" actions={<Button variant="outline"><Play />Run again</Button>} />
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-4xl border bg-card">
          {[["Create investigation","Completed","16:23:04","0.4s"],["Gather endpoint context","Completed","16:24:11","2m 43s"],["Enrich observables","Completed","16:27:02","1m 19s"],["Analyst review","Approved","16:34:41","2m 06s"],["Promote","Completed","16:37:12","1.8s"]].map(([step,status,time,duration],index) => <div key={step} className="grid grid-cols-[auto_1fr_auto] gap-3 border-b p-4 last:border-0 tablet:grid-cols-[auto_1fr_7rem_7rem]"><span className="grid size-7 place-items-center rounded-full success-surface text-[var(--color-success)]"><Check className="size-4" /></span><div><p className="text-sm font-semibold">{step}</p><p className="text-[10px] text-muted-foreground">Step {index + 1} · idempotency verified</p></div><Badge className={status === "Approved" ? "approval-surface text-[var(--color-warning)]" : "success-surface text-[var(--color-success)]"}>{status}</Badge><span className="hidden text-right text-xs text-muted-foreground tablet:block">{time}<br />{duration}</span></div>)}
        </div>
      </div>
    </AppShell>
  );
}
