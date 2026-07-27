import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CheckpointScopeViolationError, threadIdFor } from "../identity.ts";
import {
  MusterPostgresCheckpointSaver,
  fromBase64Envelope,
  toBase64Envelope,
  type Base64Envelope,
} from "./postgres.ts";

const organisationA = "019fa210-0000-7000-8000-0000000000a0";
const organisationB = "019fa210-0000-7000-8000-0000000000b0";
const agentId = "019fa210-0000-7000-8000-0000000000c0";
const conversationId = "conversation-1";
const runId = "019fa210-0000-7000-8000-0000000000d0";

/**
 * A `db` that throws the moment any method on it is invoked. Used to prove
 * that the organisation-scope check runs *before* any query is issued: if
 * the saver ever touched the database on a scope violation path, the
 * rejection would surface this error instead of `CheckpointScopeViolationError`.
 */
function unreachableDb() {
  const fail = (): never => {
    throw new Error("the database must not be queried before the tenant scope check");
  };
  return new Proxy(
    {},
    {
      get() {
        return fail;
      },
    },
  ) as unknown;
}

function saverWithUnreachableDb(
  organisationId: string,
): MusterPostgresCheckpointSaver {
  return new MusterPostgresCheckpointSaver({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: unreachableDb() as any,
    organisationId,
    agentId,
    conversationId,
    runId,
    graphVersion: "graph-v1",
  });
}

describe("base64 envelope round trip", () => {
  it("recovers the original bytes for arbitrary payloads", () => {
    const original = new TextEncoder().encode(
      JSON.stringify({ hello: "world", n: 42, nested: [1, 2, 3] }),
    );

    const envelope = toBase64Envelope(original);
    expect(envelope.encoding).toBe("base64");
    expect(typeof envelope.data).toBe("string");

    const recovered = fromBase64Envelope(envelope);
    expect(Array.from(recovered)).toEqual(Array.from(original));
  });

  it("round trips empty and binary-unsafe-looking payloads", () => {
    const original = new Uint8Array([0, 255, 1, 254, 128, 0, 0]);
    const recovered = fromBase64Envelope(toBase64Envelope(original));
    expect(Array.from(recovered)).toEqual(Array.from(original));
  });

  it("rejects a value that is not a base64 envelope", () => {
    expect(() => fromBase64Envelope({ encoding: "utf8", data: "x" })).toThrow(
      /Invalid checkpoint envelope/,
    );
    expect(() => fromBase64Envelope(null)).toThrow(/Invalid checkpoint envelope/);
    expect(() => fromBase64Envelope("not an envelope")).toThrow(
      /Invalid checkpoint envelope/,
    );
  });

  it("is a plain JSON-serialisable object, matching the jsonb column contract", () => {
    const envelope: Base64Envelope = toBase64Envelope(new Uint8Array([1, 2, 3]));
    const roundTripped = JSON.parse(JSON.stringify(envelope)) as Base64Envelope;
    expect(fromBase64Envelope(roundTripped)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("tenant scope is enforced before any query", () => {
  const foreignThreadId = threadIdFor({
    organisationId: organisationB,
    agentId,
    conversationId,
  });
  const config = { configurable: { thread_id: foreignThreadId } };

  it("getTuple rejects a foreign-organisation thread id without querying the database", async () => {
    const saver = saverWithUnreachableDb(organisationA);
    await expect(saver.getTuple(config)).rejects.toThrow(
      CheckpointScopeViolationError,
    );
  });

  it("list rejects a foreign-organisation thread id without querying the database", async () => {
    const saver = saverWithUnreachableDb(organisationA);
    const iterator = saver.list(config);
    await expect(iterator.next()).rejects.toThrow(CheckpointScopeViolationError);
  });

  it("put rejects a foreign-organisation thread id without querying the database", async () => {
    const saver = saverWithUnreachableDb(organisationA);
    await expect(
      saver.put(
        config,
        {
          v: 4,
          id: "019fa210-0000-7000-8000-0000000000e0",
          ts: new Date().toISOString(),
          channel_values: {},
          channel_versions: {},
          versions_seen: {},
        },
        { source: "input", step: -1, parents: {} },
      ),
    ).rejects.toThrow(CheckpointScopeViolationError);
  });

  it("putWrites rejects a foreign-organisation thread id without querying the database", async () => {
    const saver = saverWithUnreachableDb(organisationA);
    await expect(
      saver.putWrites(config, [["channel", "value"]], "task-1"),
    ).rejects.toThrow(CheckpointScopeViolationError);
  });

  it("deleteThread rejects a foreign-organisation thread id without querying the database", async () => {
    const saver = saverWithUnreachableDb(organisationA);
    await expect(saver.deleteThread(foreignThreadId)).rejects.toThrow(
      CheckpointScopeViolationError,
    );
  });

  it("rejects a thread id that is not a Muster tenant thread at all", async () => {
    const saver = saverWithUnreachableDb(organisationA);
    await expect(
      saver.getTuple({ configurable: { thread_id: "not-a-muster-thread" } }),
    ).rejects.toThrow(CheckpointScopeViolationError);
  });
});

describe("constructor requires a valid tenant scope", () => {
  it("throws when organisationId is not a uuid", () => {
    expect(
      () =>
        new MusterPostgresCheckpointSaver({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          db: unreachableDb() as any,
          organisationId: "not-a-uuid",
          agentId,
          conversationId,
          runId,
          graphVersion: "graph-v1",
        }),
    ).toThrow();
  });

  it("throws when conversationId is empty", () => {
    expect(
      () =>
        new MusterPostgresCheckpointSaver({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          db: unreachableDb() as any,
          organisationId: organisationA,
          agentId,
          conversationId: "",
          runId,
          graphVersion: "graph-v1",
        }),
    ).toThrow();
  });

  it("exposes the canonical thread id for its own scope via threadIdFor", () => {
    const saver = saverWithUnreachableDb(organisationA);
    expect(saver.threadId).toBe(
      threadIdFor({ organisationId: organisationA, agentId, conversationId }),
    );
  });
});

describe("every .where( call is organisation-scoped", () => {
  it("routes every .where( call in postgres.ts through organisationScopedWhere(", () => {
    const sourcePath = fileURLToPath(new URL("./postgres.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");

    const allWhereCalls = source.match(/\.where\(/g) ?? [];
    const scopedWhereCalls =
      source.match(/\.where\(\s*organisationScopedWhere\(/g) ?? [];

    expect(allWhereCalls.length).toBeGreaterThan(0);
    expect(scopedWhereCalls.length).toBe(allWhereCalls.length);
  });

  it("anchors every organisationScopedWhere( call site on an organisationId column", () => {
    const sourcePath = fileURLToPath(new URL("./postgres.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");

    // The function definition takes `organisationColumn: TColumn` as its
    // first parameter (not a literal `schema....organisationId` reference),
    // so it never matches this pattern; only call sites can.
    const callSitesAnchoredOnOrganisationId =
      source.match(
        /organisationScopedWhere\(\s*schema\.agentRuntimeCheckpoint(?:s|Writes)\.organisationId,/g,
      ) ?? [];
    const allCallSites = source.match(/[^\w]organisationScopedWhere\(/g) ?? [];

    expect(allCallSites.length).toBeGreaterThan(0);
    expect(callSitesAnchoredOnOrganisationId.length).toBe(allCallSites.length);
  });
});
