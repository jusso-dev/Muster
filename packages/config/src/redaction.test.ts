import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CIRCULAR_MARKER,
  REDACTION_MARKER,
  TRUNCATION_MARKER,
  UNSERIALISABLE_MARKER,
  jsonLog,
  redactForObservation,
  redactObservationText,
} from "./index.ts";

const canary = "synthetic-secret-canary-31";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redactForObservation", () => {
  it("redacts secret keys, headers, environment pairs, maps, and URL credentials", () => {
    const result = redactForObservation({
      apiKey: canary,
      nested: {
        CLIENT_SECRET: canary,
        privateKeyPem: canary,
        headers: {
          Authorization: `Bearer ${canary}`,
          "set-cookie": `session=${canary}`,
          "content-type": "application/json",
        },
      },
      env: [
        { name: "DATABASE_PASSWORD", value: canary },
        ["SERVICE_TOKEN", canary],
      ],
      map: new Map([
        ["refresh_token", canary],
        ["ordinary", "kept"],
      ]),
      endpoint: `https://synthetic-user:${canary}@example.test/path`,
    });

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(canary);
    expect(serialised).toContain(REDACTION_MARKER);
    expect(serialised).toContain("application/json");
    expect(serialised).toContain("kept");
    expect(serialised).toContain("example.test/path");
  });

  it("redacts private keys, assignments, authorization, cookies, and token-shaped strings", () => {
    const text = [
      `password=${canary}`,
      `client_secret="${canary} with synthetic spacing"`,
      `Authorization: Bearer ${canary}`,
      `Cookie: session=${canary}`,
      "-----BEGIN PRIVATE KEY-----",
      canary,
      "-----END PRIVATE KEY-----",
      "ghp_1234567890abcdefghijklmnop",
    ].join("\n");

    const result = redactObservationText(text);
    expect(result).not.toContain(canary);
    expect(result).not.toContain("ghp_");
    expect(result).toContain(REDACTION_MARKER);
  });

  it("does not leak an oversized private key prefix", () => {
    const result = redactObservationText(
      `-----BEGIN PRIVATE KEY-----\n${canary.repeat(20)}`,
      { maxStringLength: 64 },
    );

    expect(result).not.toContain(canary);
    expect(result).toContain(REDACTION_MARKER);
    expect(result).toContain(TRUNCATION_MARKER);
  });

  it("bounds cycles, depth, item count, strings, and unserialisable values", () => {
    const cyclic: Record<string, unknown> = { safe: "kept" };
    cyclic.self = cyclic;
    const result = redactForObservation({
      cyclic,
      deep: { one: { two: { three: "hidden" } } },
      items: ["a", "b", "c"],
      long: "abcdefgh",
      unsupported: Symbol("synthetic"),
    }, {
      maxDepth: 3,
      maxItems: 10,
      maxStringLength: 4,
    });
    const serialised = JSON.stringify(result);
    const boundedItems = JSON.stringify(redactForObservation(["a", "b", "c"], { maxItems: 2 }));

    expect(serialised).toContain(CIRCULAR_MARKER);
    expect(serialised).toContain(TRUNCATION_MARKER);
    expect(serialised).toContain(UNSERIALISABLE_MARKER);
    expect(boundedItems).toContain(TRUNCATION_MARKER);
    expect(serialised).not.toContain("hidden");
    expect(serialised).not.toContain("abcdefgh");
  });

  it("preserves useful ordinary evidence and run metadata", () => {
    expect(redactForObservation({
      evidence: { summary: "synthetic deployment succeeded", count: 3 },
      tokenUsage: { input: 21, output: 8 },
      outputHash: "sha256:synthetic",
      status: "succeeded",
    })).toEqual({
      evidence: { summary: "synthetic deployment succeeded", count: 3 },
      tokenUsage: { input: 21, output: 8 },
      outputHash: "sha256:synthetic",
      status: "succeeded",
    });
  });
});

describe("jsonLog", () => {
  it("scrubs nested structured log fields without discarding useful evidence", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    jsonLog("error", `connector failed Authorization: Bearer ${canary}`, {
      diagnostics: {
        client_secret: canary,
        url: `postgresql://muster:${canary}@database.test/muster`,
      },
      evidence: { result: "synthetic timeout", attempt: 2 },
    });

    const output = String(write.mock.calls[0]?.[0]);
    expect(output).not.toContain(canary);
    const entry = JSON.parse(output) as Record<string, unknown>;
    expect(entry.message).toContain(REDACTION_MARKER);
    expect(entry.evidence).toEqual({ result: "synthetic timeout", attempt: 2 });
  });
});
