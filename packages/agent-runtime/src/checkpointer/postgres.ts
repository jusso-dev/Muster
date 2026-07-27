import { and, desc, eq, lt } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import { count } from "drizzle-orm";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId,
} from "@langchain/langgraph-checkpoint";
import type {
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointTuple,
  PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { database, schema } from "@muster/database";
import {
  assertThreadBelongsToOrganisation,
  runtimeScope,
  threadIdFor,
  type RuntimeScope,
} from "../identity.ts";

type Db = ReturnType<typeof database>;

type CheckpointRow = typeof schema.agentRuntimeCheckpoints.$inferSelect;
type CheckpointWriteRow = typeof schema.agentRuntimeCheckpointWrites.$inferSelect;

/**
 * Every value that passes through `serde.dumpsTyped` becomes an opaque
 * `Uint8Array`. The checkpoint and write columns are `jsonb`, so the bytes
 * are base64-encoded into a small JSON envelope rather than stored raw. This
 * is symmetric with {@link fromBase64Envelope} and covered by a round-trip
 * test.
 */
export interface Base64Envelope {
  encoding: "base64";
  data: string;
}

export function toBase64Envelope(bytes: Uint8Array): Base64Envelope {
  return { encoding: "base64", data: Buffer.from(bytes).toString("base64") };
}

export function fromBase64Envelope(value: unknown): Uint8Array {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { encoding?: unknown }).encoding === "base64" &&
    typeof (value as { data?: unknown }).data === "string"
  ) {
    return new Uint8Array(
      Buffer.from((value as { data: string }).data, "base64"),
    );
  }
  throw new Error(
    'Invalid checkpoint envelope: expected { encoding: "base64", data: string }.',
  );
}

/**
 * Every predicate in this file is built through this helper so that no query
 * path can omit the organisation scope. `postgres.test.ts` asserts (via a
 * source-level regex check) that every `where` clause in this module is
 * built through it, and not through anything else.
 */
export function organisationScopedWhere<TColumn extends AnyColumn>(
  organisationColumn: TColumn,
  organisationId: string,
  ...rest: (SQL | undefined)[]
): SQL {
  const combined = and(eq(organisationColumn, organisationId), ...rest);
  if (!combined) {
    throw new Error(
      "organisationScopedWhere: and() unexpectedly returned undefined despite a defined organisation predicate.",
    );
  }
  return combined;
}

function asCheckpointMetadata(value: unknown): CheckpointMetadata {
  if (typeof value !== "object" || value === null) {
    throw new Error(
      "Stored checkpoint metadata is not an object; the checkpoint row is corrupt.",
    );
  }
  return value as CheckpointMetadata;
}

function readConfigurable(config: RunnableConfig): Record<string, unknown> {
  return (config.configurable ?? {}) as Record<string, unknown>;
}

function configurableThreadId(config: RunnableConfig): string {
  const value = readConfigurable(config)["thread_id"];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      'Failed to resolve checkpoint. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.',
    );
  }
  return value;
}

function configurableCheckpointNamespace(config: RunnableConfig): string {
  const value = readConfigurable(config)["checkpoint_ns"];
  return typeof value === "string" ? value : "";
}

/**
 * `getCheckpointId` returns `""` when the config carries no checkpoint id;
 * callers of this helper get `undefined` instead so "absent" is unambiguous
 * from an explicit empty string (which is never a valid checkpoint id).
 */
function optionalCheckpointId(config: RunnableConfig): string | undefined {
  const id = getCheckpointId(config);
  return id.length > 0 ? id : undefined;
}

export interface MusterPostgresCheckpointSaverOptions extends RuntimeScope {
  db: Db;
  graphVersion: string;
}

/**
 * Persists LangGraph checkpoints for exactly one tenant scope. There is no
 * constructor path that omits `organisationId`, and every method re-checks
 * the incoming `thread_id` against it before touching the database — the
 * checkpointer is not merely conventionally tenant-scoped, it fails closed.
 */
export class MusterPostgresCheckpointSaver extends BaseCheckpointSaver {
  private readonly db: Db;
  readonly organisationId: string;
  readonly agentId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly graphVersion: string;

  constructor(options: MusterPostgresCheckpointSaverOptions) {
    super();
    // `runtimeScope` (zod) fails closed on a malformed or empty scope, so
    // this saver cannot be constructed for a non-tenant, even if a caller
    // bypasses the TypeScript types.
    const scope: RuntimeScope = runtimeScope({
      organisationId: options.organisationId,
      agentId: options.agentId,
      conversationId: options.conversationId,
      runId: options.runId,
    });
    this.db = options.db;
    this.organisationId = scope.organisationId;
    this.agentId = scope.agentId;
    this.conversationId = scope.conversationId;
    this.runId = scope.runId;
    this.graphVersion = options.graphVersion;
  }

  /** The canonical thread id LangGraph should use for this saver's scope. */
  get threadId(): string {
    return threadIdFor(this);
  }

