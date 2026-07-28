export type SlackSocketEnvelope = {
  envelope_id: string;
  payload: Record<string, unknown>;
};

/** Slack asked the client to reconnect; finish the current socket cleanly. */
export class SlackSocketDisconnectError extends Error {
  override readonly name = "SlackSocketDisconnectError";
  constructor(readonly reason?: string) {
    super(
      reason
        ? `Slack Socket Mode disconnect requested: ${reason}`
        : "Slack Socket Mode disconnect requested",
    );
  }
}

type SlackSocket = {
  addEventListener(
    type: "message" | "close" | "error",
    listener: (event: Event | MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message" | "close" | "error",
    listener: (event: Event | MessageEvent) => void,
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type SocketModeOptions = {
  appToken: string;
  signal: AbortSignal;
  recordEnvelope: (envelope: SlackSocketEnvelope) => Promise<unknown>;
  fetch?: typeof globalThis.fetch;
  socketFactory?: (url: string) => SlackSocket;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown) => void;
  maximumReconnectDelayMs?: number;
};

const socketMetrics = {
  connections: 0,
  reconnects: 0,
  envelopeFailures: 0,
};

export function slackSocketMetrics() {
  return { ...socketMetrics };
}

function decodeSocketData(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return "";
}

/**
 * Parse a Socket Mode frame.
 * - `hello` / unknown control frames → null (ignore)
 * - `disconnect` → throw SlackSocketDisconnectError so the outer loop reconnects
 * - event envelopes → { envelope_id, payload }
 */
export function parseSocketMessage(
  data: unknown,
): SlackSocketEnvelope | null {
  const text = decodeSocketData(data).trim();
  if (!text) return null;
  let parsed: {
    type?: unknown;
    reason?: unknown;
    envelope_id?: unknown;
    payload?: unknown;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // Non-JSON frames (browser pings, garbage) — ignore rather than crash loop.
    return null;
  }
  if (parsed.type === "hello") return null;
  if (parsed.type === "disconnect") {
    throw new SlackSocketDisconnectError(
      typeof parsed.reason === "string" ? parsed.reason : undefined,
    );
  }
  if (
    typeof parsed.envelope_id !== "string" ||
    !parsed.envelope_id.trim() ||
    !parsed.payload ||
    typeof parsed.payload !== "object" ||
    Array.isArray(parsed.payload)
  ) {
    // Slack also sends non-event control frames without envelope_id.
    // Throwing here used to tear the connection into a reconnect storm.
    return null;
  }
  return {
    envelope_id: parsed.envelope_id,
    payload: parsed.payload as Record<string, unknown>,
  };
}

export async function handleSlackSocketMessage(
  data: unknown,
  recordEnvelope: (envelope: SlackSocketEnvelope) => Promise<unknown>,
  acknowledge: (acknowledgement: string) => void,
) {
  const envelope = parseSocketMessage(data);
  if (!envelope) return;
  await recordEnvelope(envelope);
  acknowledge(JSON.stringify({ envelope_id: envelope.envelope_id }));
}

async function defaultSleep(milliseconds: number, signal: AbortSignal) {
  await new Promise<void>((resolve) => {
    const aborted = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      resolve();
    };
    const timer = setTimeout(aborted, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function openConnectionUrl(
  appToken: string,
  fetcher: typeof globalThis.fetch,
) {
  const response = await fetcher(
    "https://slack.com/api/apps.connections.open",
    {
      method: "POST",
      headers: { authorization: `Bearer ${appToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    url?: string;
    error?: string;
  };
  if (!response.ok || !payload.ok || !payload.url)
    throw new Error(
      `Slack apps.connections.open failed: ${payload.error ?? response.status}`,
    );
  return payload.url;
}

async function consumeConnection(
  socket: SlackSocket,
  signal: AbortSignal,
  recordEnvelope: SocketModeOptions["recordEnvelope"],
  onError: NonNullable<SocketModeOptions["onError"]>,
) {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", finish);
      socket.removeEventListener("error", onSocketError);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onMessage = (event: Event | MessageEvent) => {
      const data = event instanceof MessageEvent ? event.data : undefined;
      void handleSlackSocketMessage(data, recordEnvelope, (acknowledgement) =>
        socket.send(acknowledgement),
      ).catch((error) => {
        if (error instanceof SlackSocketDisconnectError) {
          // Server requested reconnect — close cleanly so the outer loop opens a new URL.
          socket.close(1000, "Slack Socket Mode disconnect");
          finish();
          return;
        }
        socketMetrics.envelopeFailures += 1;
        onError(error);
      });
    };
    const onSocketError = (event: Event | MessageEvent) => {
      const detail =
        event instanceof ErrorEvent && event.message
          ? event.message
          : event instanceof MessageEvent && typeof event.data === "string"
            ? event.data
            : "Socket Mode transport error";
      onError(new Error(detail));
      socket.close(1011, "Slack Socket Mode connection failed");
      finish();
    };
    const onAbort = () => {
      socket.close(1000, "Muster worker shutting down");
      finish();
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", finish);
    socket.addEventListener("error", onSocketError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function runSlackSocketMode(options: SocketModeOptions) {
  if (!options.appToken.startsWith("xapp-"))
    throw new Error("Slack Socket Mode requires an xapp app token");
  const fetcher = options.fetch ?? globalThis.fetch;
  const socketFactory =
    options.socketFactory ?? ((url: string) => new WebSocket(url));
  const sleep = options.sleep ?? defaultSleep;
  const onError = options.onError ?? (() => undefined);
  const maximumReconnectDelayMs = options.maximumReconnectDelayMs ?? 30_000;
  let reconnectAttempt = 0;

  while (!options.signal.aborted) {
    try {
      const url = await openConnectionUrl(options.appToken, fetcher);
      if (options.signal.aborted) return;
      socketMetrics.connections += 1;
      await consumeConnection(
        socketFactory(url),
        options.signal,
        options.recordEnvelope,
        onError,
      );
      reconnectAttempt = 0;
    } catch (error) {
      if (options.signal.aborted) return;
      onError(error);
    }
    if (options.signal.aborted) return;
    reconnectAttempt += 1;
    socketMetrics.reconnects += 1;
    const delay = Math.min(
      maximumReconnectDelayMs,
      1_000 * 2 ** Math.min(reconnectAttempt - 1, 5),
    );
    await sleep(delay, options.signal);
  }
}
