import { ApprovalView } from "@/components/approval-view";
import { redirect } from "next/navigation";

export default function ApprovalsPage() {
  if (process.env.MUSTER_DEMO_MODE !== "true") redirect("/tasks");
  return <ApprovalView />;
}
