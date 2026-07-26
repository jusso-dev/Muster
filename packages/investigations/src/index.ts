import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  assertExecutableApproval,
  requireCapability,
  type AuthorisationSubject,
} from "@muster/authz";
import { SeveritySchema } from "@muster/contracts";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";

const validTransitions = {
  open: ["triaging", "investigating", "closed"],
  triaging: ["investigating", "awaiting_approval", "closed"],
  investigating: ["awaiting_approval", "closed"],
  awaiting_approval: ["investigating", "promoted", "closed"],
  promoted: ["closed"],
  closed: [],
} as const;

export function assertInvestigationTransition(from: string, to: string): void {
  const allowed = validTransitions[from as keyof typeof validTransitions];
  if (!allowed?.includes(to as never)) {
    throw new Error(`Invalid investigation transition: ${from} to ${to}`);
  }
}

export const CreateInvestigationSchema = z.object({
  title: z.string().min(2).max(240),
  summary: z.string().max(20_000).default(""),
  severity: SeveritySchema,
  leadActorId: z.string().uuid().nullable().optional(),
  alertIds: z.array(z.string().uuid()).max(200).default([]),
});

export const FindingSchema = z.object({
  title: z.string().min(2).max(240),
  summary: z.string().min(2).max(20_000),
  confidence: z.number().int().min(0).max(100),
  severity: SeveritySchema,
  supportingEvidence: z.array(z.record(z.string(), z.unknown())).max(100),
  relatedEntities: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  relatedObservables: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  recommendedAction: z.string().max(2_000).nullable().optional(),
  agentProvenance: z.record(z.string(), z.unknown()).nullable().optional(),
});

export class InvestigationService {
  constructor(private readonly db = database()) {}

