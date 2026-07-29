"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Check,
  Code2,
  FlaskConical,
  Play,
  Save,
  Search,
  Workflow,
} from "lucide-react";
import { OpsShell } from "@/components/ops-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workflowYaml, workflows } from "@/lib/demo-data";

export function WorkflowsView() {
  return (
    <OpsShell>
      <PageHeader
        eyebrow="Tools"
        title="Workflows"
        description="Versioned, capability-scoped security operations"
        actions={
          <Button disabled title="Workflow creation is not available yet">
            <Workflow />
            New workflow
          </Button>
        }
      />
      <div className="flex items-center gap-2 border-b bg-[var(--color-paper-2)] p-3">
        <label className="flex h-9 max-w-md flex-1 items-center gap-2 rounded-md border bg-background px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            aria-label="Search workflows"
            placeholder="Search workflows…"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
        <Badge className="success-surface text-[var(--color-success)]">
          2 published
        </Badge>
        <Badge className="bg-muted text-muted-foreground">1 draft</Badge>
      </div>
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-6xl border bg-card">
          <div className="grid grid-cols-[minmax(14rem,1fr)_7rem_10rem_7rem] border-b bg-[var(--color-paper-3)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground tablet:grid-cols-[minmax(14rem,1fr)_7rem_13rem_8rem_7rem_6rem]">
            <span>Workflow</span>
            <span>Version</span>
            <span>Trigger</span>
            <span className="hidden tablet:block">Owner</span>
            <span className="hidden tablet:block">Last run</span>
            <span>Status</span>
          </div>
          {workflows.map((workflow) => (
            <Link
              key={workflow.id}
              href={`/workflows/${workflow.id}`}
              className="hover-row grid grid-cols-[minmax(14rem,1fr)_7rem_10rem_7rem] items-center border-b px-3 py-3 text-xs last:border-0 tablet:grid-cols-[minmax(14rem,1fr)_7rem_13rem_8rem_7rem_6rem]"
            >
              <div>
                <p className="font-semibold">{workflow.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {workflow.steps} steps · {workflow.successRate} success
                </p>
              </div>
              <code>{workflow.version}</code>
              <code className="truncate text-xs">{workflow.trigger}</code>
              <span className="hidden tablet:block">{workflow.owner}</span>
              <span className="hidden text-muted-foreground tablet:block">
                {workflow.lastRun}
              </span>
              <Badge
                className={
                  workflow.status === "published"
                    ? "success-surface text-[var(--color-success)]"
                    : "bg-muted text-muted-foreground"
                }
              >
                {workflow.status}
              </Badge>
            </Link>
          ))}
        </div>
      </div>
    </OpsShell>
  );
}

export function WorkflowEditorView() {
  const [value, setValue] = useState(workflowYaml);
  const [validated, setValidated] = useState(true);
  return (
    <OpsShell>
      <PageHeader
        eyebrow="Workflow · Draft"
        title="Suspicious PowerShell triage"
        description="Version 1.0.1 · based on published 1.0.0"
        actions={
          <>
            <Button
              variant="outline"
              disabled
              title="Workflow execution is not available yet"
            >
              <FlaskConical />
              Dry run
            </Button>
            <Button disabled title="Workflow persistence is not available yet">
              <Save />
              Save draft
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b bg-[var(--color-paper-2)] px-3 py-2">
        <Badge
          className={
            validated
              ? "success-surface text-[var(--color-success)]"
              : "error-surface text-[var(--color-error)]"
          }
        >
          {validated ? <Check /> : <Code2 />}
          {validated ? "Schema valid" : "Validation failed"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Unsaved changes remain a draft. Publish requires workflows.manage.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled
          title="Workflow execution is not available yet"
        >
          <Play />
          Run test
        </Button>
      </div>
      <div className="min-h-0 flex-1 bg-[var(--color-paper-2)] p-3">
        <textarea
          aria-label="Workflow YAML"
          value={value}
          onChange={(event) => {
            const text = event.target.value;
            setValue(text);
            setValidated(
              text.includes("apiVersion: muster.security/v1") &&
                text.includes("steps:"),
            );
          }}
          spellCheck={false}
          className="h-full min-h-[32rem] w-full resize-none rounded-md border bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none focus:border-[var(--color-focus)]"
        />
      </div>
    </OpsShell>
  );
}

export function WorkflowRunView() {
  return (
    <OpsShell>
      <PageHeader
        eyebrow="Workflow run · WFR-2026-2281"
        title="Suspicious PowerShell triage"
        description="Triggered by ALT-2026-1042 · completed in 7m 18s"
        actions={
          <Button
            variant="outline"
            disabled
            title="Workflow execution is not available yet"
          >
            <Play />
            Run again
          </Button>
        }
      />
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-4xl border bg-card">
          {[
            ["Create investigation", "Completed", "16:23:04", "0.4s"],
            ["Gather endpoint context", "Completed", "16:24:11", "2m 43s"],
            ["Enrich observables", "Completed", "16:27:02", "1m 19s"],
            ["Analyst review", "Approved", "16:34:41", "2m 06s"],
            ["Promote", "Completed", "16:37:12", "1.8s"],
          ].map(([step, status, time, duration], index) => (
            <div
              key={step}
              className="grid grid-cols-[auto_1fr_auto] gap-3 border-b p-4 last:border-0 tablet:grid-cols-[auto_1fr_7rem_7rem]"
            >
              <span className="grid size-7 place-items-center rounded-full success-surface text-[var(--color-success)]">
                <Check className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">{step}</p>
                <p className="text-xs text-muted-foreground">
                  Step {index + 1} · idempotency verified
                </p>
              </div>
              <Badge
                className={
                  status === "Approved"
                    ? "approval-surface text-[var(--color-warning)]"
                    : "success-surface text-[var(--color-success)]"
                }
              >
                {status}
              </Badge>
              <span className="hidden text-right text-xs text-muted-foreground tablet:block">
                {time}
                <br />
                {duration}
              </span>
            </div>
          ))}
        </div>
      </div>
    </OpsShell>
  );
}
