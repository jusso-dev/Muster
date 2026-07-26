import { z } from "zod";

export class MusterApiError extends Error {
  constructor(readonly status: number, readonly problem: unknown) {
    super(`Muster API returned HTTP ${status}`);
  }
}

export function createMusterClient(baseUrl = "/api/v1") {
  async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      credentials: "include",
      ...init,
      headers: { accept: "application/json", "content-type": "application/json", ...init?.headers },
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new MusterApiError(response.status, body);
    return schema.parse(body);
  }
  return {
    rooms: () => request("/rooms", z.object({ data: z.array(z.unknown()), traceId: z.string() })),
    alerts: () => request("/alerts", z.object({ data: z.array(z.unknown()), traceId: z.string() })),
    search: (query: string) => request(`/search?q=${encodeURIComponent(query)}`, z.object({ data: z.array(z.unknown()), traceId: z.string() })),
    postMessage: (roomId: string, body: unknown) => request(`/rooms/${encodeURIComponent(roomId)}/messages`, z.object({ data: z.unknown(), traceId: z.string() }), { method: "POST", body: JSON.stringify(body) }),
  };
}
