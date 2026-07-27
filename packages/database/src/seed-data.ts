export const starterIds = {
  organisation: "018f55d8-c4c7-7c3e-88ef-000000000001",
  actors: {
    jordan: "018f55d8-c4c7-7c3e-88ef-000000000010",
    maya: "018f55d8-c4c7-7c3e-88ef-000000000011",
    daniel: "018f55d8-c4c7-7c3e-88ef-000000000012",
    priya: "018f55d8-c4c7-7c3e-88ef-000000000013",
    alex: "018f55d8-c4c7-7c3e-88ef-000000000014",
    triage: "018f55d8-c4c7-7c3e-88ef-000000000020",
    tawnyHunt: "018f55d8-c4c7-7c3e-88ef-000000000021",
    bowerHealth: "018f55d8-c4c7-7c3e-88ef-000000000022",
    kelpieCase: "018f55d8-c4c7-7c3e-88ef-000000000023",
    sentinelQuery: "018f55d8-c4c7-7c3e-88ef-000000000024",
    threatIntel: "018f55d8-c4c7-7c3e-88ef-000000000025",
    system: "018f55d8-c4c7-7c3e-88ef-000000000029",
  },
  rooms: {
    soc: "018f55d8-c4c7-7c3e-88ef-000000000100",
    activeIncidents: "018f55d8-c4c7-7c3e-88ef-000000000101",
    threatIntel: "018f55d8-c4c7-7c3e-88ef-000000000102",
    detection: "018f55d8-c4c7-7c3e-88ef-000000000103",
    endpoint: "018f55d8-c4c7-7c3e-88ef-000000000104",
    bower: "018f55d8-c4c7-7c3e-88ef-000000000105",
    incident: "018f55d8-c4c7-7c3e-88ef-000000000106",
    investigation: "018f55d8-c4c7-7c3e-88ef-000000000107",
    alerts: "018f55d8-c4c7-7c3e-88ef-000000000108",
    mayaDirect: "018f55d8-c4c7-7c3e-88ef-000000000109",
    triageDirect: "018f55d8-c4c7-7c3e-88ef-000000000110",
    tawnyDirect: "018f55d8-c4c7-7c3e-88ef-000000000111",
    parkerDirect: "018f55d8-c4c7-7c3e-88ef-000000000112",
  },
  investigation: "018f55d8-c4c7-7c3e-88ef-000000000200",
  alerts: {
    tawny: "018f55d8-c4c7-7c3e-88ef-000000000301",
    bower: "018f55d8-c4c7-7c3e-88ef-000000000302",
  },
  approval: "018f55d8-c4c7-7c3e-88ef-000000000401",
  tasks: {
    threatHunt: "018f55d8-c4c7-7c3e-88ef-000000000801",
    incidentEmail: "018f55d8-c4c7-7c3e-88ef-000000000802",
    executiveUpdate: "018f55d8-c4c7-7c3e-88ef-000000000803",
    monthlyLandscape: "018f55d8-c4c7-7c3e-88ef-000000000804",
  },
  messages: {
    mayaParent: "018f55d8-c4c7-7c3e-88ef-000000000701",
    priyaReply: "018f55d8-c4c7-7c3e-88ef-000000000702",
    tawnyReply: "018f55d8-c4c7-7c3e-88ef-000000000703",
    justinReply: "018f55d8-c4c7-7c3e-88ef-000000000704",
    priyaParent: "018f55d8-c4c7-7c3e-88ef-000000000705",
  },
} as const;

/**
 * Deterministic IDs for demonstration data only. They must never overlap the
 * clean-install bootstrap namespace above: demo seeding is opt-in and must not
 * mutate a bootstrap workspace.
 */
