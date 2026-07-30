"use client";

import { useMemo } from "react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  useAgentManifests,
  useDirectory,
  type AgentManifest,
  type DirectoryEntry,
} from "@/lib/queries/hooks";

type CapabilityRow = {
  capability: string;
  holders: string[];
  packs: string[];
};

/**
 * Live capability inventory derived from the governed directory (who holds
 * what) and published harness manifests (what each pack requires).
 * Installation and assignment stay server-controlled; nothing is granted here.
 */
function buildInventory(
  directory: DirectoryEntry[],
  manifests: AgentManifest[],
): CapabilityRow[] {
  const rows = new Map<string, CapabilityRow>();
  const row = (capability: string) => {
    const existing = rows.get(capability);
    if (existing) return existing;
    const created: CapabilityRow = { capability, holders: [], packs: [] };
    rows.set(capability, created);
    return created;
  };

  for (const entry of directory) {
    for (const capability of entry.capabilityAssignments ?? []) {
      row(capability).holders.push(entry.displayName);
    }
  }
  for (const manifest of manifests) {
    for (const capability of manifest.requiredCapabilities ?? []) {
      row(capability).packs.push(manifest.name);
    }
  }

  return [...rows.values()]
    .map((entry) => ({
      capability: entry.capability,
      holders: [...new Set(entry.holders)].sort(),
      packs: [...new Set(entry.packs)].sort(),
    }))
    .sort((left, right) => left.capability.localeCompare(right.capability));
}

function PackCard({ manifest }: { manifest: AgentManifest }) {
  return (
    <article className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{manifest.name}</h3>
          <p className="font-mono text-xs text-muted-foreground">
            {manifest.version}
          </p>
        </div>
        <Badge
          className={
            manifest.lifecycle === "active"
              ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
              : "bg-muted text-muted-foreground"
          }
        >
          {manifest.lifecycle}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {manifest.description}
      </p>
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Approval behaviour</dt>
          <dd>{manifest.approvalBehavior}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Invocation modes</dt>
          <dd className="mt-0.5 flex flex-wrap gap-1">
            {(manifest.invocationModes ?? []).map((mode) => (
              <Badge key={mode} className="bg-muted text-muted-foreground">
                {mode}
              </Badge>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Required capabilities</dt>
          <dd className="mt-0.5 flex flex-wrap gap-1">
            {(manifest.requiredCapabilities ?? []).map((capability) => (
              <Badge
                key={capability}
                className="bg-muted font-mono text-muted-foreground"
              >
                {capability}
              </Badge>
            ))}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function CapabilitiesView() {
  const manifests = useAgentManifests();
  const directory = useDirectory();
  const packs = manifests.data ?? [];
  const inventory = useMemo(
    () => buildInventory(directory.data ?? [], packs),
    [directory.data, packs],
  );
  const loading = manifests.isLoading || directory.isLoading;

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Workforce"
        title="Capabilities"
        description="Published capability packs and the live grant inventory. Installation and agent assignment stay server-controlled."
      />
      <PageBody>
        {manifests.isError && directory.isError ? (
          <ErrorState
            error={manifests.error}
            onRetry={() => {
              void manifests.refetch();
              void directory.refetch();
            }}
          />
        ) : null}

        {loading && packs.length === 0 && inventory.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Published packs</h2>
          {packs.length === 0 && !loading ? (
            <EmptyState
              title="No capability packs published"
              description="The agent harness returned no manifests for this organisation. Packs under skills/ are backend artefacts until the harness publishes them."
            />
          ) : (
            <div className="grid gap-3 tablet:grid-cols-2 wide:grid-cols-3">
              {packs.map((manifest) => (
                <PackCard key={manifest.key} manifest={manifest} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Grant inventory</h2>
          {inventory.length === 0 && !loading ? (
            <EmptyState
              title="No capability grants visible"
              description="No organisation-scoped capability assignment is readable with this session. Nothing is silently granted from the UI."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full min-w-[40rem] text-left text-xs">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Capability</th>
                    <th className="px-3 py-2 font-medium">Required by packs</th>
                    <th className="px-3 py-2 font-medium">Held by</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((row) => (
                    <tr
                      key={row.capability}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-3 py-2 font-mono">{row.capability}</td>
                      <td className="px-3 py-2">
                        {row.packs.length > 0 ? row.packs.join(", ") : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.holders.length > 0
                          ? `${row.holders.length}: ${row.holders.join(", ")}`
                          : "nobody"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-xs text-muted-foreground">
          Capability grants are enforced server-side on every request. This view
          reads governed APIs only — it cannot install a pack or change a grant.
        </p>
      </PageBody>
    </CompanyOsShell>
  );
}
