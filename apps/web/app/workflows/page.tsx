import { WorkflowsView } from "@/components/workflows-view";
import { redirect } from "next/navigation";

export default function WorkflowsPage() {
  if (process.env.MUSTER_DEMO_MODE !== "true") redirect("/tasks");
  return <WorkflowsView />;
}
