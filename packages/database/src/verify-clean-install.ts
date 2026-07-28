import { count } from "drizzle-orm";
import { closeDatabase, database, schema } from "./index.ts";

const operationalTables = {
  alerts: schema.alerts,
  investigations: schema.investigations,
  messages: schema.messages,
  reactions: schema.reactions,
  hypotheses: schema.hypotheses,
  findings: schema.findings,
  decisions: schema.decisions,
  approvals: schema.approvals,
  agentReadinessSnapshots: schema.agentReadinessSnapshots,
  agentRuns: schema.agentRuns,
  agentRunEvents: schema.agentRunEvents,
  agentRunSources: schema.agentRunSources,
  agentToolCalls: schema.agentToolCalls,
  agentMemories: schema.agentMemories,
  agentSkills: schema.agentSkills,
  agentSkillVersions: schema.agentSkillVersions,
  agentSkillEvaluations: schema.agentSkillEvaluations,
  workflowRuns: schema.workflowRuns,
  evidence: schema.evidence,
  timelineEvents: schema.timelineEvents,
  notifications: schema.notifications,
  tasks: schema.tasks,
  integrationRecords: schema.integrationRecords,
  integrationEntities: schema.integrationEntities,
  integrationDeliveries: schema.integrationDeliveries,
  integrationConnectorCredentials: schema.integrationConnectorCredentials,
  integrationQueryTemplates: schema.integrationQueryTemplates,
  integrationQueryRuns: schema.integrationQueryRuns,
  slackInstallations: schema.slackInstallations,
  slackIdentityMappings: schema.slackIdentityMappings,
  slackAgentExposures: schema.slackAgentExposures,
  slackInboxEvents: schema.slackInboxEvents,
  slackRunDeliveries: schema.slackRunDeliveries,
  huntRuns: schema.huntRuns,
  huntQueries: schema.huntQueries,
  researchWatchlists: schema.researchWatchlists,
  researchRuns: schema.researchRuns,
  researchItems: schema.researchItems,
  idempotencyRecords: schema.idempotencyRecords,
  outboxEvents: schema.outboxEvents,
  auditEvents: schema.auditEvents,
  mcpInstallations: schema.mcpInstallations,
  operationalKnowledge: schema.operationalKnowledge,
  governedMissions: schema.governedMissions,
  governedMissionRuns: schema.governedMissionRuns,
} as const;

const db = database();
const counts = await Promise.all(
  Object.entries(operationalTables).map(async ([name, table]) => {
    const [result] = await db.select({ value: count() }).from(table);
    return [name, result?.value ?? 0] as const;
  }),
);
const populated = counts.filter(([, value]) => value !== 0);

await closeDatabase();

if (populated.length > 0) {
  throw new Error(
    `Clean-install verification failed: ${populated
      .map(([name, value]) => `${name}=${value}`)
      .join(", ")}`,
  );
}

process.stdout.write(
  `Clean-install verification passed (${counts.length} operational tables empty).\n`,
);
