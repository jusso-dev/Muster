import { AgentDetailView } from "@/components/agents-view";
export default async function AgentTabPage({ params }: { params: Promise<{ tab: string }> }) { const { tab } = await params; return <AgentDetailView tab={tab} />; }
