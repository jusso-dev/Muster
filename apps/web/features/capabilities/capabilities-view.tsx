"use client";

import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { PageHeader } from "@/components/page-header";

/**
 * Capability catalogue UI waits on install/assignment APIs.
 * Skill packs under skills/ remain backend artefacts — not fake UI rows.
 */
export function CapabilitiesView() {
  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Governance"
        title="Capabilities"
        description="Governed capability packs. Installation and agent assignment stay server-controlled. No fixture catalogue is shown as live data."
      />
      <div className="mx-auto max-w-3xl p-4 tablet:p-5">
        <EmptyState
          title="No installed capabilities listed"
          description="Packs such as SOC operations and threat hunting live under skills/ and agent readiness. A first-class capability inventory API is required before this view lists installs. Nothing is silently granted from the UI."
        />
      </div>
    </CompanyOsShell>
  );
}
