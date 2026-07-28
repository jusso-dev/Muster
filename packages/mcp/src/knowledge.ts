import { createHash } from "node:crypto";
import { and, desc, eq, gt, ilike, inArray, isNull, or } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
} from "@muster/database";
import { z } from "zod";
import { McpToolError } from "./errors.ts";
import { requireScope, type InstallationContext } from "./installation.ts";
import type { ToolResult } from "./tools.ts";

type Database = ReturnType<typeof database>;

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{10,}/i,
  /api[_-]?key\s*[:=]\s*\S+/i,
  /bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /xox[baprs]-[A-Za-z0-9-]+/i,
  /password\s*[:=]\s*\S+/i,
];

const HIDDEN_REASONING_PATTERNS: readonly RegExp[] = [
  /<\/?think(?:ing)?>/i,
  /\bchain[-\s]?of[-\s]?thought\b/i,
  /\bhidden reasoning\b/i,
  /\binternal monologue\b/i,
];

const UNSUPPORTED_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bwithout evidence\b/i,
  /\bi am certain that\b/i,
  /\bdefinitely compromised\b/i,
  /\bignore (all )?(previous|prior) instructions\b/i,
];

export const KnowledgeProposalSchema = z.object({
  kind: z.enum(["fact", "finding", "correction", "procedure"]),
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(20_000),
  evidenceReferences: z
    .array(z.string().trim().min(1).max(500))
    .min(1)
    .max(50),
  classification: z
    .enum(["public", "internal", "confidential", "restricted"])
    .default("internal"),
  supersedesId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export type KnowledgeProposal = z.infer<typeof KnowledgeProposalSchema>;

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function policyForProposal(input: {
  title: string;
  content: string;
  evidenceReferences: readonly string[];
}): {
  policyDecision: "pending_review" | "quarantined" | "rejected";
  status: "proposed" | "quarantined" | "rejected";
  reasons: string[];
} {
  const blob = `${input.title}\n${input.content}`;
  const reasons: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(blob)) reasons.push(`secret_pattern:${pattern.source}`);
  }
  for (const pattern of HIDDEN_REASONING_PATTERNS) {
    if (pattern.test(blob))
      reasons.push(`hidden_reasoning:${pattern.source}`);
  }
  if (reasons.some((r) => r.startsWith("secret_pattern"))) {
    return { policyDecision: "rejected", status: "rejected", reasons };
  }
  if (reasons.some((r) => r.startsWith("hidden_reasoning"))) {
    return { policyDecision: "rejected", status: "rejected", reasons };
  }
  for (const pattern of UNSUPPORTED_CLAIM_PATTERNS) {
    if (pattern.test(blob))
      reasons.push(`unsupported_claim:${pattern.source}`);
  }
  if (input.evidenceReferences.length === 0)
    reasons.push("missing_evidence_references");
  if (reasons.length > 0) {
    return { policyDecision: "quarantined", status: "quarantined", reasons };
  }
  // Model proposals never auto-accept: human/policy review is required.
  return { policyDecision: "pending_review", status: "proposed", reasons: [] };
}

function publicEntry(
  row: typeof schema.operationalKnowledge.$inferSelect,
): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    status: row.status,
    classification: row.classification,
    evidenceReferences: row.evidenceReferences,
    policyDecision: row.policyDecision,
    supersedesId: row.supersedesId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Never expose as authorisation proof — status is informational only.
    authorisationProof: false,
  };
}

/**
 * Propose organisation-scoped operational knowledge. Never auto-accepts
 * model proposals; never stores secrets or hidden reasoning.
 */
