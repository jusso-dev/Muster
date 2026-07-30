"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMissions } from "@/lib/queries/hooks";
import { queryKeys } from "@/lib/queries/keys";
import { relativeTime } from "@/lib/utils";
import type { MissionSummary } from "@/types/os";

type FormState = {
  name: string;
  description: string;
  scheduleHint: string;
  hermesProfile: string;
  capabilityEnvelope: string;
  status: "active" | "paused" | "cancelled" | "archived";
  killSwitch: boolean;
  changeSummary: string;
};

const emptyForm = (): FormState => ({
  name: "",
  description: "",
  scheduleHint: "",
  hermesProfile: "",
  capabilityEnvelope: "alerts.read, investigations.read",
  status: "active",
  killSwitch: false,
  changeSummary: "",
});

function parseCaps(raw: string) {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function MissionsView() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const missions = useMissions(includeArchived);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MissionSummary | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setShowForm(true);
    setMessage(null);
  }

  function openEdit(mission: MissionSummary) {
    setEditing(mission);
    setForm({
      name: mission.name,
      description: mission.description,
      scheduleHint: mission.scheduleHint ?? "",
      hermesProfile: mission.hermesProfile ?? "",
      capabilityEnvelope: mission.capabilityEnvelope.join(", "),
      status: (mission.status as FormState["status"]) || "active",
      killSwitch: mission.killSwitch,
      changeSummary: "",
    });
    setShowForm(true);
    setMessage(null);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        scheduleHint: form.scheduleHint.trim() || null,
        hermesProfile: form.hermesProfile.trim() || null,
        capabilityEnvelope: parseCaps(form.capabilityEnvelope),
        status: form.status,
        killSwitch: form.killSwitch,
        changeSummary: form.changeSummary.trim() || undefined,
      };
      const response = await fetch(
        editing ? `/api/v1/missions/${editing.id}` : "/api/v1/missions",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as {
        data?: MissionSummary;
        detail?: string;
      };
      if (!response.ok)
        throw new Error(body.detail ?? `Save failed (${response.status})`);
      setMessage(
        editing
          ? `Saved ${body.data?.name} (revision ${body.data?.revision ?? "—"})`
          : `Created ${body.data?.name}`,
      );
      setShowForm(false);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function archive(mission: MissionSummary) {
    if (
      !confirm(
        `Archive mission “${mission.name}”? It stays in history but leaves the active list.`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/missions/${mission.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = (await response.json()) as { detail?: string };
      if (!response.ok)
        throw new Error(body.detail ?? `Archive failed (${response.status})`);
      setMessage(`Archived ${mission.name}`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Archive failed");
    } finally {
      setBusy(false);
    }
  }

  const rows = missions.data ?? [];

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Operate"
        title="Missions"
        description="Create, version, edit, and archive governed missions. Every save writes a revision snapshot. Hermes can still accept runs via MCP."
        actions={
          <Button type="button" onClick={openCreate} disabled={busy}>
            New mission
          </Button>
        }
      />
      <PageBody>
        <div className="mb-4 rounded-md border border-border bg-[var(--color-paper)] p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">How missions work</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>Create or edit a mission here (needs <code>workflows.manage</code>).</li>
            <li>Each save bumps the revision and stores a snapshot for audit.</li>
            <li>Hermes schedules/delegates with <code>muster_accept_mission_run</code>.</li>
            <li>Archive removes it from the active list without hard-delete.</li>
          </ol>
        </div>

        {message ? (
          <p className="mb-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
            {message}
          </p>
        ) : null}

        {showForm ? (
          <div className="mb-4 space-y-3 rounded-md border border-border bg-card p-4">
            <h2 className="font-display text-base font-bold">
              {editing ? `Edit ${editing.name}` : "Create mission"}
            </h2>
            <div className="grid gap-3 tablet:grid-cols-2">
              <label className="block text-xs font-semibold">
                Name (slug)
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={form.name}
                  disabled={Boolean(editing)}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="daily-ops-brief"
                />
              </label>
              <label className="block text-xs font-semibold">
                Status
                <select
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      status: e.target.value as FormState["status"],
                    }))
                  }
                >
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="cancelled">cancelled</option>
                  <option value="archived">archived</option>
                </select>
              </label>
              <label className="block text-xs font-semibold tablet:col-span-2">
                Description
                <textarea
                  className="mt-1 min-h-20 w-full border bg-background px-3 py-2 text-sm"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs font-semibold">
                Schedule hint
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={form.scheduleHint}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, scheduleHint: e.target.value }))
                  }
                  placeholder="cron:0 7 * * * Australia/Sydney"
                />
              </label>
              <label className="block text-xs font-semibold">
                Hermes profile
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={form.hermesProfile}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, hermesProfile: e.target.value }))
                  }
                  placeholder="parker-ops"
                />
              </label>
              <label className="block text-xs font-semibold tablet:col-span-2">
                Capability envelope (comma-separated)
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm font-mono"
                  value={form.capabilityEnvelope}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      capabilityEnvelope: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={form.killSwitch}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, killSwitch: e.target.checked }))
                  }
                />
                Kill switch (block new runs)
              </label>
              <label className="block text-xs font-semibold">
                Change summary (version note)
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={form.changeSummary}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, changeSummary: e.target.value }))
                  }
                  placeholder="Why this change?"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void save()} disabled={busy}>
                {editing ? "Save new revision" : "Create"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived in this view (API still filters server-side by default)
        </label>

        {missions.isError ? (
          <ErrorState
            error={missions.error}
            onRetry={() => void missions.refetch()}
          />
        ) : null}
        {missions.isLoading ? <SkeletonRows rows={6} /> : null}
        {!missions.isLoading && rows.length === 0 ? (
          <EmptyState
            title="No missions yet"
            description="Create the first governed mission with New mission. Hermes can also upsert via MCP if you grant muster_upsert_mission."
            action={
              <Button type="button" onClick={openCreate}>
                Create your first mission
              </Button>
            }
          />
        ) : null}
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Governed missions</caption>
              <thead className="border-b border-border bg-[var(--color-paper)] text-xs uppercase tracking-[0.06em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Rev</th>
                  <th className="px-3 py-2 font-semibold">Capabilities</th>
                  <th className="px-3 py-2 font-semibold">Updated</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((mission) => (
                  <tr key={mission.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/missions/${mission.id}`}
                        className="font-medium hover:underline"
                      >
                        {mission.name}
                      </Link>
                      {mission.killSwitch ? (
                        <Badge className="ml-2 border-[var(--color-error)]/40 bg-[var(--color-error-soft)] text-[var(--color-error)]">
                          Kill switch
                        </Badge>
                      ) : null}
                      {mission.description ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {mission.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className="bg-muted text-muted-foreground">
                        {mission.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      v{mission.revision ?? 1}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs text-muted-foreground">
                        {mission.capabilityEnvelope.slice(0, 3).join(", ") ||
                          "—"}
                        {mission.capabilityEnvelope.length > 3
                          ? ` +${mission.capabilityEnvelope.length - 3}`
                          : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {relativeTime(mission.updatedAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => openEdit(mission)}
                        >
                          Edit
                        </Button>
                        {mission.status !== "archived" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void archive(mission)}
                          >
                            Archive
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </PageBody>
    </CompanyOsShell>
  );
}
