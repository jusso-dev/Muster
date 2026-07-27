import { z } from "zod";

export const severityValues = [
  "critical",
  "high",
  "medium",
  "low",
  "informational",
] as const;
export const tlpValues = [
  "clear",
  "green",
  "amber",
  "amber-strict",
  "red",
] as const;
export const papValues = ["clear", "green", "amber", "red"] as const;
export const actorTypeValues = [
  "human",
  "agent",
  "product",
  "service",
  "system",
] as const;
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
export const taskStatusValues = [
  "backlog",
  "ready",
  "in_progress",
  "review",
  "done",
] as const;
export const taskPriorityValues = ["urgent", "high", "normal", "low"] as const;

export const SeveritySchema = z.enum(severityValues);
export const TlpSchema = z.enum(tlpValues);
export const PapSchema = z.enum(papValues);
export const ActorTypeSchema = z.enum(actorTypeValues);
export const RoomTypeSchema = z.enum(roomTypeValues);
export const MessageTypeSchema = z.enum(messageTypeValues);
export const AlertStatusSchema = z.enum(alertStatusValues);
export const InvestigationStatusSchema = z.enum(investigationStatusValues);
export const ApprovalStatusSchema = z.enum(approvalStatusValues);
export const TaskStatusSchema = z.enum(taskStatusValues);
export const TaskPrioritySchema = z.enum(taskPriorityValues);

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
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

const AgentEvidenceReferenceSchema = z.object({
  type: z.string().min(1).max(120),
  reference: z.string().min(1).max(500),
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .nullable(),
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
  investigationId: z.string().uuid().nullable(),
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
  evidenceReferences: z.array(AgentEvidenceReferenceSchema).max(100),
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
export const HuntResultSchema = z.object({
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(10_000),
  question: z.string().min(1).max(4_000),
  trainingMode: z.boolean(),
  confidence: z.number().min(0).max(1),
  queries: z
    .array(
      z.object({
        source: z.string().min(1).max(160),
        templateKey: z.string().min(1).max(80),
        status: z.enum(["succeeded", "failed", "skipped"]),
        recordCount: z.number().int().nonnegative(),
        evidenceReferences: z.array(AgentEvidenceReferenceSchema).max(100),
        gap: z.string().max(1_000).nullable(),
      }),
    )
    .min(1)
    .max(20),
  observedFacts: z
    .array(
      z.object({
        statement: z.string().min(1).max(2_000),
        source: z.string().min(1).max(160),
        confidence: z.number().min(0).max(1),
        evidenceReferences: z
          .array(AgentEvidenceReferenceSchema)
          .min(1)
          .max(50),
      }),
    )
    .max(100),
  inferences: z
    .array(
      z.object({
        statement: z.string().min(1).max(2_000),
        basis: z.string().min(1).max(2_000),
        confidence: z.number().min(0).max(1),
        evidenceReferences: z.array(AgentEvidenceReferenceSchema).max(50),
      }),
    )
    .max(100),
  observables: z
    .array(
      z.object({
        type: z.enum([
          "ip",
          "domain",
          "url",
          "hash",
          "identity",
          "endpoint",
          "cloud_resource",
        ]),
        value: z.string().min(1).max(4_000),
        normalizedValue: z.string().min(1).max(4_000),
        confidence: z.number().min(0).max(1),
        evidenceReferences: z.array(AgentEvidenceReferenceSchema).max(50),
      }),
    )
    .max(200),
  attackMappings: z
    .array(
      z.object({
        techniqueId: z.string().regex(/^T\d{4}(?:\.\d{3})?$/),
        techniqueName: z.string().min(1).max(240),
        confidence: z.number().min(0).max(1),
        evidenceReferences: z
          .array(AgentEvidenceReferenceSchema)
          .min(1)
          .max(50),
        supportingReferences: z.array(z.url()).max(20),
      }),
    )
    .max(100),
  evidenceReferences: z.array(AgentEvidenceReferenceSchema).max(300),
  gaps: z.array(z.string().min(1).max(1_000)).max(50),
  recommendedNextSteps: z.array(z.string().min(1).max(1_000)).max(30),
  coachingNotes: z.array(z.string().min(1).max(1_000)).max(30),
  enrichmentProposal: z
    .object({
      caseId: z.string().min(1).max(200).nullable(),
      finding: z.string().min(1).max(10_000),
      timelineEntry: z.string().min(1).max(10_000),
      observables: z
        .array(
          z.object({
            type: z.enum([
              "ip",
              "domain",
              "url",
              "file_hash",
              "email",
              "hostname",
              "username",
              "registry_key",
              "other",
            ]),
            value: z.string().min(1).max(4_000),
            description: z.string().max(2_000),
          }),
        )
        .max(50),
      evidenceReferences: z.array(AgentEvidenceReferenceSchema).max(100),
    })
    .nullable(),
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
  evidenceReferences: z.array(AgentEvidenceReferenceSchema),
  suggestedPlaybook: z.string().nullable(),
});
export const DetectionProposalSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  sigmaYaml: z.string(),
  kql: z.string(),
  testEvidenceReferences: z.array(AgentEvidenceReferenceSchema),
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
  evidenceReferences: z.array(AgentEvidenceReferenceSchema),
});
export const ExecutiveUpdateSchema = z.object({
  headline: z.string().max(180),
  status: z.enum(["investigating", "contained", "monitoring", "resolved"]),
  impact: z.string().max(2_000),
  actions: z.array(z.string().max(500)).max(10),
  nextUpdateAt: z.iso.datetime({ offset: true }).nullable(),
});
export const ReportManifestSchema = z.object({
  version: z.literal("parker-report-v1"),
  audience: z.enum(["analyst", "leadership", "executive"]),
  period: z.object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
    comparisonPeriod: z
      .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
      .nullable(),
  }),
  filters: z.record(z.string(), z.unknown()),
  metricDefinitions: z.array(z.object({ key: z.string(), definition: z.string(), population: z.string(), exclusions: z.string() })).min(1),
  values: z.array(z.object({ key: z.string(), value: z.number().nullable(), unit: z.enum(["minutes", "percent", "count"]), state: z.enum(["available", "zero", "unavailable", "not_applicable"]), sampleSize: z.number().int().nonnegative() })).min(1),
  sourceReferences: z.array(z.object({ source: z.string(), query: z.record(z.string(), z.unknown()) })).min(1),
  narrative: z.string().min(1).max(10_000),
  caveats: z.array(z.string().min(1).max(1_000)).max(50),
  classification: z.enum(["internal", "restricted"]),
});

