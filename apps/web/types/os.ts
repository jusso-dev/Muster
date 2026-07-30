import type {
  ApprovalState,
  HealthState,
  OperationalState,
  Severity,
} from "./status";

export type DataSource = "api" | "fixture";

export type SessionContext = {
  actor: {
    id: string;
    displayName: string;
    email: string | null;
    actorType: "human" | "agent" | "system";
  };
  organisation: {
    id: string;
    name: string;
    slug: string;
    status: string;
    dataRegion: string;
    timezone: string;
  };
  /** Capability names assigned to the actor (server-authoritative). */
  capabilities: string[];
  environment: string;
  /** Future multi-org; foundation returns current only. */
  organisations: Array<{ id: string; name: string; slug: string }>;
  /** Placeholder for future customer context. */
  customer: { id: string; name: string } | null;
};

/**
 * Change against the immediately preceding window of the same length. Only
 * present where the database can answer the comparison — a tile with no
 * honest history shows no trend rather than a decorative arrow.
 */
export type MetricTrend = {
  delta: number;
  direction: "up" | "down" | "flat";
  /** What the comparison was, e.g. "vs previous 24h". */
  label: string;
  /** Which direction is the good news, so colour never guesses. */
  improving: "up" | "down" | "neutral";
};

export type CommandMetric = {
  id: string;
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
  href?: string;
  trend?: MetricTrend;
  /** Oldest → newest daily counts behind the tile. Omitted when unknown. */
  series?: number[];
  /** What the series counts, for the sparkline's accessible description. */
  seriesLabel?: string;
};

/** Live distribution of work items by status — the donut is not a sample. */
export type TaskStatusSlice = {
  status: string;
  label: string;
  count: number;
};

/** Hourly agent-run buckets over the last 24 hours. */
export type RunActivityPoint = {
  /** ISO timestamp for the start of the bucket. */
  bucket: string;
  /** Short axis label, local time. */
  label: string;
  completed: number;
  failed: number;
  running: number;
  cancelled: number;
};

export type AgentActivityRow = {
  id: string;
  name: string;
  status: string;
  runtime: string;
  runs: number;
  succeeded: number;
  /** Null when the agent has no completed runs in the window. */
  successRate: number | null;
  lastRunAt: string | null;
};

export type MyTaskRow = {
  id: string;
  title: string;
  status: OperationalState;
  rawStatus: string;
  priority: string;
  severity: Severity;
  sourceSystem: string;
  updatedAt: string;
  dueAt: string | null;
  assignedToMe: boolean;
};

export type IntegrationHealthChip = {
  id: string;
  name: string;
  health: HealthState;
  detail: string;
};

export type AttentionItem = {
  id: string;
  title: string;
  type: string;
  severity: Severity;
  organisationName?: string;
  customerName?: string | null;
  owner?: string | null;
  age: string;
  sourceSystem: string;
  recommendedAction: string;
  href?: string;
};

export type RiskRadarCell = {
  id: string;
  label: string;
  summary: string;
  health: HealthState;
  count?: number;
};

export type ActivityEvent = {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  outcome?: string;
  href?: string;
};

export type WorkItemCategory =
  | "incident"
  | "alert_investigation"
  | "threat_hunt"
  | "detection_change"
  | "vulnerability_remediation"
  | "evidence_request"
  | "assessment_finding"
  | "customer_request"
  | "connector_issue"
  | "research_brief"
  | "internal_task";

export type WorkItem = {
  id: string;
  title: string;
  description: string;
  category: WorkItemCategory;
  organisationId: string;
  customerName?: string | null;
  severity: Severity;
  priority: string;
  status: OperationalState;
  ownerName?: string | null;
  assignedAgentName?: string | null;
  sourceSystem: string;
  externalRecordId?: string | null;
  externalRecordUrl?: string | null;
  systemOfRecord: string;
  slaTarget?: string | null;
  dueAt?: string | null;
  createdAt: string;
  updatedAt: string;
  approvalState: ApprovalState;
  missionId?: string | null;
  tags: string[];
  source: DataSource;
};

export type MissionSummary = {
  id: string;
  name: string;
  description: string;
  status: string;
  capabilityEnvelope: string[];
  scheduleHint: string | null;
  hermesProfile: string | null;
  killSwitch: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MissionRunSummary = {
  id: string;
  missionId: string;
  status: string;
  idempotencyKey: string;
  hermesProfile: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuditEventSummary = {
  id: string;
  sequence: number;
  actorId: string;
  actorType: string;
  actorName?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome?: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  traceId: string;
  createdAt: string;
  eventHash: string;
};

export type IntegrationCard = {
  id: string;
  name: string;
  product: string;
  enabled: boolean;
  health: HealthState;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastExecutionAt: string | null;
  authState: string;
  capabilities: string[];
  recentError: string | null;
  owner: string | null;
  source: DataSource;
};

export type CapabilityPack = {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  category: string;
  installed: boolean;
  enabled: boolean;
  validationStatus: "valid" | "invalid" | "unknown";
  requiredConnectors: string[];
  allowedAgentRoles: string[];
  approvalRequired: boolean;
  dataClassification: string;
  origin: DataSource;
};

export type TeamSummary = {
  id: string;
  name: string;
  purpose: string;
  memberCount: number;
  agentCount: number;
  activeMissions: number;
  workload: number;
  origin: DataSource;
};

export type ApiEnvelope<T> = {
  data: T;
  traceId?: string;
  meta?: {
    source?: DataSource;
    truncated?: boolean;
    limit?: number;
  };
};

export type ProblemBody = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  traceId?: string;
};