export const demoIds = {
  organisation: "019e7a10-0000-7000-8000-000000000001",
  actors: {
    jordan: "019e7a10-0000-7000-8000-000000000010",
    maya: "019e7a10-0000-7000-8000-000000000011",
    daniel: "019e7a10-0000-7000-8000-000000000012",
    priya: "019e7a10-0000-7000-8000-000000000013",
    alex: "019e7a10-0000-7000-8000-000000000014",
    triage: "019e7a10-0000-7000-8000-000000000020",
    tawnyHunt: "019e7a10-0000-7000-8000-000000000021",
    bowerHealth: "019e7a10-0000-7000-8000-000000000022",
    kelpieCase: "019e7a10-0000-7000-8000-000000000023",
    sentinelQuery: "019e7a10-0000-7000-8000-000000000024",
    threatIntel: "019e7a10-0000-7000-8000-000000000025",
    system: "019e7a10-0000-7000-8000-000000000029",
  },
  rooms: {
    soc: "019e7a10-0000-7000-8000-000000000100",
    activeIncidents: "019e7a10-0000-7000-8000-000000000101",
    threatIntel: "019e7a10-0000-7000-8000-000000000102",
    detection: "019e7a10-0000-7000-8000-000000000103",
    endpoint: "019e7a10-0000-7000-8000-000000000104",
    bower: "019e7a10-0000-7000-8000-000000000105",
    incident: "019e7a10-0000-7000-8000-000000000106",
    investigation: "019e7a10-0000-7000-8000-000000000107",
    alerts: "019e7a10-0000-7000-8000-000000000108",
    mayaDirect: "019e7a10-0000-7000-8000-000000000109",
    triageDirect: "019e7a10-0000-7000-8000-000000000110",
    tawnyDirect: "019e7a10-0000-7000-8000-000000000111",
    parkerDirect: "019e7a10-0000-7000-8000-000000000112",
  },
  investigation: "019e7a10-0000-7000-8000-000000000200",
  alerts: {
    tawny: "019e7a10-0000-7000-8000-000000000301",
    bower: "019e7a10-0000-7000-8000-000000000302",
  },
  approval: "019e7a10-0000-7000-8000-000000000401",
  findings: {
    encodedPowerShell: "019e7a10-0000-7000-8000-000000000501",
  },
  integrations: {
    kelpie: "019e7a10-0000-7000-8000-000000000601",
    tawny: "019e7a10-0000-7000-8000-000000000602",
    bower: "019e7a10-0000-7000-8000-000000000603",
  },
  tasks: {
    threatHunt: "019e7a10-0000-7000-8000-000000000801",
    incidentEmail: "019e7a10-0000-7000-8000-000000000802",
    executiveUpdate: "019e7a10-0000-7000-8000-000000000803",
    monthlyLandscape: "019e7a10-0000-7000-8000-000000000804",
  },
  messages: {
    mayaParent: "019e7a10-0000-7000-8000-000000000701",
    priyaReply: "019e7a10-0000-7000-8000-000000000702",
    tawnyReply: "019e7a10-0000-7000-8000-000000000703",
    justinReply: "019e7a10-0000-7000-8000-000000000704",
    priyaParent: "019e7a10-0000-7000-8000-000000000705",
  },
} as const;

/**
 * Demonstration-only direct rooms. Keep this list aligned with the seed: the
 * IDs are consumed by agent allow-lists and room memberships.
 */
export const demoDirectRoomSeeds = [
  {
    id: demoIds.rooms.mayaDirect,
    slug: "dm-maya-chen",
    displayName: "Maya Chen",
    members: [
      { actorId: demoIds.actors.jordan, membershipRole: "owner" },
      { actorId: demoIds.actors.maya, membershipRole: "member" },
    ],
  },
  {
    id: demoIds.rooms.triageDirect,
    slug: "dm-triage-agent",
    displayName: "Triage Agent",
    members: [
      { actorId: demoIds.actors.jordan, membershipRole: "owner" },
      { actorId: demoIds.actors.triage, membershipRole: "agent_member" },
    ],
  },
  {
    id: demoIds.rooms.tawnyDirect,
    slug: "dm-tawny-hunt-agent",
    displayName: "Tawny Hunt Agent",
    members: [
      { actorId: demoIds.actors.jordan, membershipRole: "owner" },
      { actorId: demoIds.actors.tawnyHunt, membershipRole: "agent_member" },
    ],
  },
  {
    id: demoIds.rooms.parkerDirect,
    slug: "dm-parker",
    displayName: "Parker",
    members: [
      { actorId: demoIds.actors.jordan, membershipRole: "owner" },
      { actorId: demoIds.actors.threatIntel, membershipRole: "agent_member" },
    ],
  },
] as const;
