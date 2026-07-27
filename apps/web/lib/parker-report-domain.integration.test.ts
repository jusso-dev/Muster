import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";
import { ApprovalDomainService } from "./integration-action-domain";
import { ParkerReportDomainService } from "./parker-report-domain";

const describeIntegration =
  process.env.MUSTER_INTEGRATION_TESTS === "true"
    ? describe.sequential
    : describe.skip;

describeIntegration("Parker report room scope", () => {
  const db = database();
  let subject: {
    actorId: string;
    organisationId: string;
    capabilities: Set<any>;
  };
  let roomId = "";

  beforeAll(async () => {
    const [parker] = await db
      .select({ allowedRooms: schema.agentDefinitions.allowedRooms })
      .from(schema.agentDefinitions)
      .where(eq(schema.agentDefinitions.name, "Parker"))
      .limit(1);
    if (!parker || !Array.isArray(parker.allowedRooms))
      throw new Error("Bootstrapped Parker required");
    roomId = String(parker.allowedRooms[0] ?? "");
    const [actor] = await db
      .select({ actor: schema.actors })
      .from(schema.actors)
      .innerJoin(
        schema.roomMemberships,
        and(
          eq(
            schema.roomMemberships.organisationId,
            schema.actors.organisationId,
          ),
          eq(schema.roomMemberships.actorId, schema.actors.id),
          eq(schema.roomMemberships.roomId, roomId),
        ),
      )
      .where(eq(schema.actors.actorType, "human"))
      .limit(1);
    if (!actor || !Array.isArray(actor.actor.capabilityAssignments))
      throw new Error("Bootstrapped human room member required");
    subject = {
      actorId: actor.actor.id,
      organisationId: actor.actor.organisationId,
      capabilities: new Set(actor.actor.capabilityAssignments as any[]),
    };
  });

  afterAll(closeDatabase);

  it("rechecks room membership before returning replay identifiers", async () => {
    const idempotencyKey = `test:parker-room-replay:${newId()}`;
    const request = {
      roomId,
      audience: "executive" as const,
      period: {
        from: new Date(Date.now() - 86_400_000),
        to: new Date(),
      },
      timezone: "UTC",
      idempotencyKey,
    };
    const first = await new ParkerReportDomainService().create(
      subject,
      request,
      newId(),
    );
    const [membership] = await db
      .delete(schema.roomMemberships)
      .where(
        and(
          eq(schema.roomMemberships.organisationId, subject.organisationId),
          eq(schema.roomMemberships.roomId, roomId),
          eq(schema.roomMemberships.actorId, subject.actorId),
        ),
      )
      .returning();
    if (!membership) throw new Error("Room membership fixture missing");
    try {
      await expect(
        new ParkerReportDomainService().create(subject, request, newId()),
      ).rejects.toThrow("Report room not found");
    } finally {
      await db.insert(schema.roomMemberships).values(membership);
    }
    expect(first.duplicate).toBe(false);
  });

  it("queues the report email outbox after approval", async () => {
    const reportId = newId();
    const idempotencyKey = `test:parker-email:${reportId}`;
    await db.insert(schema.reportManifests).values({
      id: reportId,
      organisationId: subject.organisationId,
      roomId,
      requestedByActorId: subject.actorId,
      status: "reviewed",
      manifest: {},
      classification: "internal",
      idempotencyKey: `test:parker-manifest:${reportId}`,
    });
    const delivery = await new ParkerReportDomainService().requestEmail(
      subject,
      reportId,
      {
        recipient: `parker-${reportId}@example.test`,
        idempotencyKey,
      },
      newId(),
    );
    const decision = await new ApprovalDomainService().decide(
      subject,
      delivery.approvalId,
      {
        status: "approved",
        reason: "Synthetic report email approval.",
      },
      newId(),
    );
    const [persisted] = await db
      .select()
      .from(schema.reportDeliveries)
      .where(
        and(
          eq(schema.reportDeliveries.organisationId, subject.organisationId),
          eq(schema.reportDeliveries.id, delivery.id),
        ),
      );
    const [event] = await db
      .select()
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.organisationId, subject.organisationId),
          eq(schema.outboxEvents.eventType, "report.email.queued"),
          eq(schema.outboxEvents.aggregateId, delivery.id),
        ),
      );
    expect(decision.status).toBe("approved");
    expect(persisted?.status).toBe("queued");
    expect(event?.queueName).toBe("muster-notifications");
  });
});
