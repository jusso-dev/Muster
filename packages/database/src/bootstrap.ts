import { sql } from "drizzle-orm";
import { closeDatabase, database, schema } from "./index.ts";
import { demoIds } from "./seed-data.ts";

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
  "tawny.response.kill_process",
  "tawny.response.isolate_host",
  "bower.fleet.read",
  "bower.policy.read",
  "bower.policy.propose",
  "bower.policy.publish",
  "sentinel.query.execute",
  "sentinel.rules.read",
  "sentinel.rules.publish",
  "agents.read",
  "agents.invoke",
  "agents.manage",
  "agents.cancel",
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
    id: demoIds.organisation,
    name: organisationName,
    slug: organisationSlug,
    dataRegion: process.env.MUSTER_DATA_REGION?.trim() || "local",
    defaultTimezone: process.env.MUSTER_DEFAULT_TIMEZONE?.trim() || "UTC",
    retentionPolicy: { messagesDays: 365, auditDays: 2555 },
    authenticationPolicy: { requireMfaForPrivilegedRoles: false },
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
      id: demoIds.actors.jordan,
      organisationId: demoIds.organisation,
      actorType: "human",
      displayName: "Muster Administrator",
      identityReference: administratorEmail,
      capabilityAssignments: administratorCapabilities,
    },
    {
      id: demoIds.actors.triage,
      organisationId: demoIds.organisation,
      actorType: "agent",
      displayName: "Alfie",
      identityReference: "agent:alfie-threat-research",
      capabilityAssignments: [
        "alerts.read",
        "investigations.read",
        "kelpie.cases.read",
        "sentinel.rules.read",
      ],
    },
    {
      id: demoIds.actors.tawnyHunt,
      organisationId: demoIds.organisation,
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
        "sentinel.query.execute",
      ],
    },
    {
      id: demoIds.actors.threatIntel,
      organisationId: demoIds.organisation,
      actorType: "agent",
      displayName: "Parker",
      identityReference: "agent:parker-executive",
      capabilityAssignments: [
        "alerts.read",
        "investigations.read",
        "kelpie.cases.read",
        "audit.read",
      ],
    },
    {
      id: demoIds.actors.system,
      organisationId: demoIds.organisation,
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
  .insert(schema.rooms)
  .values([
    {
      id: demoIds.rooms.soc,
      organisationId: demoIds.organisation,
      name: "soc-operations",
      slug: "soc-operations",
      displayName: "SOC operations",
      description: "Security operations coordination",
      topic: "Security operations coordination",
      roomType: "operations",
      createdByActorId: demoIds.actors.jordan,
    },
    {
      id: demoIds.rooms.triageDirect,
      organisationId: demoIds.organisation,
      name: "dm-alfie",
      slug: "dm-alfie",
      displayName: "Alfie",
      description: "Direct work with the permission-scoped research agent",
      topic: "Threat and technology research",
      roomType: "direct",
      visibility: "private",
      createdByActorId: demoIds.actors.jordan,
    },
    {
      id: demoIds.rooms.tawnyDirect,
      organisationId: demoIds.organisation,
      name: "dm-jessie",
      slug: "dm-jessie",
      displayName: "Jessie",
      description: "Direct work with the permission-scoped hunting agent",
      topic: "Threat hunting, enrichment, and analyst guidance",
      roomType: "direct",
      visibility: "private",
      createdByActorId: demoIds.actors.jordan,
    },
    {
      id: demoIds.rooms.parkerDirect,
      organisationId: demoIds.organisation,
      name: "dm-parker",
      slug: "dm-parker",
      displayName: "Parker",
      description: "Direct work with the permission-scoped reporting agent",
      topic: "Operational reports and executive briefings",
      roomType: "direct",
      visibility: "private",
      createdByActorId: demoIds.actors.jordan,
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
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.soc,
      actorId: demoIds.actors.jordan,
      membershipRole: "owner",
    },
    {
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.soc,
      actorId: demoIds.actors.triage,
      membershipRole: "agent_member",
    },
    {
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.soc,
      actorId: demoIds.actors.tawnyHunt,
      membershipRole: "agent_member",
    },
    {
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.soc,
      actorId: demoIds.actors.threatIntel,
      membershipRole: "agent_member",
    },
    {
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.triageDirect,
      actorId: demoIds.actors.jordan,
      membershipRole: "owner",
    },
    {
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.triageDirect,
      actorId: demoIds.actors.triage,
      membershipRole: "agent_member",
    },
    {
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.tawnyDirect,
      actorId: demoIds.actors.jordan,
      membershipRole: "owner",
    },
    {
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.tawnyDirect,
      actorId: demoIds.actors.tawnyHunt,
      membershipRole: "agent_member",
    },
    {
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.parkerDirect,
      actorId: demoIds.actors.jordan,
      membershipRole: "owner",
    },
    {
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.parkerDirect,
      actorId: demoIds.actors.threatIntel,
      membershipRole: "agent_member",
    },
  ])
  .onConflictDoNothing();

process.stdout.write(
  `Bootstrapped ${organisationName} without demonstration activity.\n`,
);
await closeDatabase();
