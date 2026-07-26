import { database, closeDatabase, schema } from "./index.ts";
import { demoIds } from "./seed-data.ts";
import { sql } from "drizzle-orm";

if (process.env.MUSTER_DEMO_MODE !== "true") {
  throw new Error(
    "Demonstration seed refused. Set MUSTER_DEMO_MODE=true explicitly.",
  );
}

const db = database();
const allCapabilities = [
  "administration.manage",
  "rooms.read",
  "rooms.create",
  "rooms.manage",
  "messages.create",
  "messages.moderate",
  "alerts.read",
  "alerts.acknowledge",
  "alerts.promote",
  "investigations.read",
  "investigations.create",
  "investigations.update",
  "investigations.promote",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "tasks.assign",
  "workflows.approve",
  "agents.read",
  "agents.invoke",
  "agents.manage",
  "agents.cancel",
  "audit.read",
];

await db
  .insert(schema.organisations)
  .values({
    id: demoIds.organisation,
    name: "Muster Demo Workspace",
    slug: "muster-demo",
    dataRegion: "australia",
    defaultTimezone: "Australia/Sydney",
    retentionPolicy: { messagesDays: 365, auditDays: 2555 },
    authenticationPolicy: { requireMfaForPrivilegedRoles: true },
  })
  .onConflictDoUpdate({
    target: schema.organisations.id,
    set: {
      name: "Muster Demo Workspace",
      slug: "muster-demo",
      dataRegion: "australia",
      defaultTimezone: "Australia/Sydney",
    },
  });