export const ResearchBriefSchema = z.object({
  version: z.literal("research-brief-v1"),
  source: z.object({
    name: z.string().min(1).max(160),
    url: z.url().max(2_000),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    retrievedAt: z.iso.datetime({ offset: true }),
    citation: z.string().min(1).max(2_000),
  }),
  title: z.string().min(1).max(500),
  summary: z.string().min(1).max(4_000),
  urgency: z.enum(["critical", "high", "medium", "low"]),
  confidence: z.number().int().min(0).max(100),
  affectedVendors: z.array(z.string().min(1).max(160)).max(50),
  affectedTechnologies: z.array(z.string().min(1).max(160)).max(50),
  matchedCaseIds: z.array(z.string().min(1).max(200)).max(50),
  conclusions: z
    .array(
      z.object({
        claim: z.string().min(1).max(1_000),
        evidence: z.array(AgentEvidenceReferenceSchema).min(1).max(20),
      }),
    )
    .min(1)
    .max(10),
  recommendedFollowUp: z.string().min(1).max(2_000),
  learningProposal: z
    .object({
      title: z.string().min(1).max(200),
      rationale: z.string().min(1).max(2_000),
    })
    .nullable(),
});

export const AgentStructuredOutputSchemas = {
  TriageRecommendation: TriageRecommendationSchema,
  ThreatIntelFinding: ThreatIntelFindingSchema,
  EndpointHuntResult: EndpointHuntResultSchema,
  HuntResult: HuntResultSchema,
  TelemetryGapFinding: TelemetryGapFindingSchema,
  CasePromotionDraft: CasePromotionDraftSchema,
  DetectionProposal: DetectionProposalSchema,
  EvidenceBundleManifest: EvidenceBundleManifestSchema,
  PostIncidentSummary: PostIncidentSummarySchema,
  ExecutiveUpdate: ExecutiveUpdateSchema,
  ResearchBrief: ResearchBriefSchema,
  ReportManifest: ReportManifestSchema,
} as const;

export type AgentStructuredOutputName =
  keyof typeof AgentStructuredOutputSchemas;

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
  approval?:
    | { capability: string; timeout: string; count?: number | undefined }
    | undefined;
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
