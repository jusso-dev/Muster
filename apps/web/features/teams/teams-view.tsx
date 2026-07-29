"use client";

import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { PageHeader } from "@/components/page-header";

/**
 * Teams API is not first-class yet. Show empty — never inject fixture workforce.
 */
export function TeamsView() {
  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Workforce"
        title="Teams"
        description="Organisation-owned team structure for humans and agents. No demo roster is seeded."
      />
      <div className="mx-auto max-w-3xl p-4 tablet:p-5">
        <EmptyState
          title="No teams configured"
          description="Team membership is not exposed by a governed API yet. When it ships, this view loads organisation-scoped rows only — never hardcoded SOC/IR sample teams."
        />
      </div>
    </CompanyOsShell>
  );
}
