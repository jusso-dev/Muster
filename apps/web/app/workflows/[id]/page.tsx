import { WorkflowEditorView } from "@/components/workflows-view";
import { redirect } from "next/navigation";

export default function WorkflowPage() {
  if (process.env.MUSTER_DEMO_MODE !== "true") redirect("/tasks");
  return <WorkflowEditorView />;
}
