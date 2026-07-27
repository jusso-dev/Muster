import { createHash } from "node:crypto";
import { z } from "zod";
import {
  actionApprovalPolicy,
  hasCapability,
  type ApprovalAction,
  type AuthorisationSubject,
  type Capability,
} from "@muster/authz";
import {
  AgentStructuredOutputSchemas,
  type AgentStructuredOutputName,
} from "@muster/contracts";

export * from "./readiness.ts";

export const PromptPartSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("system_policy"),
    content: z.string().max(50_000),
  }),
  z.object({
    kind: z.literal("trusted_instruction"),
    content: z.string().max(50_000),
  }),
  z.object({
    kind: z.literal("human_request"),
    content: z.string().max(50_000),
  }),
  z.object({
    kind: z.literal("untrusted_evidence"),
    content: z.string().max(500_000),
    source: z.string().max(500),
  }),
  z.object({
    kind: z.literal("tool_result"),
    content: z.string().max(500_000),
    tool: z.string().max(200),
  }),
  z.object({
    kind: z.literal("approval_record"),
    content: z.string().max(20_000),
    approvalId: z.string().uuid(),
  }),
]);
export type PromptPart = z.infer<typeof PromptPartSchema>;

export interface RuntimePrompt {
  system: readonly string[];
  trustedInstructions: readonly string[];
  conversation: readonly { role: "user"; content: string }[];
  evidence: readonly { source: string; content: string }[];
  toolResults: readonly { tool: string; content: string }[];
  approvals: readonly { approvalId: string; content: string }[];
}

const secretPatterns = [
  /(authorization:\s*bearer\s+)[^\s]+/gi,
  /((?:api[_-]?key|client[_-]?secret|password)\s*[=:]\s*)[^\s,;]+/gi,
  /(-----BEGIN [A-Z ]+PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]+PRIVATE KEY-----)/g,
];

export function redactSecrets(value: string): string {
  return secretPatterns.reduce(
    (result, pattern) => result.replace(pattern, "$1[REDACTED]$2"),
    value,
  );
}

export function buildRuntimePrompt(
  parts: readonly PromptPart[],
): RuntimePrompt {
  const parsed = z.array(PromptPartSchema).max(1_000).parse(parts);
  const byKind = <K extends PromptPart["kind"]>(kind: K) =>
    parsed.filter(
      (part): part is Extract<PromptPart, { kind: K }> => part.kind === kind,
    );
  return {
    system: byKind("system_policy").map((part) => redactSecrets(part.content)),
    trustedInstructions: byKind("trusted_instruction").map((part) =>
      redactSecrets(part.content),
    ),
    conversation: byKind("human_request").map((part) => ({
      role: "user" as const,
      content: redactSecrets(part.content),
    })),
    evidence: byKind("untrusted_evidence").map((part) => ({
      source: part.source,
      content: redactSecrets(part.content),
    })),
    toolResults: byKind("tool_result").map((part) => ({
      tool: part.tool,
      content: redactSecrets(part.content),
    })),
    approvals: byKind("approval_record").map((part) => ({
      approvalId: part.approvalId,
      content: redactSecrets(part.content),
    })),
  };
}

export interface ToolDefinition {
  name: string;
  capability: Capability;
  mutation: boolean;
  approvalAction?: ApprovalAction;
  argumentSchema: z.ZodType;
  maximumRecords?: number;
  allowedUrlOrigins?: readonly string[];
}

export interface ToolExecutionContext {
  subject: AuthorisationSubject;
  allowedTools: ReadonlySet<string>;
  approvedActions: ReadonlyMap<ApprovalAction, string>;
}

