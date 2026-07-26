import { AgentDetailView } from "@/components/agents-view";
export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentDetailView agentId={id} />;
}
