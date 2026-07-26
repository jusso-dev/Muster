import { InvestigationView } from "@/components/investigation-view";

export default async function InvestigationTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  return <InvestigationView tab={tab} />;
}
