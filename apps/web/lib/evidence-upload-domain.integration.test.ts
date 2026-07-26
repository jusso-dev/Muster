import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { capabilities, type AuthorisationSubject } from "@muster/authz";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, count, eq } from "drizzle-orm";
import { uploadRoomAttachment } from "./evidence-upload-domain.ts";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("governed room evidence uploads", () => {
  const organisationId = newId();
  const actorId = newId();
  const roomId = newId();
  const subject: AuthorisationSubject = {
    organisationId,
    actorId,
    capabilities: new Set(capabilities),
  };

  beforeAll(async () => {
    await database()
      .insert(schema.organisations)
      .values({
        id: organisationId,
        name: "Synthetic Evidence Organisation",
        slug: `synthetic-evidence-${organisationId}`,
      });
    await database()
      .insert(schema.actors)
      .values({
        id: actorId,
        organisationId,
        actorType: "human",
        displayName: "Synthetic Evidence Uploader",
        capabilityAssignments: [...capabilities],
      });
    await database()
      .insert(schema.rooms)
      .values({
        id: roomId,
        organisationId,
        name: "synthetic-evidence",
        slug: `synthetic-evidence-${roomId}`,
        displayName: "Synthetic Evidence",
        roomType: "operations",
        visibility: "private",
        createdByActorId: actorId,
      });
    await database().insert(schema.roomMemberships).values({
      organisationId,
      roomId,
      actorId,
      membershipRole: "owner",
    });
  });

  afterAll(closeDatabase);

  it("stores metadata, audit, and outbox transactionally and deduplicates by hash", async () => {
    const putObject = vi.fn().mockResolvedValue(undefined);
    const input = {
      fileName: "synthetic-evidence.txt",
      mimeType: "text/plain",
      body: new TextEncoder().encode("Synthetic governed evidence"),
      classification: "internal" as const,
    };
    const first = await uploadRoomAttachment(
      subject,
      roomId,
      input,
      `trace-${newId()}`,
      { putObject },
    );
    const duplicate = await uploadRoomAttachment(
      subject,
      roomId,
      input,
      `trace-${newId()}`,
      { putObject },
    );
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      label: "synthetic-evidence.txt",
      mimeType: "text/plain",
      scanState: "pending",
    });
    expect(putObject).toHaveBeenCalledTimes(1);

    const [evidenceTotal] = await database()
      .select({ value: count() })
      .from(schema.evidence)
      .where(eq(schema.evidence.organisationId, organisationId));
    const [auditTotal] = await database()
      .select({ value: count() })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.organisationId, organisationId),
          eq(schema.auditEvents.targetId, first.id),
        ),
      );
    const [outboxTotal] = await database()
      .select({ value: count() })
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.organisationId, organisationId),
          eq(schema.outboxEvents.aggregateId, first.id),
        ),
      );
    expect(evidenceTotal?.value).toBe(1);
    expect(auditTotal?.value).toBe(2);
    expect(outboxTotal?.value).toBe(2);
  });

  it("records object storage failures without exposing storage errors", async () => {
    const body = new TextEncoder().encode(`Synthetic failure ${newId()}`);
    await expect(
      uploadRoomAttachment(
        subject,
        roomId,
        {
          fileName: "synthetic-failure.txt",
          mimeType: "text/plain",
          body,
          classification: "restricted",
        },
        `trace-${newId()}`,
        {
          putObject: vi
            .fn()
            .mockRejectedValue(new Error("Synthetic storage secret detail")),
        },
      ),
    ).rejects.toMatchObject({
      status: 502,
      detail: "The attachment could not be stored. Retry is safe.",
    });
    const [failed] = await database()
      .select({ scanState: schema.evidence.scanState })
      .from(schema.evidence)
      .where(
        and(
          eq(schema.evidence.organisationId, organisationId),
          eq(schema.evidence.fileName, "synthetic-failure.txt"),
        ),
      )
      .limit(1);
    expect(failed?.scanState).toBe("failed");
  });
});
