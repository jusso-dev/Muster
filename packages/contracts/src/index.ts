import { z } from "zod";

export const severityValues = [
  "critical",
  "high",
  "medium",
  "low",
  "informational",
] as const;
export const tlpValues = ["clear", "green", "amber", "amber-strict", "red"] as const;
export const papValues = ["clear", "green", "amber", "red"] as const;
export const actorTypeValues = ["human", "agent", "product", "service", "system"] as const;
export const roomTypeValues = [
  "operations",
  "incident",
  "investigation",
  "hunt",
  "engineering",
  "private",
  "direct",
  "system",
] as const;
export const messageTypeValues = [
  "text",
  "system",
  "alert",
  "finding",
  "decision",
  "approval",
  "workflow",
  "agent-status",
  "query-result",
  "evidence",
  "case-event",
  "response-action",
] as const;
export const alertStatusValues = [
  "new",
  "acknowledged",
  "investigating",
  "dismissed",
  "promoted",
  "closed",
] as const;
export const investigationStatusValues = [
  "open",
  "triaging",
  "investigating",
  "awaiting_approval",
  "promoted",
  "closed",
] as const;
export const approvalStatusValues = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "executed",
  "failed",
] as const;

export const SeveritySchema = z.enum(severityValues);
export const TlpSchema = z.enum(tlpValues);
export const PapSchema = z.enum(papValues);
export const ActorTypeSchema = z.enum(actorTypeValues);
export const RoomTypeSchema = z.enum(roomTypeValues);
export const MessageTypeSchema = z.enum(messageTypeValues);
export const AlertStatusSchema = z.enum(alertStatusValues);
export const InvestigationStatusSchema = z.enum(investigationStatusValues);
export const ApprovalStatusSchema = z.enum(approvalStatusValues);

export const msepEventTypes = [
  "telemetry.candidate.received",
  "telemetry.policy.accepted",
  "telemetry.policy.rejected",
  "telemetry.delivery.succeeded",
  "telemetry.delivery.failed",
  "telemetry.source.stale",
  "endpoint.enrolled",
  "endpoint.online",
  "endpoint.offline",
  "endpoint.alert.created",
  "endpoint.hunt.completed",
  "endpoint.response.requested",
  "endpoint.response.completed",
  "alert.created",
  "alert.acknowledged",
  "alert.dismissed",
  "alert.promoted",
  "investigation.created",
  "investigation.alert.linked",
  "investigation.hypothesis.created",
  "investigation.finding.added",
  "investigation.query.executed",
  "investigation.decision.recorded",
  "investigation.promoted",
  "investigation.closed",
  "case.linked",
  "case.created",
  "case.state.changed",
  "case.observable.added",
  "case.task.created",
  "case.evidence.attached",
  "case.closed",
  "room.created",
  "room.message.created",
  "room.thread.created",
  "room.reaction.created",
  "room.item.pinned",
  "agent.invocation.requested",
  "agent.invocation.started",
  "agent.tool.called",
  "agent.finding.created",
  "agent.approval.requested",
  "agent.invocation.completed",
  "agent.invocation.failed",
  "workflow.started",
  "workflow.step.started",
  "workflow.step.completed",
  "workflow.approval.requested",
  "workflow.completed",
  "workflow.failed",
  "decision.recorded",
  "knowledge.created",
  "detection.proposed",
  "detection.published",
] as const;

export const MsepEventTypeSchema = z.enum(msepEventTypes);
export type MsepEventType = z.infer<typeof MsepEventTypeSchema>;

export const EvidenceReferenceSchema = z.object({
  type: z.string().min(1).max(120),
  reference: z.string().min(1).max(500),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
});

export const MsepEnvelopeSchema = z
  .object({
    specVersion: z.literal("muster.security/v1"),
    id: z.string().min(8).max(100),
    type: MsepEventTypeSchema,
    source: z.object({
      product: z.string().min(1).max(80),
      instanceId: z.string().min(1).max(160),
      organisationId: z.string().uuid(),
    }),
    subject: z.object({
      type: z.string().min(1).max(80),
      id: z.string().min(1).max(300),
    }),
    occurredAt: z.iso.datetime({ offset: true }),
    receivedAt: z.iso.datetime({ offset: true }),
    classification: z.object({
      severity: SeveritySchema,
      tlp: TlpSchema,
      pap: PapSchema,
    }),
    correlation: z.object({
      caseId: z.string().uuid().nullable(),
      investigationId: z.string().uuid().nullable(),
      traceId: z.string().min(8).max(160),
    }),
    data: z.record(z.string(), z.unknown()),
    evidence: z.array(EvidenceReferenceSchema).max(100).default([]),
    integrity: z.object({
      issuer: z.string().min(1).max(160),
      algorithm: z.literal("hmac-sha256").default("hmac-sha256"),
      keyId: z.string().min(1).max(160),
      signature: z.string().min(32).max(512),
    }),
  })
  .strict();

export type MsepEnvelope = z.infer<typeof MsepEnvelopeSchema>;

