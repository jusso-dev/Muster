import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";
import { ConnectorDomainService } from "./connector-domain";
import {
  ApprovalDomainService,
  IntegrationActionDomainService,
} from "./integration-action-domain";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("connector domain governance", () => {
  let subject: {
    actorId: string;
    organisationId: string;
    capabilities: Set<any>;
  };
  let connectorId = "";
  let tawnyResponseConnectorId = "";
  let kelpieConnectorId = "";
  let jessieActorId = "";
  const instanceId = `synthetic-${newId()}`;

  beforeAll(async () => {
    process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      "base64",
    );
    const actors = await database().select().from(schema.actors);
    const actor = actors.find(
      (candidate) =>
        Array.isArray(candidate.capabilityAssignments) &&
        candidate.capabilityAssignments.includes("administration.manage"),
    );
    if (!actor) throw new Error("Seeded administrator actor required");
    subject = {
      actorId: actor.id,
      organisationId: actor.organisationId,
      capabilities: new Set(actor.capabilityAssignments as any[]),
    };
    jessieActorId = newId();
    await database()
      .insert(schema.actors)
      .values({
        id: jessieActorId,
        organisationId: actor.organisationId,
        actorType: "agent",
        displayName: `Jessie synthetic ${jessieActorId}`,
        identityReference: `agent:jessie:${jessieActorId}`,
        capabilityAssignments: ["alerts.read"],
      });
  });

  afterAll(closeDatabase);

  it("configures encrypted credentials without browser projection", async () => {
    const result = await new ConnectorDomainService().configure(
      subject,
      {
        product: "generic_rest",
        instanceId,
        displayName: "Synthetic governed source",
        baseUrl: "http://synthetic-source.test",
        allowedHosts: ["synthetic-source.test"],
        allowPrivateNetwork: false,
        testMode: true,
        auth: { type: "bearer", token: "never-project-this-secret" },
        limits: {
          timeoutMs: 1_000,
          maxResponseBytes: 10_000,
          maxRecords: 10,
          maxPages: 2,
          requestsPerMinute: 10,
        },
        templates: [
          {
            key: "generic.alerts.list",
            version: 1,
            displayName: "List synthetic alerts",
            method: "GET",
            pathTemplate: "/alerts",
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
      `configure-${instanceId}`,
    );
    connectorId = result.id;
    const projection = JSON.stringify(
      await new ConnectorDomainService().list(subject),
    );
    expect(projection).not.toContain("never-project-this-secret");
    const [credential] = await database()
      .select()
      .from(schema.integrationConnectorCredentials)
      .where(
        and(
          eq(
            schema.integrationConnectorCredentials.organisationId,
            subject.organisationId,
          ),
          eq(schema.integrationConnectorCredentials.integrationId, connectorId),
        ),
      );
    expect(credential?.encryptedCredential).not.toContain(
      "never-project-this-secret",
    );
  });

  it("queues idempotently and denies cross-tenant observation", async () => {
    const idempotencyKey = `synthetic-query-${newId()}`;
    const first = await new ConnectorDomainService().queueQuery(
      subject,
      connectorId,
      {
        templateKey: "generic.alerts.list",
        input: {},
        idempotencyKey,
      },
      `query-${idempotencyKey}`,
    );
    const duplicate = await new ConnectorDomainService().queueQuery(
      subject,
      connectorId,
      {
        templateKey: "generic.alerts.list",
        input: {},
        idempotencyKey,
      },
      `query-${idempotencyKey}`,
    );
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    await expect(
      new ConnectorDomainService().run(
        { ...subject, organisationId: newId() },
        first.id,
      ),
    ).rejects.toThrow("Connector query does not exist");
  });

  it("rotates credentials in place with immutable audit metadata", async () => {
    const result = await new ConnectorDomainService().rotate(
      subject,
      connectorId,
      { type: "bearer", token: "rotated-never-project" },
      `rotate-${connectorId}`,
    );
    expect(result.rotationVersion).toBeGreaterThan(1);
    const [audit] = await database()
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.organisationId, subject.organisationId),
          eq(schema.auditEvents.targetId, connectorId),
          eq(schema.auditEvents.action, "connector.credential.rotated"),
        ),
      );
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain("rotated-never-project");
  });

  it("lets a bounded Jessie actor queue the Defender for Endpoint preset", async () => {
    const configured = await new ConnectorDomainService().configure(
      subject,
      {
        product: "defender_endpoint",
        instanceId: `mde-${instanceId}`,
        displayName: "Synthetic Defender for Endpoint",
        baseUrl: "https://api.security.microsoft.com",
        allowedHosts: ["api.security.microsoft.com"],
        allowPrivateNetwork: false,
        testMode: false,
        auth: { type: "bearer", token: "synthetic-mde-token" },
        limits: {
          timeoutMs: 1_000,
          maxResponseBytes: 10_000,
          maxRecords: 10,
          maxPages: 2,
          requestsPerMinute: 10,
        },
      },
      `configure-mde-${instanceId}`,
    );
    const queued = await new ConnectorDomainService().queueQuery(
      {
        actorId: jessieActorId,
        organisationId: subject.organisationId,
        capabilities: new Set(["alerts.read"]),
      },
      configured.id,
      {
        templateKey: "mde.alerts.list",
        input: {},
        idempotencyKey: `jessie-mde-${newId()}`,
      },
      `jessie-mde-${instanceId}`,
    );
    expect(queued).toMatchObject({ status: "queued", duplicate: false });
    const [audit] = await database()
      .select({ actorType: schema.auditEvents.actorType })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.targetId, queued.id));
    expect(audit?.actorType).toBe("agent");
  });

  it("queues approval-gated Tawny response without projecting action input", async () => {
    const connectors = new ConnectorDomainService();
    tawnyResponseConnectorId = (
      await connectors.configure(
        subject,
        {
          product: "tawny_response",
          instanceId: `tawny-response-${instanceId}`,
          displayName: "Synthetic Tawny response",
          baseUrl: "http://tawny.test",
          allowedHosts: ["tawny.test"],
          allowPrivateNetwork: true,
          testMode: true,
          auth: { type: "bearer", token: "tawny-response-secret" },
          limits: {
            timeoutMs: 1_000,
            maxResponseBytes: 10_000,
            maxRecords: 10,
            maxPages: 2,
            requestsPerMinute: 10,
          },
        },
        `configure-tawny-response-${instanceId}`,
      )
    ).id;
    const idempotencyKey = `tawny-isolate-${newId()}`;
    const first = await new IntegrationActionDomainService().request(
      subject,
      {
        operation: "tawny.isolate_host",
        integrationId: tawnyResponseConnectorId,
        agentId: newId(),
        reason: "Synthetic approved containment reason",
        idempotencyKey,
      },
      `trace-${idempotencyKey}`,
    );
    expect(first).toMatchObject({
      status: "awaiting_approval",
      duplicate: false,
    });
    const duplicate = await new IntegrationActionDomainService().request(
      subject,
      {
        operation: "tawny.isolate_host",
        integrationId: tawnyResponseConnectorId,
        agentId: newId(),
        reason: "This duplicate body is never persisted",
        idempotencyKey,
      },
      `trace-${idempotencyKey}`,
    );
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    const projection = JSON.stringify(
      await new IntegrationActionDomainService().list(subject),
    );
    expect(projection).not.toContain("Synthetic approved containment reason");
    expect(projection).not.toContain("envelope");

    if (!first.approvalId) throw new Error("Approval record required");
    const decision = await new ApprovalDomainService().decide(
      subject,
      first.approvalId,
      {
        status: "approved",
        reason: "Synthetic action reviewed and approved",
      },
      `approve-${idempotencyKey}`,
    );
    expect(decision).toMatchObject({ status: "approved", duplicate: false });
    const [delivery] = await database()
      .select({ status: schema.integrationDeliveries.status })
      .from(schema.integrationDeliveries)
      .where(eq(schema.integrationDeliveries.id, first.id));
    expect(delivery?.status).toBe("queued");
    await expect(
      new IntegrationActionDomainService().get(
        { ...subject, organisationId: newId() },
        first.id,
      ),
    ).rejects.toThrow("Integration action does not exist");
  });

  it("queues idempotent Kelpie mutations and denies missing capability", async () => {
    kelpieConnectorId = (
      await new ConnectorDomainService().configure(
        subject,
        {
          product: "kelpie",
          instanceId: `kelpie-${instanceId}`,
          displayName: "Synthetic Kelpie",
          baseUrl: "http://kelpie.test",
          allowedHosts: ["kelpie.test"],
          allowPrivateNetwork: true,
          testMode: true,
          auth: { type: "bearer", token: "kelpie-secret" },
          limits: {
            timeoutMs: 1_000,
            maxResponseBytes: 10_000,
            maxRecords: 10,
            maxPages: 2,
            requestsPerMinute: 10,
          },
        },
        `configure-kelpie-${instanceId}`,
      )
    ).id;
    await expect(
      new IntegrationActionDomainService().request(
        { ...subject, capabilities: new Set(["kelpie.cases.read"]) },
        {
          operation: "kelpie.timeline.comment",
          integrationId: kelpieConnectorId,
          caseId: "synthetic-case",
          body: "Synthetic timeline evidence",
          idempotencyKey: `kelpie-denied-${newId()}`,
        },
        "kelpie-denied",
      ),
    ).rejects.toThrow("Missing capability");
    const queued = await new IntegrationActionDomainService().request(
      subject,
      {
        operation: "kelpie.timeline.comment",
        integrationId: kelpieConnectorId,
        caseId: "synthetic-case",
        body: "Synthetic timeline evidence",
        evidenceReferences: ["muster:evidence:synthetic"],
        idempotencyKey: `kelpie-comment-${newId()}`,
      },
      "kelpie-comment",
    );
    expect(queued).toMatchObject({ status: "queued", duplicate: false });
    const [outbox] = await database()
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.aggregateId, queued.id));
    expect(outbox?.eventType).toBe("integration.action.queued");
  });
});
