import { AgentRunView } from "@/components/agent-run-view";

export default async function AgentRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentRunView runId={id} />;
}
