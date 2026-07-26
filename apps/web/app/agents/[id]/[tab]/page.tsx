import { AgentDetailView } from "@/components/agents-view";
export default async function AgentTabPage({
  params,
}: {
  params: Promise<{ id: string; tab: string }>;
}) {
  const { id, tab } = await params;
  return <AgentDetailView agentId={id} tab={tab} />;
}
