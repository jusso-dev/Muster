import { describe, expect, it, vi } from "vitest";
import { handleSlackSocketMessage, runSlackSocketMode } from "./slack-socket";

describe("Slack Socket Mode transport", () => {
  it("accepts the initial hello control frame without persisting or acknowledging it", async () => {
    const recordEnvelope = vi.fn();
    const acknowledge = vi.fn();

    await handleSlackSocketMessage(
      JSON.stringify({
        type: "hello",
        connection_info: { app_id: "A-synthetic" },
        num_connections: 1,
      }),
      recordEnvelope,
      acknowledge,
    );

    expect(recordEnvelope).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("persists an envelope before acknowledging it", async () => {
    const order: string[] = [];
    const acknowledge = vi.fn((value: string) => {
      order.push("acknowledge");
      expect(JSON.parse(value)).toEqual({ envelope_id: "env-1" });
    });

    await handleSlackSocketMessage(
      JSON.stringify({
        envelope_id: "env-1",
        payload: {
          type: "event_callback",
          team_id: "T-synthetic",
          event_id: "Ev-synthetic",
        },
      }),
      async (envelope) => {
        order.push("persist");
        expect(envelope.payload.team_id).toBe("T-synthetic");
      },
      acknowledge,
    );

    expect(order).toEqual(["persist", "acknowledge"]);
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("does not acknowledge when durable persistence fails", async () => {
    const acknowledge = vi.fn();

    await expect(
      handleSlackSocketMessage(
        JSON.stringify({
          envelope_id: "env-retry",
          payload: { type: "event_callback", team_id: "T-synthetic" },
        }),
        async () => {
          throw new Error("synthetic database outage");
        },
        acknowledge,
      ),
    ).rejects.toThrow("synthetic database outage");
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("opens a Socket Mode URL and routes envelopes through durable storage", async () => {
    const controller = new AbortController();
    const recorded: string[] = [];
    const onError = vi.fn();
    class SyntheticSocket extends EventTarget {
      readonly sent: string[] = [];

      send(data: string) {
        this.sent.push(data);
        controller.abort();
      }

      close() {
        this.dispatchEvent(new Event("close"));
      }
    }
    const socket = new SyntheticSocket();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        url: "wss://synthetic.slack.invalid/socket",
      }),
    );

    await runSlackSocketMode({
      appToken: "xapp-synthetic",
      signal: controller.signal,
      fetch: fetcher,
      socketFactory: (url) => {
        expect(url).toBe("wss://synthetic.slack.invalid/socket");
        queueMicrotask(() => {
          socket.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                type: "hello",
                connection_info: { app_id: "A-synthetic" },
                num_connections: 1,
              }),
            }),
          );
          socket.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                envelope_id: "env-listener",
                payload: {
                  type: "event_callback",
                  team_id: "T-synthetic",
                },
              }),
            }),
          );
        });
        return socket;
      },
      recordEnvelope: async (envelope) => {
        recorded.push(envelope.envelope_id);
      },
      onError,
    });

    expect(recorded).toEqual(["env-listener"]);
    expect(onError).not.toHaveBeenCalled();
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { envelope_id: "env-listener" },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://slack.com/api/apps.connections.open",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer xapp-synthetic" },
      }),
    );
  });
});