  private async deserialiseCheckpoint(row: CheckpointRow): Promise<Checkpoint> {
    const bytes = fromBase64Envelope(row.checkpoint);
    const value = await this.serde.loadsTyped(row.type ?? "json", bytes);
    return value as Checkpoint;
  }

  private async selectPendingWrites(
    threadId: string,
    checkpointNamespace: string,
    checkpointId: string,
  ) {
    const rows = await this.db
      .select()
      .from(schema.agentRuntimeCheckpointWrites)
      .where(
        organisationScopedWhere(
          schema.agentRuntimeCheckpointWrites.organisationId,
          this.organisationId,
          eq(schema.agentRuntimeCheckpointWrites.threadId, threadId),
          eq(
            schema.agentRuntimeCheckpointWrites.checkpointNamespace,
            checkpointNamespace,
          ),
          eq(schema.agentRuntimeCheckpointWrites.checkpointId, checkpointId),
        ),
      )
      .orderBy(
        schema.agentRuntimeCheckpointWrites.taskId,
        schema.agentRuntimeCheckpointWrites.writeIndex,
      );

    return Promise.all(
      rows.map(async (row: CheckpointWriteRow) => {
        const bytes = fromBase64Envelope(row.value);
        const value = await this.serde.loadsTyped(row.type ?? "json", bytes);
        return [row.taskId, row.channel, value] as [string, string, unknown];
      }),
    );
  }

