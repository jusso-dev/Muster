"use client";

import { useState } from "react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { FIXTURE_CAPABILITY_PACKS } from "@/lib/api/fixtures/capabilities";
import type { CapabilityPack } from "@/types/os";

export function CapabilitiesView() {
  const packs = FIXTURE_CAPABILITY_PACKS;
  const [selected, setSelected] = useState<CapabilityPack | null>(packs[0] ?? null);

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Governance"
        title="Capabilities"
        description="Governed capability packs. Installation and agent assignment remain separately controlled on the server."
      />
      <div className="mx-auto grid max-w-6xl gap-4 p-4 tablet:p-5 xl:grid-cols-[1fr_22rem]">
        <div className="mb-0 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-xs xl:col-span-2">
          Catalogue seeded from `skills/muster-*` packs as fixtures. Enabling a
          pack here does not grant tools — backend assignment required.
        </div>
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Capability catalogue</caption>
            <thead className="border-b border-border bg-[var(--color-paper)] text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Approval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {packs.map((pack) => (
                <tr
                  key={pack.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelected(pack)}
                >
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{pack.name}</p>
                    <p className="text-xs text-muted-foreground">
                      v{pack.version} · {pack.source}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{pack.category}</td>
                  <td className="px-3 py-2.5">
                    <Badge className="bg-muted text-muted-foreground">
                      {pack.installed ? "installed" : "available"}
                      {pack.enabled ? " · enabled" : " · disabled"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {pack.approvalRequired ? "Required" : "Not required"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="rounded-md border border-border bg-card p-4">
          {!selected ? (
            <p className="text-xs text-muted-foreground">Select a capability.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <h2 className="font-semibold">{selected.name}</h2>
              <p className="text-xs text-muted-foreground">
                {selected.description}
              </p>
              <dl className="space-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Classification</dt>
                  <dd>{selected.dataClassification}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Required connectors</dt>
                  <dd className="font-mono text-xs">
                    {selected.requiredConnectors.join(", ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Allowed agent roles</dt>
                  <dd className="font-mono text-xs">
                    {selected.allowedAgentRoles.join(", ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Validation</dt>
                  <dd>{selected.validationStatus}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Origin</dt>
                  <dd>
                    <Badge className="bg-muted text-muted-foreground">
                      {selected.origin}
                    </Badge>
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Capability assignment and tool grants are not editable from this
                UI in foundation pass.
              </p>
            </div>
          )}
        </aside>
      </div>
    </CompanyOsShell>
  );
}
