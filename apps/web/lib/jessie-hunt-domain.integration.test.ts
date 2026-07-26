import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";
import { ConnectorDomainService } from "./connector-domain";
import { ApprovalDomainService } from "./integration-action-domain";
import { JessieHuntDomainService } from "./jessie-hunt-domain";
import type { JessieHuntPlan } from "./jessie-hunt-domain";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("Jessie hunt governance", () => {
  let subject: {
    actorId: string;
    organisationId: string;
    capabilities: Set<any>;
  };
  let connectorId = "";
  let roomId = "";

  beforeAll(async () => {
    process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 14).toString(
      "base64",
    );
    const [jessie] = await database()
      .select({
        allowedRooms: schema.agentDefinitions.allowedRooms,
      })
      .from(schema.agentDefinitions)
      .where(eq(schema.agentDefinitions.name, "Jessie"))
      .limit(1);
    if (!jessie || !Array.isArray(jessie.allowedRooms))
      throw new Error("Bootstrapped Jessie required");
    roomId = String(jessie.allowedRooms[0] ?? "");
    const [actor] = await database()
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.actorType, "human"))
      .limit(1);
    if (
      !actor ||
      !Array.isArray(actor.capabilityAssignments) ||
      !actor.capabilityAssignments.includes("administration.manage")
    ) {
      throw new Error("Bootstrapped administrator required");
    }
    subject = {
      actorId: actor.id,
      organisationId: actor.organisationId,
      capabilities: new Set(actor.capabilityAssignments as any[]),
    };
    const configured = await new ConnectorDomainService().configure(
      subject,
      {
        product: "generic_rest",
        instanceId: `jessie-fixture-${newId()}`,
        displayName: "Synthetic multi-source fixture",
        baseUrl: "http://jessie-fixture.test",
        allowedHosts: ["jessie-fixture.test"],
        allowPrivateNetwork: false,
        testMode: true,
        auth: { type: "none" },
        limits: {
          timeoutMs: 1_000,
          maxResponseBytes: 10_000,
          maxRecords: 1_000,
          maxPages: 2,
          requestsPerMinute: 20,
        },
        templates: [
          {
            key: "synthetic.events.list",
            version: 1,
            displayName: "Synthetic bounded events",
            method: "GET",
            pathTemplate: "/events",
            requiredCapability: "alerts.read",
            inputSchema: { type: "object", additionalProperties: false },
            outputSchema: {
              type: "object",
              required: ["records"],
              properties: { records: { type: "array" } },
            },
            recordsPath: "records",
          },
        ],
      },
      `jessie-fixture-${newId()}`,
    );
    connectorId = configured.id;
  });

  afterAll(closeDatabase);

  it("persists and queues one visible bounded plan idempotently", async () => {
    const idempotencyKey = `jessie-hunt-${newId()}`;
    const request = {
      question: "What saw 192.0.2.10 during the last day?",
      roomId,
      sourceIds: [connectorId],
      maxRecordsPerSource: 25,
      idempotencyKey,
    };
    const first = await new JessieHuntDomainService().create(
      subject,
      request,
      `trace-${idempotencyKey}`,
    );
    const replay = await new JessieHuntDomainService().create(
      subject,
      request,
      `trace-replay-${idempotencyKey}`,
    );
    expect(first).toMatchObject({
      status: "querying",
      approvalId: null,
      duplicate: false,
    });
    expect(replay).toMatchObject({ id: first.id, duplicate: true });
    expect((first.plan as JessieHuntPlan).observables).toContainEqual({
      type: "ip",
      value: "192.0.2.10",
      normalizedValue: "192.0.2.10",
    });

    const [query] = await database()
      .select()
      .from(schema.integrationQueryRuns)
      .innerJoin(
        schema.huntQueries,
        and(
          eq(
            schema.huntQueries.organisationId,
            schema.integrationQueryRuns.organisationId,
          ),
          eq(schema.huntQueries.queryRunId, schema.integrationQueryRuns.id),
        ),
      )
      .where(eq(schema.huntQueries.huntId, first.id));
    expect(query?.integration_query_runs.status).toBe("queued");
    expect(JSON.stringify(query?.integration_query_runs.input)).not.toContain(
      "192.0.2.10",
    );
    const [run] = await database()
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, first.agentRunId));
    expect(run).toMatchObject({
      status: "waiting_sources",
      outputSchema: null,
    });
    const [planMessage] = await database()
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.organisationId, subject.organisationId),
          eq(
            schema.messages.idempotencyKey,
            `jessie-hunt-plan-message:${first.id}`,
          ),
        ),
      );
    expect(planMessage?.plainText).toContain("bounded hunt plan");
  });

  it("enforces invocation capability and tenant room scope", async () => {
    await expect(
      new JessieHuntDomainService().create(
        { ...subject, capabilities: new Set(["agents.read"]) },
        {
          question: "Hunt synthetic evidence",
          roomId,
          sourceIds: [connectorId],
          idempotencyKey: `denied-${newId()}`,
        },
        `trace-denied-${newId()}`,
      ),
    ).rejects.toThrow("Missing capability: agents.invoke");
    await expect(
      new JessieHuntDomainService().create(
        subject,
        {
          question: "Hunt synthetic evidence",
          roomId: newId(),
          sourceIds: [connectorId],
          idempotencyKey: `cross-tenant-${newId()}`,
        },
        `trace-cross-${newId()}`,
      ),
    ).rejects.toThrow("Room not found");
  });

  it("requires and records human approval for a broad exact plan", async () => {
    const now = new Date();
    const created = await new JessieHuntDomainService().create(
      subject,
      {
        question: "Broad synthetic correlation",
        roomId,
        sourceIds: [connectorId],
        timeRange: {
          from: new Date(now.getTime() - 48 * 60 * 60_000),
          to: now,
        },
        maxRecordsPerSource: 600,
        idempotencyKey: `broad-${newId()}`,
      },
      `trace-broad-${newId()}`,
    );
    expect(created).toMatchObject({
      status: "awaiting_approval",
      duplicate: false,
    });
    expect((created.plan as JessieHuntPlan).approvalReasons).toEqual([
      "time range is 48 hours",
      "record limit is 600 per source",
    ]);
    if (!created.approvalId) throw new Error("Approval ID required");
    const decision = await new ApprovalDomainService().decide(
      subject,
      created.approvalId,
      { status: "approved", reason: "Synthetic bounded plan reviewed" },
      `trace-approve-${created.id}`,
    );
    expect(decision.status).toBe("approved");
    const [hunt, run, query] = await Promise.all([
      database()
        .select()
        .from(schema.huntRuns)
        .where(eq(schema.huntRuns.id, created.id))
        .then((rows) => rows[0]),
      database()
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.id, created.agentRunId))
        .then((rows) => rows[0]),
      database()
        .select({ status: schema.integrationQueryRuns.status })
        .from(schema.integrationQueryRuns)
        .innerJoin(
          schema.huntQueries,
          eq(schema.huntQueries.queryRunId, schema.integrationQueryRuns.id),
        )
        .where(eq(schema.huntQueries.huntId, created.id))
        .then((rows) => rows[0]),
    ]);
    expect(hunt?.status).toBe("querying");
    expect(run?.status).toBe("waiting_sources");
    expect(query?.status).toBe("queued");
  });
});
