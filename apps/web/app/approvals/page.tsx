import { Suspense } from "react";
import { GovernanceInbox } from "@/features/approvals/governance-inbox";

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading approvals…</div>}>
      <GovernanceInbox />
    </Suspense>
  );
}