  private buildTuple(
    threadId: string,
    checkpointNamespace: string,
    row: CheckpointRow,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    pendingWrites: [string, string, unknown][],
  ): CheckpointTuple {
    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNamespace,
          checkpoint_id: row.checkpointId,
        },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };
    if (row.parentCheckpointId) {
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNamespace,
          checkpoint_id: row.parentCheckpointId,
        },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = configurableThreadId(config);
    assertThreadBelongsToOrganisation(threadId, this.organisationId);
    const checkpointNamespace = configurableCheckpointNamespace(config);
    const checkpointId = optionalCheckpointId(config);

    const conditions = [
      eq(schema.agentRuntimeCheckpoints.threadId, threadId),
      eq(schema.agentRuntimeCheckpoints.checkpointNamespace, checkpointNamespace),
      ...(checkpointId
        ? [eq(schema.agentRuntimeCheckpoints.checkpointId, checkpointId)]
        : []),
    ];

    const [row] = await this.db
      .select()
      .from(schema.agentRuntimeCheckpoints)
      .where(
        organisationScopedWhere(
          schema.agentRuntimeCheckpoints.organisationId,
          this.organisationId,
          ...conditions,
        ),
      )
      .orderBy(desc(schema.agentRuntimeCheckpoints.checkpointId))
      .limit(1);

    if (!row) return undefined;

    const checkpoint = await this.deserialiseCheckpoint(row);
    const metadata = asCheckpointMetadata(row.metadata);
    const pendingWrites = await this.selectPendingWrites(
      threadId,
      checkpointNamespace,
      row.checkpointId,
    );

    return this.buildTuple(
      threadId,
      checkpointNamespace,
      row,
      checkpoint,
      metadata,
      pendingWrites,
    );
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = configurableThreadId(config);
    assertThreadBelongsToOrganisation(threadId, this.organisationId);
    const checkpointNamespace = configurableCheckpointNamespace(config);
    const beforeCheckpointId = options?.before
      ? optionalCheckpointId(options.before)
      : undefined;
    const filter = options?.filter;
    let remaining = options?.limit;

    const rows = await this.db
      .select()
      .from(schema.agentRuntimeCheckpoints)
      .where(
        organisationScopedWhere(
          schema.agentRuntimeCheckpoints.organisationId,
          this.organisationId,
          eq(schema.agentRuntimeCheckpoints.threadId, threadId),
          eq(
            schema.agentRuntimeCheckpoints.checkpointNamespace,
            checkpointNamespace,
          ),
          ...(beforeCheckpointId
            ? [lt(schema.agentRuntimeCheckpoints.checkpointId, beforeCheckpointId)]
            : []),
        ),
      )
      .orderBy(desc(schema.agentRuntimeCheckpoints.checkpointId));

    for (const row of rows) {
      if (remaining !== undefined) {
        if (remaining <= 0) break;
      }

      const metadata = asCheckpointMetadata(row.metadata);
      if (
        filter &&
        !Object.entries(filter).every(
          ([key, value]) => (metadata as Record<string, unknown>)[key] === value,
        )
      ) {
        continue;
      }

      if (remaining !== undefined) remaining -= 1;

      const checkpoint = await this.deserialiseCheckpoint(row);
      const pendingWrites = await this.selectPendingWrites(
        threadId,
        checkpointNamespace,
        row.checkpointId,
      );

      yield this.buildTuple(
        threadId,
        checkpointNamespace,
        row,
        checkpoint,
        metadata,
        pendingWrites,
      );
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = configurableThreadId(config);
    assertThreadBelongsToOrganisation(threadId, this.organisationId);
    const checkpointNamespace = configurableCheckpointNamespace(config);
    const parentCheckpointId = optionalCheckpointId(config) ?? null;

    const prepared = copyCheckpoint(checkpoint);
    const [type, serialisedCheckpoint] = await this.serde.dumpsTyped(prepared);
    const checkpointEnvelope = toBase64Envelope(serialisedCheckpoint);

    await this.db
      .insert(schema.agentRuntimeCheckpoints)
      .values({
        organisationId: this.organisationId,
        threadId,
        checkpointNamespace,
        checkpointId: checkpoint.id,
        parentCheckpointId,
        agentId: this.agentId,
        conversationId: this.conversationId,
        runId: this.runId,
        graphVersion: this.graphVersion,
        type,
        checkpoint: checkpointEnvelope,
        metadata,
      })
      .onConflictDoUpdate({
        target: [
          schema.agentRuntimeCheckpoints.organisationId,
          schema.agentRuntimeCheckpoints.threadId,
          schema.agentRuntimeCheckpoints.checkpointNamespace,
          schema.agentRuntimeCheckpoints.checkpointId,
        ],
        set: {
          parentCheckpointId,
          agentId: this.agentId,
          conversationId: this.conversationId,
          runId: this.runId,
          graphVersion: this.graphVersion,
          type,
          checkpoint: checkpointEnvelope,
          metadata,
        },
      });

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNamespace,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = configurableThreadId(config);
    assertThreadBelongsToOrganisation(threadId, this.organisationId);
    const checkpointNamespace = configurableCheckpointNamespace(config);
    const checkpointId = optionalCheckpointId(config);
    if (checkpointId === undefined) {
      throw new Error(
        'Failed to put writes. The passed RunnableConfig is missing a required "checkpoint_id" field in its "configurable" property.',
      );
    }

    const target = [
      schema.agentRuntimeCheckpointWrites.organisationId,
      schema.agentRuntimeCheckpointWrites.threadId,
      schema.agentRuntimeCheckpointWrites.checkpointNamespace,
      schema.agentRuntimeCheckpointWrites.checkpointId,
      schema.agentRuntimeCheckpointWrites.taskId,
      schema.agentRuntimeCheckpointWrites.writeIndex,
    ];

    for (const [index, write] of writes.entries()) {
      const [channel, value] = write;
      const writeIndex = WRITES_IDX_MAP[channel] ?? index;
      const [type, serialisedValue] = await this.serde.dumpsTyped(value);
      const row = {
        organisationId: this.organisationId,
        threadId,
        checkpointNamespace,
        checkpointId,
        taskId,
        writeIndex,
        runId: this.runId,
        channel,
        type,
        value: toBase64Envelope(serialisedValue),
      };

      if (writeIndex >= 0) {
        // Regular writes: first write for a given (taskId, writeIndex) wins,
        // exactly like `MemorySaver`. A replayed step re-sends the same
        // writes and must not clobber (or crash on) what is already stored.
        await this.db
          .insert(schema.agentRuntimeCheckpointWrites)
          .values(row)
          .onConflictDoNothing({ target });
      } else {
        // Special channels (error/scheduled/interrupt/resume) always
        // overwrite, matching `MemorySaver`'s unconditional re-write for
        // negative `WRITES_IDX_MAP` indices.
        await this.db
          .insert(schema.agentRuntimeCheckpointWrites)
          .values(row)
          .onConflictDoUpdate({
            target,
            set: { runId: this.runId, channel, type, value: row.value },
          });
      }
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    assertThreadBelongsToOrganisation(threadId, this.organisationId);

    await this.db
      .delete(schema.agentRuntimeCheckpointWrites)
      .where(
        organisationScopedWhere(
          schema.agentRuntimeCheckpointWrites.organisationId,
          this.organisationId,
          eq(schema.agentRuntimeCheckpointWrites.threadId, threadId),
        ),
      );

    await this.db
      .delete(schema.agentRuntimeCheckpoints)
      .where(
        organisationScopedWhere(
          schema.agentRuntimeCheckpoints.organisationId,
          this.organisationId,
          eq(schema.agentRuntimeCheckpoints.threadId, threadId),
        ),
      );
  }
}

/** Organisation- and run-scoped, for run inspection surfaces. */
export async function countCheckpoints(
  db: Db,
  organisationId: string,
  runId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.agentRuntimeCheckpoints)
    .where(
      organisationScopedWhere(
        schema.agentRuntimeCheckpoints.organisationId,
        organisationId,
        eq(schema.agentRuntimeCheckpoints.runId, runId),
      ),
    );
  return row?.value ?? 0;
}

/** Organisation- and run-scoped, for run inspection surfaces. */
export async function latestCheckpointId(
  db: Db,
  organisationId: string,
  runId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({
      checkpointId: schema.agentRuntimeCheckpoints.checkpointId,
    })
    .from(schema.agentRuntimeCheckpoints)
    .where(
      organisationScopedWhere(
        schema.agentRuntimeCheckpoints.organisationId,
        organisationId,
        eq(schema.agentRuntimeCheckpoints.runId, runId),
      ),
    )
    .orderBy(desc(schema.agentRuntimeCheckpoints.createdAt))
    .limit(1);
  return row?.checkpointId;
}
