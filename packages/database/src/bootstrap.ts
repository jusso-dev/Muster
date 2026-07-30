import { sql } from "drizzle-orm";
import { closeDatabase, database, schema } from "./index.ts";
import { bootstrapEnvironmentConnectors } from "./bootstrap-connectors.ts";
import { starterIds } from "./seed-data.ts";

const db = database();
const organisationName =
  process.env.MUSTER_ORGANISATION_NAME?.trim() || "Muster Workspace";
const organisationSlug =
  process.env.MUSTER_ORGANISATION_SLUG?.trim() || "muster";
const administratorEmail =
  process.env.MUSTER_LOCAL_ADMIN_EMAIL?.trim() || "admin@muster.local";
const administratorCapabilities = [
  "administration.manage",
  "rooms.read",
  "rooms.create",
  "rooms.manage",
  "messages.create",
  "messages.moderate",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "tasks.assign",
  "alerts.read",
  "alerts.acknowledge",
  "alerts.dismiss",
  "alerts.promote",
  "investigations.read",
  "investigations.create",
  "investigations.update",
  "investigations.promote",
  "investigations.close",
  "kelpie.cases.read",
  "kelpie.cases.create",
  "kelpie.cases.update",
  "tawny.telemetry.read",
  "tawny.hunts.execute",
  "unifi.network.read",
  "tawny.response.kill_process",
  "tawny.response.isolate_host",
  "bower.fleet.read",
  "bower.policy.read",
  "bower.policy.propose",
  "bower.policy.publish",
  "sentinel.query.execute",
  "sentinel.rules.read",
  "sentinel.rules.publish",
  "research.feeds.read",
  "agents.read",
  "agents.invoke",
  "agents.manage",
  "agents.cancel",
  "agents.handoff",
  "workflows.read",
  "workflows.execute",
  "workflows.approve",
  "workflows.manage",
  "evidence.read",
  "evidence.upload",
  "evidence.export",
  "audit.read",
  "audit.export",
];

await db
  .insert(schema.organisations)
  .values({
    id: starterIds.organisation,
    name: organisationName,
    slug: organisationSlug,
    dataRegion: process.env.MUSTER_DATA_REGION?.trim() || "local",
    defaultTimezone: process.env.MUSTER_DEFAULT_TIMEZONE?.trim() || "UTC",
    retentionPolicy: { messagesDays: 365, auditDays: 2555 },
    authenticationPolicy: {
      requireMfaForPrivilegedRoles: false,
      roomGovernance: {
        createOrganisationRooms: "capability",
        createPrivateRooms: "capability",
        inviteGuests: "room_policy",
        inviteAgents: "room_policy",
      },
    },
  })
  .onConflictDoUpdate({
    target: schema.organisations.id,
    set: {
      name: organisationName,
      slug: organisationSlug,
      dataRegion: process.env.MUSTER_DATA_REGION?.trim() || "local",
      defaultTimezone: process.env.MUSTER_DEFAULT_TIMEZONE?.trim() || "UTC",
    },
  });

