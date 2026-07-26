"use client";

import { useEffect, useState } from "react";
import { AgentHandoffCard } from "@/components/agent-handoff-card";
import type { AgentHandoff } from "@/lib/agent-handoff-domain";

export function RoomAgentHandoffs({
  roomId,
  roomResolved,
}: {
  roomId: string;
  roomResolved: boolean;
}) {
  const [handoffs, setHandoffs] = useState<AgentHandoff[]>([]);

  useEffect(() => {
    setHandoffs([]);
    if (!roomResolved) return;
    const controller = new AbortController();
    const refresh = async () => {
      const response = await fetch(
        `/api/v1/rooms/${roomId}/agent-handoffs`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        data: AgentHandoff[];
      };
      setHandoffs(payload.data);
    };
    void refresh().catch(() => undefined);
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      5_000,
    );
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [roomId, roomResolved]);

  if (handoffs.length === 0) return null;
  return (
    <section
      aria-label="Completed agent handoffs"
      data-testid="room-agent-handoffs"
      className="mx-4 my-3 space-y-2"
    >
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Completed agent handoffs
      </h2>
      {handoffs.map((handoff) => (
        <AgentHandoffCard key={handoff.runId} handoff={handoff} compact />
      ))}
    </section>
  );
}
