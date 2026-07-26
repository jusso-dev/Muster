import { InvestigationView } from "@/components/investigation-view";
import { redirect } from "next/navigation";

export default function InvestigationPage() {
  if (process.env.MUSTER_DEMO_MODE !== "true")
    redirect("/rooms/soc-operations");
  return <InvestigationView />;
}