await db
  .insert(schema.actors)
  .values([
    {
      id: starterIds.actors.jordan,
      organisationId: starterIds.organisation,
      actorType: "human",
      displayName: "Muster Administrator",
      identityReference: administratorEmail,
      capabilityAssignments: administratorCapabilities,
    },
    {
      id: starterIds.actors.triage,
      organisationId: starterIds.organisation,
      actorType: "agent",
      displayName: "Alfie",
      identityReference: "agent:alfie-threat-research",
      capabilityAssignments: [
        "alerts.read",
        "investigations.read",
        "kelpie.cases.read",
        "sentinel.rules.read",
        "research.feeds.read",
        "agents.handoff",
      ],
    },
    {
      id: starterIds.actors.tawnyHunt,
      organisationId: starterIds.organisation,
      actorType: "agent",
      displayName: "Jessie",
      identityReference: "agent:jessie-hunt",
      capabilityAssignments: [
        "alerts.read",
        "investigations.read",
        "investigations.update",
        "kelpie.cases.read",
        "kelpie.cases.update",
        "tawny.telemetry.read",
        "tawny.hunts.execute",
        "unifi.network.read",
        "sentinel.query.execute",
        "agents.handoff",
      ],
    },
    {
      id: starterIds.actors.threatIntel,
      organisationId: starterIds.organisation,
      actorType: "agent",
      displayName: "Parker",
      identityReference: "agent:parker-executive",
      capabilityAssignments: [
        "alerts.read",
        "investigations.read",
        "kelpie.cases.read",
        "audit.read",
        "agents.handoff",
      ],
    },
    {
      id: starterIds.actors.system,
      organisationId: starterIds.organisation,
      actorType: "system",
      displayName: "Muster",
      identityReference: "system:muster",
      capabilityAssignments: [],
    },
  ])
  .onConflictDoUpdate({
    target: schema.actors.id,
    set: {
      displayName: sql`excluded.display_name`,
      identityReference: sql`excluded.identity_reference`,
      capabilityAssignments: sql`excluded.capability_assignments`,
    },
  });

await db
  .insert(schema.agentDefinitions)
  .values([
    {
      id: starterIds.actors.triage,
      organisationId: starterIds.organisation,
      name: "Alfie",
      description:
        "Researches approved public and vendor sources and produces evidence-backed security briefs.",
      runtime: "codex-subscription",
      model: process.env.MUSTER_CODEX_MODEL?.trim() || "configured",
      ownerActorId: starterIds.actors.jordan,
      systemPromptVersion: "alfie-v1",
      allowedTools: [
        "alerts.read",
        "kelpie.cases.read",
        "sentinel.rules.read",
        "research.feeds.read",
      ],
      allowedRooms: [starterIds.rooms.soc, starterIds.rooms.triageDirect],
      capabilityRequirements: [
        "alerts.read",
        "kelpie.cases.read",
        "sentinel.rules.read",
        "research.feeds.read",
      ],
      maximumRuntimeSeconds: 900,
      maximumTokenBudget: 30_000,
      maximumCostCents: 500,
      approvalRequirements: { externalWrites: "human" },
    },
    {
      id: starterIds.actors.tawnyHunt,
      organisationId: starterIds.organisation,
      name: "Jessie",
      description:
        "Runs bounded threat hunts, maps observables to ATT&CK, and prepares governed case enrichment.",
      runtime: "codex-subscription",
      model: process.env.MUSTER_CODEX_MODEL?.trim() || "configured",
      ownerActorId: starterIds.actors.jordan,
      systemPromptVersion: "jessie-v1",
      allowedTools: [
        "tawny.telemetry.read",
        "tawny.hunts.execute",
        "unifi.network.read",
        "sentinel.query.execute",
        "kelpie.cases.read",
      ],
      allowedRooms: [starterIds.rooms.soc, starterIds.rooms.tawnyDirect],
      capabilityRequirements: [
        "tawny.telemetry.read",
        "tawny.hunts.execute",
        "unifi.network.read",
        "sentinel.query.execute",
        "kelpie.cases.read",
      ],
      maximumRuntimeSeconds: 1_800,
      maximumTokenBudget: 40_000,
      maximumCostCents: 750,
      approvalRequirements: { externalWrites: "human" },
    },
    {
      id: starterIds.actors.threatIntel,
      organisationId: starterIds.organisation,
      name: "Parker",
      description:
        "Builds reproducible operational reports and executive briefings from authoritative records.",
      runtime: "codex-subscription",
      model: process.env.MUSTER_CODEX_MODEL?.trim() || "configured",
      ownerActorId: starterIds.actors.jordan,
      systemPromptVersion: "parker-v1",
      allowedTools: [
        "alerts.read",
        "investigations.read",
        "kelpie.cases.read",
        "audit.read",
      ],
      allowedRooms: [starterIds.rooms.soc, starterIds.rooms.parkerDirect],
      capabilityRequirements: [
        "alerts.read",
        "investigations.read",
        "kelpie.cases.read",
        "audit.read",
      ],
      maximumRuntimeSeconds: 1_200,
      maximumTokenBudget: 35_000,
      maximumCostCents: 600,
      approvalRequirements: { externalWrites: "human" },
    },
  ])
  .onConflictDoUpdate({
    target: [
      schema.agentDefinitions.organisationId,
      schema.agentDefinitions.name,
    ],
    set: {
      description: sql`excluded.description`,
      model: sql`excluded.model`,
      allowedTools: sql`excluded.allowed_tools`,
      allowedRooms: sql`excluded.allowed_rooms`,
      capabilityRequirements: sql`excluded.capability_requirements`,
      approvalRequirements: sql`excluded.approval_requirements`,
      updatedAt: sql`now()`,
    },
  });

