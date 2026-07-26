import { WorkflowRunView } from "@/components/workflows-view";
import { redirect } from "next/navigation";

export default function WorkflowRunPage() {
  if (process.env.MUSTER_DEMO_MODE !== "true") redirect("/tasks");
  return <WorkflowRunView />;
}