  async create(
    subject: AuthorisationSubject,
    input: z.input<typeof CreateInvestigationSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "investigations.create");
    const parsed = CreateInvestigationSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${subject.organisationId}:investigation-number`}, 0))`,
      );
      const [result] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.investigations)
        .where(eq(schema.investigations.organisationId, subject.organisationId));
      const count = result?.count ?? 0;
      const id = newId();
      const roomId = newId();
      const investigationNumber = `INV-2026-${String(count + 1).padStart(4, "0")}`;
      await tx.insert(schema.rooms).values({
        id: roomId,
        organisationId: subject.organisationId,
        name: `investigation-${parsed.title}`,
        slug: `investigation-${investigationNumber.toLowerCase()}`,
        displayName: parsed.title,
        description: "Collaborative investigation room",
        roomType: "investigation",
        createdByActorId: subject.actorId,
        linkedInvestigationId: id,
        defaultSeverity: parsed.severity,
      });
      await tx.insert(schema.roomMemberships).values({
        organisationId: subject.organisationId,
        roomId,
        actorId: subject.actorId,
        membershipRole: "owner",
      });
      const [investigation] = await tx
        .insert(schema.investigations)
        .values({
          id,
          organisationId: subject.organisationId,
          investigationNumber,
          title: parsed.title,
          summary: parsed.summary,
          severity: parsed.severity,
          leadActorId: parsed.leadActorId ?? subject.actorId,
          roomId,
          status: "triaging",
        })
        .returning();
      if (parsed.alertIds.length) {
        await tx
          .update(schema.alerts)
          .set({ investigationId: id, roomId, status: "investigating" })
          .where(
            and(
              eq(schema.alerts.organisationId, subject.organisationId),
              sql`${schema.alerts.id} = any(${parsed.alertIds}::uuid[])`,
            ),
          );
      }
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "investigation.created",
        aggregateType: "investigation",
        aggregateId: id,
        queueName: "muster-workflows",
        payload: { investigationId: id, roomId },
        idempotencyKey: `investigation.created:${id}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "investigation.created",
        targetType: "investigation",
        targetId: id,
        metadata: { investigationNumber, alertIds: parsed.alertIds },
        traceId,
      });
      return investigation;
    });
  }

  async addFinding(
    subject: AuthorisationSubject,
    investigationId: string,
    input: z.input<typeof FindingSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "investigations.update");
    const parsed = FindingSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [investigation] = await tx
        .select({ id: schema.investigations.id })
        .from(schema.investigations)
        .where(
          and(
            eq(schema.investigations.organisationId, subject.organisationId),
            eq(schema.investigations.id, investigationId),
          ),
        )
        .limit(1);
      if (!investigation) throw new Error("Investigation not found");
      const id = newId();
      const [finding] = await tx
        .insert(schema.findings)
        .values({
          id,
          organisationId: subject.organisationId,
          investigationId,
          createdByActorId: subject.actorId,
          ...parsed,
          recommendedAction: parsed.recommendedAction ?? null,
          agentProvenance: parsed.agentProvenance ?? null,
        })
        .returning();
      await tx
        .update(schema.investigations)
        .set({ lastActivityAt: new Date(), version: sql`${schema.investigations.version} + 1` })
        .where(eq(schema.investigations.id, investigationId));
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "investigation.finding.added",
        aggregateType: "finding",
        aggregateId: id,
        queueName: "muster-search",
        payload: { findingId: id, investigationId },
        idempotencyKey: `finding.created:${id}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: parsed.agentProvenance ? "agent" : "human",
        action: "investigation.finding.added",
        targetType: "finding",
        targetId: id,
        metadata: { investigationId, confidence: parsed.confidence },
        traceId,
      });
      return finding;
    });
  }

  async requestPromotion(
    subject: AuthorisationSubject,
    investigationId: string,
    traceId: string,
  ) {
    requireCapability(subject, "investigations.promote");
    return this.db.transaction(async (tx) => {
      const [investigation] = await tx
        .select()
        .from(schema.investigations)
        .where(
          and(
            eq(schema.investigations.organisationId, subject.organisationId),
            eq(schema.investigations.id, investigationId),
          ),
        )
        .limit(1);
      if (!investigation) throw new Error("Investigation not found");
      if (!["triaging", "investigating"].includes(investigation.status)) {
        throw new Error("Investigation cannot request promotion from current state");
      }
      const approvalId = newId();
      await tx.insert(schema.approvals).values({
        id: approvalId,
        organisationId: subject.organisationId,
        requestingActorId: subject.actorId,
        actionType: "investigation.promote",
        target: { investigationId },
        riskSummary: "Creates an authoritative incident case in Kelpie.",
        expiresAt: new Date(Date.now() + 30 * 60_000),
        requiredCapability: "investigations.promote",
        idempotencyKey: `investigation.promote:${investigationId}:${investigation.version}`,
      });
      await tx
        .update(schema.investigations)
        .set({
          status: "awaiting_approval",
          version: sql`${schema.investigations.version} + 1`,
        })
        .where(eq(schema.investigations.id, investigationId));
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "workflow.approval.requested",
        aggregateType: "approval",
        aggregateId: approvalId,
        queueName: "muster-notifications",
        payload: { approvalId, investigationId },
        idempotencyKey: `approval.requested:${approvalId}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "workflow.approval.requested",
        targetType: "approval",
        targetId: approvalId,
        metadata: { investigationId, actionType: "investigation.promote" },
        traceId,
      });
      return { approvalId, status: "pending" as const };
    });
  }

  async executePromotionAfterApproval(
    organisationId: string,
    approvalId: string,
    traceId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [approval] = await tx
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, organisationId),
            eq(schema.approvals.id, approvalId),
            eq(schema.approvals.status, "approved"),
          ),
        )
        .limit(1);
      if (!approval) throw new Error("Approved promotion record not found");
      const decisions = z
        .array(z.object({ actorId: z.string(), status: z.enum(["approved", "rejected"]) }))
        .parse(approval.decisions);
      assertExecutableApproval("investigation.promote", decisions);
      await writeOutbox(tx, {
        organisationId,
        eventType: "investigation.promoted",
        aggregateType: "approval",
        aggregateId: approvalId,
        queueName: "muster-integrations",
        payload: { approvalId, target: approval.target },
        idempotencyKey: `kelpie.case.create:${approvalId}`,
        traceId,
      });
    });
  }
}