export const ProblemSchema = z.object({
  type: z.string().default("about:blank"),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  traceId: z.string(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export const AgentInvestigationJobSchema = z.object({
  organisationId: z.string().uuid(),
  investigationId: z.string().uuid(),
  agentId: z.string().uuid(),
  requestedByActorId: z.string().uuid(),
  traceId: z.string().min(8),
});
export type AgentInvestigationJob = z.infer<typeof AgentInvestigationJobSchema>;

export const queueNames = [
  "muster-ingestion",
  "muster-integrations",
  "muster-agents",
  "muster-workflows",
  "muster-notifications",
  "muster-evidence",
  "muster-search",
  "muster-maintenance",
  "muster-outbox",
] as const;
export type QueueName = (typeof queueNames)[number];

const structuredFindingBase = z.object({
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(10_000),
  confidence: z.number().min(0).max(1),
  evidenceReferences: z.array(EvidenceReferenceSchema).max(100),
  recommendedActions: z.array(z.string().max(500)).max(20),
});

export const TriageRecommendationSchema = structuredFindingBase.extend({
  disposition: z.enum(["dismiss", "monitor", "investigate", "promote"]),
  severity: SeveritySchema,
  rationale: z.string().min(1).max(10_000),
});
export const ThreatIntelFindingSchema = structuredFindingBase.extend({
  indicators: z.array(
    z.object({
      type: z.enum(["ip", "domain", "url", "hash"]),
      value: z.string(),
      reputation: z.enum(["malicious", "suspicious", "unknown", "benign"]),
    }),
  ),
});
export const EndpointHuntResultSchema = structuredFindingBase.extend({
  endpointId: z.string(),
  processCount: z.number().int().nonnegative(),
  networkCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
});
export const TelemetryGapFindingSchema = structuredFindingBase.extend({
  collectorId: z.string(),
  affectedSources: z.array(z.string()),
  firstObservedAt: z.iso.datetime({ offset: true }),
});
export const CasePromotionDraftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  severity: SeveritySchema,
  tlp: TlpSchema,
  pap: PapSchema,
  classification: z.string(),
  observableReferences: z.array(z.string()),
  evidenceReferences: z.array(EvidenceReferenceSchema),
  suggestedPlaybook: z.string().nullable(),
});
export const DetectionProposalSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  sigmaYaml: z.string(),
  kql: z.string(),
  testEvidenceReferences: z.array(EvidenceReferenceSchema),
});
export const EvidenceBundleManifestSchema = z.object({
  bundleId: z.string().uuid(),
  generatedAt: z.iso.datetime({ offset: true }),
  items: z.array(
    z.object({
      evidenceId: z.string().uuid(),
      sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
      size: z.number().int().nonnegative(),
    }),
  ),
});
export const PostIncidentSummarySchema = z.object({
  summary: z.string(),
  impact: z.string(),
  rootCause: z.string(),
  timelineHighlights: z.array(z.string()),
  lessons: z.array(z.string()),
  followUpActions: z.array(z.string()),
  evidenceReferences: z.array(EvidenceReferenceSchema),
});
export const ExecutiveUpdateSchema = z.object({
  headline: z.string().max(180),
  status: z.enum(["investigating", "contained", "monitoring", "resolved"]),
  impact: z.string().max(2_000),
  actions: z.array(z.string().max(500)).max(10),
  nextUpdateAt: z.iso.datetime({ offset: true }).nullable(),
});

export const AgentStructuredOutputSchemas = {
  TriageRecommendation: TriageRecommendationSchema,
  ThreatIntelFinding: ThreatIntelFindingSchema,
  EndpointHuntResult: EndpointHuntResultSchema,
  TelemetryGapFinding: TelemetryGapFindingSchema,
  CasePromotionDraft: CasePromotionDraftSchema,
  DetectionProposal: DetectionProposalSchema,
  EvidenceBundleManifest: EvidenceBundleManifestSchema,
  PostIncidentSummary: PostIncidentSummarySchema,
  ExecutiveUpdate: ExecutiveUpdateSchema,
} as const;

export type AgentStructuredOutputName = keyof typeof AgentStructuredOutputSchemas;

export const WorkflowStepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
    action: z.string().optional(),
    agent: z.string().optional(),
    query: z.string().optional(),
    condition: z.string().optional(),
    approval: z
      .object({
        capability: z.string(),
        timeout: z.string().regex(/^\d+(s|m|h|d)$/),
        count: z.number().int().positive().default(1),
      })
      .optional(),
    delay: z.string().optional(),
    notification: z.string().optional(),
    parallel: z.array(WorkflowStepSchema).optional(),
    foreach: z
      .object({ in: z.string(), steps: z.array(WorkflowStepSchema) })
      .optional(),
    subworkflow: z.string().optional(),
    permissions: z.array(z.string()).default([]),
    outputSchema: z.string().optional(),
    when: z.string().optional(),
  }),
);

export interface WorkflowStep {
  id: string;
  action?: string | undefined;
  agent?: string | undefined;
  query?: string | undefined;
  condition?: string | undefined;
  approval?: { capability: string; timeout: string; count?: number | undefined } | undefined;
  delay?: string | undefined;
  notification?: string | undefined;
  parallel?: WorkflowStep[] | undefined;
  foreach?: { in: string; steps: WorkflowStep[] } | undefined;
  subworkflow?: string | undefined;
  permissions?: string[] | undefined;
  outputSchema?: string | undefined;
  when?: string | undefined;
}

export const WorkflowDefinitionSchema = z
  .object({
    apiVersion: z.literal("muster.security/v1"),
    kind: z.literal("Workflow"),
    metadata: z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
      name: z.string().min(1).max(200),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
    }),
    trigger: z
      .object({
        eventType: MsepEventTypeSchema.optional(),
        conditions: z.record(z.string(), z.unknown()).default({}),
      })
      .optional(),
    steps: z.array(WorkflowStepSchema).min(1).max(100),
  })
  .strict();
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