await db
  .insert(schema.actors)
  .values([
    {
      id: demoIds.actors.jordan,
      organisationId: demoIds.organisation,
      actorType: "human",
      displayName: "Jordan Blake",
      identityReference: "admin@muster.local",
      capabilityAssignments: allCapabilities,
    },
    {
      id: demoIds.actors.maya,
      organisationId: demoIds.organisation,
      actorType: "human",
      displayName: "Maya Chen",
      identityReference: "maya.chen@example.invalid",
      capabilityAssignments: [
        "rooms.read",
        "messages.create",
        "alerts.read",
        "alerts.acknowledge",
        "alerts.promote",
        "investigations.read",
        "investigations.create",
        "investigations.update",
        "investigations.promote",
        "tasks.read",
        "tasks.create",
        "tasks.update",
        "tasks.assign",
        "workflows.approve",
        "agents.invoke",
      ],
    },
    {
      id: demoIds.actors.daniel,
      organisationId: demoIds.organisation,
      actorType: "human",
      displayName: "Daniel Brooks",
      identityReference: "daniel.brooks@example.invalid",
      capabilityAssignments: [
        "rooms.read",
        "messages.create",
        "alerts.read",
        "investigations.read",
        "tasks.read",
        "tasks.create",
        "tasks.update",
        "tasks.assign",
        "sentinel.rules.publish",
        "bower.policy.propose",
      ],
    },
    {
      id: demoIds.actors.priya,
      organisationId: demoIds.organisation,
      actorType: "human",
      displayName: "Priya Nair",
      identityReference: "priya.nair@example.invalid",
      capabilityAssignments: [
        "rooms.read",
        "messages.create",
        "alerts.read",
        "investigations.read",
        "investigations.update",
        "tasks.read",
        "tasks.create",
        "tasks.update",
        "tasks.assign",
        "workflows.approve",
        "tawny.response.isolate_host",
      ],
    },
    {
      id: demoIds.actors.alex,
      organisationId: demoIds.organisation,
      actorType: "human",
      displayName: "Alex Morgan",
      identityReference: "alex.morgan@example.invalid",
      capabilityAssignments: [
        "rooms.read",
        "alerts.read",
        "investigations.read",
        "tasks.read",
        "audit.read",
      ],
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
        "investigations.update",
      ],
    },
    {
      id: demoIds.actors.tawnyHunt,
      organisationId: demoIds.organisation,
      actorType: "agent",
      displayName: "Jessie",
      identityReference: "agent:jessie-hunt",
      capabilityAssignments: ["tawny.telemetry.read", "tawny.hunts.execute"],
    },
    {
      id: demoIds.actors.bowerHealth,
      organisationId: demoIds.organisation,
      actorType: "agent",
      displayName: "Bower Health Agent",
      identityReference: "agent:bower-health",
      capabilityAssignments: ["bower.fleet.read", "bower.policy.read"],
    },
    {
      id: demoIds.actors.kelpieCase,
      organisationId: demoIds.organisation,
      actorType: "agent",
      displayName: "Kelpie Case Agent",
      identityReference: "agent:kelpie-case",
      capabilityAssignments: ["kelpie.cases.read", "kelpie.cases.create"],
    },
    {
      id: demoIds.actors.sentinelQuery,
      organisationId: demoIds.organisation,
      actorType: "agent",
      displayName: "Sentinel Query Agent",
      identityReference: "agent:sentinel-query",
      capabilityAssignments: ["sentinel.query.execute", "sentinel.rules.read"],
    },
    {
      id: demoIds.actors.threatIntel,
      organisationId: demoIds.organisation,
      actorType: "agent",
      displayName: "Parker",
      identityReference: "agent:parker-executive",
      capabilityAssignments: ["alerts.read"],
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
  .insert(schema.agentDefinitions)
  .values([
    {
      id: demoIds.actors.triage,
      organisationId: demoIds.organisation,
      name: "Alfie",
      description: "Synthetic evidence-backed threat research agent",
      runtime: "codex-subscription",
      model: process.env.MUSTER_CODEX_MODEL?.trim() || "configured",
      ownerActorId: demoIds.actors.jordan,
      systemPromptVersion: "alfie-v1",
      allowedTools: ["alerts.read", "investigations.read"],
      allowedRooms: [demoIds.rooms.soc, demoIds.rooms.triageDirect],
      capabilityRequirements: ["alerts.read", "investigations.read"],
      approvalRequirements: { externalWrites: "human" },
    },
    {
      id: demoIds.actors.tawnyHunt,
      organisationId: demoIds.organisation,
      name: "Jessie",
      description: "Synthetic bounded threat hunt agent",
      runtime: "codex-subscription",
      model: process.env.MUSTER_CODEX_MODEL?.trim() || "configured",
      ownerActorId: demoIds.actors.jordan,
      systemPromptVersion: "jessie-v1",
      allowedTools: ["tawny.telemetry.read", "tawny.hunts.execute"],
      allowedRooms: [demoIds.rooms.soc, demoIds.rooms.tawnyDirect],
      capabilityRequirements: ["tawny.telemetry.read", "tawny.hunts.execute"],
      approvalRequirements: { externalWrites: "human" },
    },
    {
      id: demoIds.actors.threatIntel,
      organisationId: demoIds.organisation,
      name: "Parker",
      description: "Synthetic operational reporting agent",
      runtime: "codex-subscription",
      model: process.env.MUSTER_CODEX_MODEL?.trim() || "configured",
      ownerActorId: demoIds.actors.jordan,
      systemPromptVersion: "parker-v1",
      allowedTools: ["alerts.read", "investigations.read", "audit.read"],
      allowedRooms: [demoIds.rooms.soc],
      capabilityRequirements: [
        "alerts.read",
        "investigations.read",
        "audit.read",
      ],
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

const channelRoomRows = [
  [demoIds.rooms.soc, "soc-operations", "SOC operations", "operations"],
  [demoIds.rooms.alerts, "alerts", "Alerts", "system"],
  [
    demoIds.rooms.activeIncidents,
    "active-incidents",
    "Active incidents",
    "incident",
  ],
  [
    demoIds.rooms.threatIntel,
    "threat-intelligence",
    "Threat intelligence",
    "operations",
  ],
  [
    demoIds.rooms.detection,
    "detection-engineering",
    "Detection engineering",
    "engineering",
  ],
  [
    demoIds.rooms.endpoint,
    "endpoint-security",
    "Endpoint security",
    "operations",
  ],
  [
    demoIds.rooms.bower,
    "bower-telemetry-health",
    "Bower telemetry health",
    "system",
  ],
  [demoIds.rooms.incident, "incident-KP-2026-0042", "KP-2026-0042", "incident"],
  [
    demoIds.rooms.investigation,
    "investigation-suspicious-powershell",
    "Suspicious PowerShell",
    "investigation",
  ],
] as const;
const directRoomRows = [
  [demoIds.rooms.mayaDirect, "dm-maya-chen", "Maya Chen", "direct"],
  [demoIds.rooms.triageDirect, "dm-triage-agent", "Triage Agent", "direct"],
  [
    demoIds.rooms.tawnyDirect,
    "dm-tawny-hunt-agent",
    "Tawny Hunt Agent",
    "direct",
  ],
] as const;
const roomRows = [...channelRoomRows, ...directRoomRows] as const;
await db
  .insert(schema.rooms)
  .values(
    roomRows.map(([id, slug, displayName, roomType]) => ({
      id,
      organisationId: demoIds.organisation,
      name: slug,
      slug,
      displayName,
      description: "Synthetic demonstration room",
      roomType,
      createdByActorId: demoIds.actors.jordan,
      linkedKelpieCaseId: slug.startsWith("incident-") ? "KP-2026-0042" : null,
      defaultSeverity:
        slug.includes("incident") || slug.includes("investigation")
          ? ("critical" as const)
          : null,
    })),
  )
  .onConflictDoNothing();
await db
  .insert(schema.roomMemberships)
  .values(
    channelRoomRows.flatMap(([roomId]) =>
      [
        demoIds.actors.jordan,
        demoIds.actors.maya,
        demoIds.actors.priya,
        demoIds.actors.triage,
        demoIds.actors.tawnyHunt,
      ].map((actorId) => ({
        organisationId: demoIds.organisation,
        roomId,
        actorId,
        membershipRole:
          actorId === demoIds.actors.jordan
            ? ("owner" as const)
            : actorId === demoIds.actors.triage ||
                actorId === demoIds.actors.tawnyHunt
              ? ("agent_member" as const)
              : ("member" as const),
      })),
    ),
  )
  .onConflictDoNothing();
await db
  .insert(schema.roomMemberships)
  .values([
    ...[demoIds.actors.jordan, demoIds.actors.maya].map((actorId) => ({
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.mayaDirect,
      actorId,
      membershipRole:
        actorId === demoIds.actors.jordan
          ? ("owner" as const)
          : ("member" as const),
    })),
    ...[demoIds.actors.jordan, demoIds.actors.triage].map((actorId) => ({
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.triageDirect,
      actorId,
      membershipRole:
        actorId === demoIds.actors.triage
          ? ("agent_member" as const)
          : ("owner" as const),
    })),
    ...[demoIds.actors.jordan, demoIds.actors.tawnyHunt].map((actorId) => ({
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.tawnyDirect,
      actorId,
      membershipRole:
        actorId === demoIds.actors.tawnyHunt
          ? ("agent_member" as const)
          : ("owner" as const),
    })),
  ])
  .onConflictDoNothing();

const textDocument = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
await db
  .insert(schema.messages)
  .values([
    {
      id: demoIds.messages.mayaParent,
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.investigation,
      authorActorId: demoIds.actors.maya,
      messageType: "text",
      plainText:
        "The Bower and Tawny events share the same user and source IP. Starting with endpoint activity from 16:10 to 16:30.",
      document: textDocument(
        "The Bower and Tawny events share the same user and source IP. Starting with endpoint activity from 16:10 to 16:30.",
      ),
      createdAt: new Date("2026-07-26T06:24:00Z"),
      dataClassification: "internal",
      idempotencyKey: "demo:message:maya-parent",
    },
    {
      id: demoIds.messages.priyaReply,
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.investigation,
      threadParentId: demoIds.messages.mayaParent,
      authorActorId: demoIds.actors.priya,
      messageType: "text",
      plainText:
        "I have endpoint volatile collection running before containment.",
      document: textDocument(
        "I have endpoint volatile collection running before containment.",
      ),
      createdAt: new Date("2026-07-26T06:28:00Z"),
      dataClassification: "internal",
      idempotencyKey: "demo:message:priya-reply",
    },
    {
      id: demoIds.messages.tawnyReply,
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.investigation,
      threadParentId: demoIds.messages.mayaParent,
      authorActorId: demoIds.actors.tawnyHunt,
      messageType: "text",
      plainText:
        "Process tree and network connections are ready. Five evidence references attached.",
      document: textDocument(
        "Process tree and network connections are ready. Five evidence references attached.",
      ),
      createdAt: new Date("2026-07-26T06:30:00Z"),
      dataClassification: "internal",
      idempotencyKey: "demo:message:tawny-reply",
    },
    {
      id: demoIds.messages.justinReply,
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.investigation,
      threadParentId: demoIds.messages.mayaParent,
      authorActorId: demoIds.actors.jordan,
      messageType: "text",
      plainText: "Proceed to approval once the volatile capture is confirmed.",
      document: textDocument(
        "Proceed to approval once the volatile capture is confirmed.",
      ),
      createdAt: new Date("2026-07-26T06:32:00Z"),
      dataClassification: "internal",
      idempotencyKey: "demo:message:justin-reply",
    },
    {
      id: demoIds.messages.priyaParent,
      organisationId: demoIds.organisation,
      roomId: demoIds.rooms.investigation,
      authorActorId: demoIds.actors.priya,
      messageType: "text",
      plainText:
        "Endpoint is still online. I support isolation, but preserve current sessions and memory acquisition status first.",
      document: textDocument(
        "Endpoint is still online. I support isolation, but preserve current sessions and memory acquisition status first.",
      ),
      createdAt: new Date("2026-07-26T06:31:00Z"),
      dataClassification: "internal",
      idempotencyKey: "demo:message:priya-parent",
    },
  ])
  .onConflictDoNothing();
await db
  .insert(schema.reactions)
  .values([
    {
      organisationId: demoIds.organisation,
      messageId: demoIds.messages.mayaParent,
      actorId: demoIds.actors.jordan,
      emoji: "eyes",
    },
    {
      organisationId: demoIds.organisation,
      messageId: demoIds.messages.mayaParent,
      actorId: demoIds.actors.priya,
      emoji: "eyes",
    },
    {
      organisationId: demoIds.organisation,
      messageId: demoIds.messages.mayaParent,
      actorId: demoIds.actors.triage,
      emoji: "eyes",
    },
    {
      organisationId: demoIds.organisation,
      messageId: demoIds.messages.priyaParent,
      actorId: demoIds.actors.jordan,
      emoji: "check",
    },
    {
      organisationId: demoIds.organisation,
      messageId: demoIds.messages.priyaParent,
      actorId: demoIds.actors.maya,
      emoji: "check",
    },
  ])
  .onConflictDoNothing();

await db
  .insert(schema.investigations)
  .values({
    id: demoIds.investigation,
    organisationId: demoIds.organisation,
    investigationNumber: "INV-2026-0178",
    title: "Legacy portal credential access and suspicious PowerShell",
    summary:
      "Bower authentication failures correlate with Tawny endpoint activity for jsmith, WS-1042, and 203.0.113.44.",
    status: "awaiting_approval",
    severity: "critical",
    leadActorId: demoIds.actors.maya,
    roomId: demoIds.rooms.investigation,
    recommendation: "Promote to Kelpie and isolate WS-1042 after approval.",
    linkedKelpieCaseId: "KP-2026-0042",
  })
  .onConflictDoNothing();
await db
  .update(schema.rooms)
  .set({ linkedInvestigationId: demoIds.investigation })
  .where(
    (await import("drizzle-orm")).eq(
      schema.rooms.id,
      demoIds.rooms.investigation,
    ),
  );

await db
  .insert(schema.alerts)
  .values([
    {
      id: demoIds.alerts.bower,
      organisationId: demoIds.organisation,
      sourceProduct: "bower",
      sourceInstance: "bower-mock-au-01",
      externalReference: "ALT-2026-1041",
      title: "Repeated authentication failures from legacy portal",
      description: "Twelve failures and one successful sign-in for jsmith.",
      severity: "high",
      status: "promoted",
      ruleName: "Authentication failure burst",
      ruleId: "bower-auth-burst",
      occurredAt: new Date("2026-07-26T06:18:39Z"),
      assignedActorId: demoIds.actors.maya,
      entities: [{ type: "identity", value: "jsmith" }],
      observables: [{ type: "ip", value: "203.0.113.44" }],
      investigationId: demoIds.investigation,
      kelpieCaseId: "KP-2026-0042",
      roomId: demoIds.rooms.investigation,
      dedupeKey: "bower:ALT-2026-1041",
      correlationKey: "jsmith:203.0.113.44",
    },
    {
      id: demoIds.alerts.tawny,
      organisationId: demoIds.organisation,
      sourceProduct: "tawny",
      sourceInstance: "tawny-mock-au-01",
      externalReference: "ALT-2026-1042",
      title: "Suspicious PowerShell with encoded command",
      description: "Encoded PowerShell execution on WS-1042.",
      severity: "critical",
      status: "investigating",
      ruleName: "Suspicious PowerShell execution",
      ruleId: "sigma-123",
      occurredAt: new Date("2026-07-26T06:21:08Z"),
      assignedActorId: demoIds.actors.maya,
      entities: [
        { type: "endpoint", value: "WS-1042" },
        { type: "identity", value: "jsmith" },
      ],
      observables: [{ type: "ip", value: "203.0.113.44" }],
      investigationId: demoIds.investigation,
      kelpieCaseId: "KP-2026-0042",
      roomId: demoIds.rooms.investigation,
      dedupeKey: "tawny:ALT-2026-1042",
      correlationKey: "jsmith:203.0.113.44",
    },
  ])
  .onConflictDoNothing();

await db
  .insert(schema.findings)
  .values({
    id: "018f55d8-c4c7-7c3e-88ef-000000000501",
    organisationId: demoIds.organisation,
    investigationId: demoIds.investigation,
    createdByActorId: demoIds.actors.tawnyHunt,
    title: "Encoded PowerShell retrieved second-stage content",
    summary:
      "Process, network, and file telemetry support malicious execution.",
    confidence: 94,
    severity: "critical",
    supportingEvidence: ["evidence:WS-1042-process-tree"],
    relatedEntities: ["WS-1042", "jsmith"],
    relatedObservables: ["203.0.113.44", "cdn-auth-check.example"],
    recommendedAction:
      "Isolate WS-1042 and preserve volatile endpoint evidence.",
    agentProvenance: {
      runtime: "mock-acp",
      model: "synthetic",
      toolCalls: ["tawny.hunt"],
      evidenceUsed: 5,
    },
    humanReviewedAt: new Date("2026-07-26T06:32:00Z"),
  })
  .onConflictDoNothing();

await db
  .insert(schema.approvals)
  .values({
    id: demoIds.approval,
    organisationId: demoIds.organisation,
    requestingActorId: demoIds.actors.triage,
    actionType: "isolate_endpoint",
    target: { endpointId: "WS-1042", integration: "tawny-mock-au-01" },
    riskSummary: "Stops network activity on a production finance endpoint.",
    expiresAt: new Date("2026-07-26T07:00:00Z"),
    requiredCapability: "tawny.response.isolate_host",
    status: "pending",
    idempotencyKey: "demo:isolate:WS-1042",
  })
  .onConflictDoNothing();

await db
  .insert(schema.integrationRecords)
  .values([
    {
      id: "018f55d8-c4c7-7c3e-88ef-000000000601",
      organisationId: demoIds.organisation,
      product: "kelpie",
      instanceId: "kelpie-mock-au-01",
      displayName: "Kelpie local mock",
      status: "healthy",
      mock: true,
    },
    {
      id: "018f55d8-c4c7-7c3e-88ef-000000000602",
      organisationId: demoIds.organisation,
      product: "tawny",
      instanceId: "tawny-mock-au-01",
      displayName: "Tawny local mock",
      status: "healthy",
      mock: true,
    },
    {
      id: "018f55d8-c4c7-7c3e-88ef-000000000603",
      organisationId: demoIds.organisation,
      product: "bower",
      instanceId: "bower-mock-au-01",
      displayName: "Bower local mock",
      status: "degraded",
      mock: true,
      health: { staleCollectors: 1 },
    },
  ])
  .onConflictDoNothing();

await db
  .insert(schema.tasks)
  .values([
    {
      id: demoIds.tasks.threatHunt,
      organisationId: demoIds.organisation,
      title: "Threat hunt the unusual authentication alert",
      description:
        "Review the earlier identity alert, then hunt the linked endpoint and source IP for related activity.",
      status: "ready",
      priority: "high",
      assignedActorId: demoIds.actors.tawnyHunt,
      createdByActorId: demoIds.actors.jordan,
      roomId: demoIds.rooms.investigation,
      investigationId: demoIds.investigation,
      dueAt: new Date("2026-07-26T09:30:00Z"),
    },
    {
      id: demoIds.tasks.incidentEmail,
      organisationId: demoIds.organisation,
      title: "Prepare incident update email",
      description:
        "Draft a concise update for the incident stakeholders. Sending remains human-approved.",
      status: "backlog",
      priority: "normal",
      assignedActorId: demoIds.actors.kelpieCase,
      createdByActorId: demoIds.actors.jordan,
      roomId: demoIds.rooms.incident,
      investigationId: demoIds.investigation,
      approvalRequired: true,
    },
    {
      id: demoIds.tasks.executiveUpdate,
      organisationId: demoIds.organisation,
      title: "Prepare executive incident update",
      description:
        "Summarise impact, containment, decisions, and next update time without exposing restricted evidence.",
      status: "in_progress",
      priority: "urgent",
      assignedActorId: demoIds.actors.triage,
      createdByActorId: demoIds.actors.maya,
      roomId: demoIds.rooms.incident,
      investigationId: demoIds.investigation,
      agentRunStatus: "running",
    },
    {
      id: demoIds.tasks.monthlyLandscape,
      organisationId: demoIds.organisation,
      title: "Monthly threat landscape and SOC MTTR",
      description:
        "Analyse the prior month of incidents, recurring techniques, MTTA, and MTTR. Produce an evidence-linked review draft.",
      status: "review",
      priority: "normal",
      assignedActorId: demoIds.actors.threatIntel,
      createdByActorId: demoIds.actors.jordan,
      roomId: demoIds.rooms.soc,
      investigationId: demoIds.investigation,
      agentRunStatus: "completed",
    },
  ])
  .onConflictDoNothing();

process.stdout.write(
  "Seeded Muster Demo Workspace with synthetic demonstration data.\n",
);
await closeDatabase();
