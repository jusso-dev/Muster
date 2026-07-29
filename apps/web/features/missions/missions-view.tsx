"use client";

import Link from "next/link";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { useMissions } from "@/lib/queries/hooks";
import { relativeTime } from "@/lib/utils";

export function MissionsView() {
  const missions = useMissions();

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Execution"
        title="Missions"
        description="Governed mission definitions and run history. Start/cancel remain policy-gated on the server."
      />
      <div className="mx-auto max-w-6xl p-4 tablet:p-5">
        {missions.isError ? (
          <ErrorState
            error={missions.error}
            onRetry={() => void missions.refetch()}
          />
        ) : null}
        {missions.isLoading ? <SkeletonRows rows={6} /> : null}
        {missions.data && missions.data.length === 0 ? (
          <EmptyState
            title="No missions defined"
            description="Mission definitions are created via governed MCP tools or bootstrap. They appear here once present."
          />
        ) : null}
        {missions.data && missions.data.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Governed missions</caption>
              <thead className="border-b border-border bg-[var(--color-paper)] text-xs uppercase tracking-[0.06em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Capabilities</th>
                  <th className="px-3 py-2 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {missions.data.map((mission) => (
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
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs text-muted-foreground">
                        {mission.capabilityEnvelope.slice(0, 3).join(", ") || "—"}
                        {mission.capabilityEnvelope.length > 3
                          ? ` +${mission.capabilityEnvelope.length - 3}`
                          : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {relativeTime(mission.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </CompanyOsShell>
  );
}
