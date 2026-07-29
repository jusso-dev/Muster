import { MissionDetailView } from "@/features/missions/mission-detail-view";

export default async function MissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MissionDetailView missionId={id} />;
}