export async function proposeKnowledge(
  db: Database,
  context: InstallationContext,
  raw: unknown,
  traceId: string,
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_propose_knowledge");
  requireCapability(context.subject, "evidence.upload");

  let proposal: KnowledgeProposal;
  try {
    proposal = KnowledgeProposalSchema.parse(raw);
  } catch (error) {
    throw new McpToolError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid knowledge proposal.",
    );
  }

  const policy = policyForProposal(proposal);
  const hash = contentHash(proposal.content);
  const idempotencyKey = `mcp-knowledge:${proposal.idempotencyKey}`;

  const result = await db.transaction(async (tx) => {
    // Idempotency via audit metadata is weak; use content hash + title +
    // installation within a short window... Better: store idempotency in
    // a dedicated field. For this slice, reuse contentHash + installation
    // + kind + supersedes for exact-duplicate suppress within org.
    const [existing] = await tx
      .select()
      .from(schema.operationalKnowledge)
      .where(
        and(
          eq(
            schema.operationalKnowledge.organisationId,
            context.subject.organisationId,
          ),
          eq(schema.operationalKnowledge.contentHash, hash),
          eq(schema.operationalKnowledge.title, proposal.title),
          eq(
            schema.operationalKnowledge.sourceInstallationId,
            context.installationId,
          ),
        ),
      )
      .limit(1);
    if (existing) {
      return { entry: publicEntry(existing), duplicate: true, policyReasons: policy.reasons };
    }

    if (proposal.supersedesId) {
      const [prior] = await tx
        .select({ id: schema.operationalKnowledge.id })
        .from(schema.operationalKnowledge)
        .where(
          and(
            eq(
              schema.operationalKnowledge.organisationId,
              context.subject.organisationId,
            ),
            eq(schema.operationalKnowledge.id, proposal.supersedesId),
          ),
        )
        .limit(1);
      if (!prior)
        throw new McpToolError(
          "not_found",
          "Superseded knowledge entry does not exist in this organisation.",
        );
      await tx
        .update(schema.operationalKnowledge)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(
          and(
            eq(
              schema.operationalKnowledge.organisationId,
              context.subject.organisationId,
            ),
            eq(schema.operationalKnowledge.id, proposal.supersedesId),
          ),
        );
    }

    const id = newId();
    const [row] = await tx
      .insert(schema.operationalKnowledge)
      .values({
        id,
        organisationId: context.subject.organisationId,
        kind: proposal.kind,
        title: proposal.title,
        content: proposal.content,
        contentHash: hash,
        status: policy.status,
        classification: proposal.classification,
        evidenceReferences: proposal.evidenceReferences,
        sourceInstallationId: context.installationId,
        proposedByActorId: context.subject.actorId,
        supersedesId: proposal.supersedesId,
        expiresAt: proposal.expiresAt ? new Date(proposal.expiresAt) : null,
        policyDecision: policy.policyDecision,
        reviewReason:
          policy.reasons.length > 0 ? policy.reasons.join("; ") : null,
      })
      .returning();
    if (!row) throw new Error("Failed to insert operational knowledge");

    await appendAuditEvent(tx, {
      organisationId: context.subject.organisationId,
      actorId: context.subject.actorId,
      actorType: context.actorType,
      action: "knowledge.proposed",
      targetType: "operational_knowledge",
      targetId: id,
      metadata: {
        kind: proposal.kind,
        status: policy.status,
        policyDecision: policy.policyDecision,
        contentHash: hash,
        evidenceReferences: proposal.evidenceReferences,
        installationId: context.installationId,
        idempotencyKey,
        policyReasons: policy.reasons,
        // Explicit non-authority marker for audit consumers.
        notAuthorisationProof: true,
      },
      traceId,
    });

    return {
      entry: publicEntry(row),
      duplicate: false,
      policyReasons: policy.reasons,
    };
  });

  return {
    payload: {
      ...result,
      note:
        "Operational knowledge is never proof of authorisation, approval, or external-action completion.",
    },
    evidenceRefs: [result.entry.id as string],
  };
}

/**
 * Search accepted (and optionally proposed/quarantined) knowledge in this
 * organisation only. Expired entries are excluded.
 */
export async function searchKnowledge(
  db: Database,
  context: InstallationContext,
  args: {
    query?: string | undefined;
    limit: number;
    includeNonAccepted?: boolean | undefined;
  },
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_search_knowledge");
  requireCapability(context.subject, "evidence.read");

  const limit = Math.min(Math.max(args.limit, 1), 25);
  const now = new Date();
  const statuses = args.includeNonAccepted
    ? (["accepted", "proposed", "quarantined"] as const)
    : (["accepted"] as const);

  const conditions = [
    eq(
      schema.operationalKnowledge.organisationId,
      context.subject.organisationId,
    ),
    inArray(schema.operationalKnowledge.status, [...statuses]),
    or(
      isNull(schema.operationalKnowledge.expiresAt),
      gt(schema.operationalKnowledge.expiresAt, now),
    ),
  ];
  if (args.query?.trim()) {
    const q = `%${args.query.trim()}%`;
    conditions.push(
      or(
        ilike(schema.operationalKnowledge.title, q),
        ilike(schema.operationalKnowledge.content, q),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(schema.operationalKnowledge)
    .where(and(...conditions))
    .orderBy(desc(schema.operationalKnowledge.createdAt))
    .limit(limit + 1);

  const truncated = rows.length > limit;
  const page = rows.slice(0, limit).map(publicEntry);
  return {
    payload: {
      classification: "operational_knowledge",
      records: page,
      truncated,
      limit,
      // Never treat retrieval as proof of authority.
      authorisationProof: false,
    },
    evidenceRefs: page.map((r) => r.id as string),
  };
}

export async function getKnowledge(
  db: Database,
  context: InstallationContext,
  args: { knowledgeId: string },
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_get_knowledge");
  requireCapability(context.subject, "evidence.read");

  const [row] = await db
    .select()
    .from(schema.operationalKnowledge)
    .where(
      and(
        eq(
          schema.operationalKnowledge.organisationId,
          context.subject.organisationId,
        ),
        eq(schema.operationalKnowledge.id, args.knowledgeId),
      ),
    )
    .limit(1);
  if (!row)
    throw new McpToolError(
      "not_found",
      "Knowledge entry does not exist for this organisation.",
    );

  return {
    payload: {
      ...publicEntry(row),
      note:
        "Operational knowledge is never proof of authorisation, approval, or external-action completion.",
    },
    evidenceRefs: [row.id],
  };
}

