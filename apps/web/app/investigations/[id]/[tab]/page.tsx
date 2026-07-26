import { InvestigationView } from "@/components/investigation-view";
import { redirect } from "next/navigation";

export default async function InvestigationTabPage({ params }: { params: Promise<{ tab: string }> }) {
  if (process.env.MUSTER_DEMO_MODE !== "true")
    redirect("/rooms/soc-operations");
  const { tab } = await params;
  return <InvestigationView tab={tab} />;
}