await db
  .insert(schema.rooms)
  .values([
    {
      id: starterIds.rooms.soc,
      organisationId: starterIds.organisation,
      name: "soc-operations",
      slug: "soc-operations",
      displayName: "SOC operations",
      description: "Security operations coordination",
      topic: "Security operations coordination",
      roomType: "operations",
      createdByActorId: starterIds.actors.jordan,
    },
    {
      id: starterIds.rooms.triageDirect,
      organisationId: starterIds.organisation,
      name: "dm-alfie",
      slug: "dm-alfie",
      displayName: "Alfie",
      description: "Direct work with the permission-scoped research agent",
      topic: "Threat and technology research",
      roomType: "direct",
      visibility: "private",
      createdByActorId: starterIds.actors.jordan,
    },
    {
      id: starterIds.rooms.tawnyDirect,
      organisationId: starterIds.organisation,
      name: "dm-jessie",
      slug: "dm-jessie",
      displayName: "Jessie",
      description: "Direct work with the permission-scoped hunting agent",
      topic: "Threat hunting, enrichment, and analyst guidance",
      roomType: "direct",
      visibility: "private",
      createdByActorId: starterIds.actors.jordan,
    },
    {
      id: starterIds.rooms.parkerDirect,
      organisationId: starterIds.organisation,
      name: "dm-parker",
      slug: "dm-parker",
      displayName: "Parker",
      description: "Direct work with the permission-scoped reporting agent",
      topic: "Operational reports and executive briefings",
      roomType: "direct",
      visibility: "private",
      createdByActorId: starterIds.actors.jordan,
    },
  ])
  .onConflictDoUpdate({
    target: schema.rooms.id,
    set: {
      displayName: sql`excluded.display_name`,
      description: sql`excluded.description`,
      topic: sql`excluded.topic`,
    },
  });

await db
  .insert(schema.roomMemberships)
  .values([
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.soc,
      actorId: starterIds.actors.jordan,
      membershipRole: "owner",
    },
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.soc,
      actorId: starterIds.actors.triage,
      membershipRole: "agent_member",
    },
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.soc,
      actorId: starterIds.actors.tawnyHunt,
      membershipRole: "agent_member",
    },
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.soc,
      actorId: starterIds.actors.threatIntel,
      membershipRole: "agent_member",
    },
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.triageDirect,
      actorId: starterIds.actors.jordan,
      membershipRole: "owner",
    },
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.triageDirect,
      actorId: starterIds.actors.triage,
      membershipRole: "agent_member",
    },
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.tawnyDirect,
      actorId: starterIds.actors.jordan,
      membershipRole: "owner",
    },
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.tawnyDirect,
      actorId: starterIds.actors.tawnyHunt,
      membershipRole: "agent_member",
    },
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.parkerDirect,
      actorId: starterIds.actors.jordan,
      membershipRole: "owner",
    },
    {
      organisationId: starterIds.organisation,
      roomId: starterIds.rooms.parkerDirect,
      actorId: starterIds.actors.threatIntel,
      membershipRole: "agent_member",
    },
  ])
  .onConflictDoNothing();

await bootstrapEnvironmentConnectors(db);

process.stdout.write(
  `Bootstrapped ${organisationName} without demonstration activity.\n`,
);
await closeDatabase();