export const agentToolRegistry = new Map<string, ToolDefinition>([
  [
    "alerts.read",
    {
      name: "alerts.read",
      capability: "alerts.read",
      mutation: false,
      argumentSchema: z.object({
        investigationId: z.string().uuid().nullable(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      maximumRecords: 100,
    },
  ],
  [
    "investigations.read",
    {
      name: "investigations.read",
      capability: "investigations.read",
      mutation: false,
      argumentSchema: z.object({ investigationId: z.string().uuid() }),
      maximumRecords: 1,
    },
  ],
  [
    "tawny.telemetry.read",
    {
      name: "tawny.telemetry.read",
      capability: "tawny.telemetry.read",
      mutation: false,
      argumentSchema: z.object({
        endpointId: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(1_000).default(100),
      }),
      maximumRecords: 1_000,
    },
  ],
  [
    "tawny.hunts.execute",
    {
      name: "tawny.hunts.execute",
      capability: "tawny.hunts.execute",
      mutation: false,
      argumentSchema: z.object({
        endpointIds: z.array(z.string().min(1).max(200)).min(1).max(100),
        query: z.string().min(1).max(2_000),
        limit: z.number().int().min(1).max(1_000).default(100),
      }),
      maximumRecords: 1_000,
    },
  ],
  [
    "audit.read",
    {
      name: "audit.read",
      capability: "audit.read",
      mutation: false,
      argumentSchema: z.object({
        targetId: z.string().min(1).max(200).nullable(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      maximumRecords: 100,
    },
  ],
  [
    "research.feeds.read",
    {
      name: "research.feeds.read",
      capability: "research.feeds.read",
      mutation: false,
      argumentSchema: z.object({
        source: z.string().min(1).max(160),
        url: z.url().max(2_000),
      }),
      maximumRecords: 200,
      allowedUrlOrigins: ["https://www.cisa.gov"],
    },
  ],
  [
    "tawny.endpoint.isolate",
    {
      name: "tawny.endpoint.isolate",
      capability: "tawny.response.isolate_host",
      mutation: true,
      approvalAction: "endpoint.isolate",
      argumentSchema: z.object({
        endpointId: z.string().min(1).max(200),
        reason: z.string().min(10).max(1_000),
      }),
    },
  ],
  [
    "evidence.delete",
    {
      name: "evidence.delete",
      capability: "evidence.export",
      mutation: true,
      approvalAction: "evidence.delete",
      argumentSchema: z.object({ evidenceId: z.string().uuid() }),
    },
  ],
]);

export function registeredTool(name: string): ToolDefinition {
  const tool = agentToolRegistry.get(name);
  if (!tool) throw new Error(`Unknown agent tool: ${name}`);
  return tool;
}

export function authoriseToolCall(
  tool: ToolDefinition,
  input: unknown,
  context: ToolExecutionContext,
): unknown {
  if (!context.allowedTools.has(tool.name))
    throw new Error("Tool is not allowlisted");
  if (!hasCapability(context.subject, tool.capability)) {
    throw new Error(`Missing tool capability: ${tool.capability}`);
  }
  if (tool.mutation) {
    if (!tool.approvalAction)
      throw new Error("Mutating tool lacks approval policy");
    const policy = actionApprovalPolicy[tool.approvalAction];
    if ("prohibited" in policy && policy.prohibited) {
      throw new Error("Tool action is prohibited");
    }
    if (!context.approvedActions.has(tool.approvalAction)) {
      throw new Error("Tool action requires human approval");
    }
  }
  return tool.argumentSchema.parse(input);
}

export function validateToolUrl(
  url: string,
  allowedOrigins: readonly string[],
): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("Tool URL must use HTTPS");
  }
  if (!allowedOrigins.includes(parsed.origin)) {
    throw new Error("Tool URL origin is not allowlisted");
  }
  return parsed;
}

export function validateStructuredOutput(
  schemaName: AgentStructuredOutputName,
  output: unknown,
) {
  const parsed = AgentStructuredOutputSchemas[schemaName].parse(output);
  return {
    parsed,
    sha256: createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
  };
}

export const AgentLearningNoteSchema = z.object({
  kind: z.enum(["fact", "preference", "lesson", "failure", "procedure_hint"]),
  title: z.string().min(3).max(160),
  content: z.string().min(1).max(20_000),
  evidenceReferences: z.array(z.string().min(1).max(500)).min(1).max(50),
  confidence: z.number().int().min(0).max(100),
  expiresAt: z.iso.datetime().nullable().default(null),
});

export const AgentSkillProposalSchema = z.object({
  skillKey: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  name: z.string().min(3).max(120),
  description: z.string().min(10).max(500),
  content: z.string().min(100).max(100_000),
  changeRationale: z.string().min(10).max(2_000),
  evidenceReferences: z.array(z.string().min(1).max(500)).min(1).max(100),
  requiredCapabilities: z.array(z.string()).max(50),
  allowedTools: z.array(z.string()).max(50),
});

export type AgentLearningNote = z.infer<typeof AgentLearningNoteSchema>;
export type AgentSkillProposal = z.infer<typeof AgentSkillProposalSchema>;

export function prepareSkillProposal(input: unknown) {
  const proposal = AgentSkillProposalSchema.parse(input);
  return {
    ...proposal,
    contentHash: createHash("sha256").update(proposal.content).digest("hex"),
    state: "proposed" as const,
    trusted: false as const,
  };
}

export interface SkillEvaluation {
  passed: boolean;
  score: number;
  baselineScore?: number;
  regressions: readonly string[];
}

export function mayPublishSkill(
  evaluation: SkillEvaluation,
  humanApproved: boolean,
): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!evaluation.passed) reasons.push("Evaluation suite failed");
  if (evaluation.score < 80) reasons.push("Evaluation score is below 80");
  if (
    evaluation.baselineScore !== undefined &&
    evaluation.score < evaluation.baselineScore
  ) {
    reasons.push("Proposed skill regresses from its baseline");
  }
  if (evaluation.regressions.length > 0) reasons.push("Regressions remain");
  if (!humanApproved) reasons.push("Human approval is required");
  return { allowed: reasons.length === 0, reasons };
}

const unsafeSkillPatterns = [
  /ignore (all|any|the|prior|previous) (policy|instructions?)/i,
  /self[- ]?authori[sz]e/i,
  /(grant|add|expand|bypass).{0,40}(permission|capabilit|tool|policy)/i,
  /(disable|remove).{0,20}(approval|audit|sandbox|tenant)/i,
  /treat.{0,40}(telemetry|evidence|tool result).{0,20}instructions?/i,
];

export function evaluateSkillProposal(
  input: unknown,
  policy: {
    allowedTools: readonly string[];
    allowedCapabilities: readonly string[];
    baselineScore?: number;
  },
): SkillEvaluation & { diagnostics: string[]; suite: string } {
  const proposal = AgentSkillProposalSchema.parse(input);
  const diagnostics = unsafeSkillPatterns
    .filter((pattern) => pattern.test(proposal.content))
    .map((pattern) => `Unsafe instruction pattern: ${pattern.source}`);
  for (const tool of proposal.allowedTools) {
    if (!policy.allowedTools.includes(tool)) {
      diagnostics.push(`Tool permission expansion denied: ${tool}`);
    }
  }
  for (const capability of proposal.requiredCapabilities) {
    if (!policy.allowedCapabilities.includes(capability)) {
      diagnostics.push(`Capability expansion denied: ${capability}`);
    }
  }
  const score = Math.max(0, 100 - diagnostics.length * 25);
  return {
    suite: "muster-agent-security-v1",
    passed: diagnostics.length === 0 && score >= 80,
    score,
    ...(policy.baselineScore !== undefined
      ? { baselineScore: policy.baselineScore }
      : {}),
    regressions: diagnostics,
    diagnostics,
  };
}
