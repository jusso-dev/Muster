export type Severity = "critical" | "high" | "medium" | "low" | "informational";

export const demoMode =
  process.env.NEXT_PUBLIC_MUSTER_DEMO_MODE === "true";

export const demoOrganisation = demoMode
  ? {
      id: "018f55d8-c4c7-7c3e-88ef-000000000001",
      name: "Muster Demo Workspace",
      slug: "muster-demo",
    }
  : {
      id: "018f55d8-c4c7-7c3e-88ef-000000000001",
      name: "Muster Workspace",
      slug: "muster",
    };

const demoPeopleRows = [
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000010",
    name: "Jordan Blake",
    initials: "JB",
    role: "Security Lead",
    presence: "online",
    type: "human",
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000011",
    name: "Maya Chen",
    initials: "MC",
    role: "Senior Analyst",
    presence: "online",
    type: "human",
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000012",
    name: "Daniel Brooks",
    initials: "DB",
    role: "Detection Engineer",
    presence: "away",
    type: "human",
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000013",
    name: "Priya Nair",
    initials: "PN",
    role: "Incident Responder",
    presence: "online",
    type: "human",
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000014",
    name: "Alex Morgan",
    initials: "AM",
    role: "Read-only Auditor",
    presence: "offline",
    type: "human",
  },
] as const;

export const demoPeople = demoMode
  ? demoPeopleRows
  : ([
      {
        id: "018f55d8-c4c7-7c3e-88ef-000000000010",
        name: "Muster Administrator",
        initials: "MA",
        role: "Administrator",
        presence: "online",
        type: "human",
      },
    ] as const);

const starterAgents = [
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000020",
    name: "Triage Agent",
    initials: "TA",
    purpose: "Correlates alerts and recommends disposition.",
    runtime: "Codex subscription",
    model: "Configured Codex model",
    status: "active",
    owner: "Jordan Blake",
    tools: ["alerts.read", "investigations.update", "knowledge.search"],
    rooms: 4,
    lastRun: "3 min ago",
    successRate: "96.8%",
    killSwitch: false,
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000021",
    name: "Tawny Hunt Agent",
    initials: "TH",
    purpose: "Runs bounded endpoint telemetry hunts.",
    runtime: "Codex subscription",
    model: "Configured Codex model",
    status: "running",
    owner: "Priya Nair",
    tools: ["tawny.telemetry.read", "tawny.hunts.execute"],
    rooms: 3,
    lastRun: "now",
    successRate: "98.2%",
    killSwitch: false,
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000022",
    name: "Bower Health Agent",
    initials: "BH",
    purpose: "Explains collector gaps and delivery posture.",
    runtime: "Codex subscription",
    model: "Configured Codex model",
    status: "active",
    owner: "Daniel Brooks",
    tools: ["bower.fleet.read", "bower.policy.read"],
    rooms: 2,
    lastRun: "11 min ago",
    successRate: "99.4%",
    killSwitch: false,
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000023",
    name: "Kelpie Case Agent",
    initials: "KC",
    purpose: "Drafts and synchronises formal case context.",
    runtime: "Codex subscription",
    model: "Configured Codex model",
    status: "active",
    owner: "Jordan Blake",
    tools: ["kelpie.cases.read", "kelpie.cases.create"],
    rooms: 2,
    lastRun: "18 min ago",
    successRate: "97.1%",
    killSwitch: false,
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000024",
    name: "Sentinel Query Agent",
    initials: "SQ",
    purpose: "Builds and runs bounded KQL queries.",
    runtime: "Codex subscription",
    model: "Configured Codex model",
    status: "active",
    owner: "Daniel Brooks",
    tools: ["sentinel.query.execute", "sentinel.rules.read"],
    rooms: 3,
    lastRun: "27 min ago",
    successRate: "94.6%",
    killSwitch: false,
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000025",
    name: "Threat Intelligence Agent",
    initials: "TI",
    purpose: "Enriches indicators using approved sources.",
    runtime: "Codex subscription",
    model: "Configured Codex model",
    status: "active",
    owner: "Maya Chen",
    tools: ["threat-intel.lookup", "knowledge.search"],
    rooms: 4,
    lastRun: "6 min ago",
    successRate: "97.9%",
    killSwitch: false,
  },
] as const;

export const demoAgents = demoMode
  ? starterAgents
  : [
      {
        id: "018f55d8-c4c7-7c3e-88ef-000000000020",
        name: "Alfie",
        initials: "AL",
        purpose:
          "Researches threat news, vendor developments, and security platform changes.",
        runtime: "Codex subscription",
        model: "Configured Codex model",
        status: "active",
        owner: "Muster Administrator",
        tools: ["alerts.read", "kelpie.cases.read", "sentinel.rules.read"],
        rooms: 2,
        lastRun: "Never",
        successRate: "—",
        killSwitch: false,
      },
      {
        id: "018f55d8-c4c7-7c3e-88ef-000000000021",
        name: "Jessie",
        initials: "JE",
        purpose:
          "Runs bounded threat hunts, maps IoCs to TTPs, and guides analysts.",
        runtime: "Codex subscription",
        model: "Configured Codex model",
        status: "active",
        owner: "Muster Administrator",
        tools: [
          "tawny.telemetry.read",
          "tawny.hunts.execute",
          "sentinel.query.execute",
        ],
        rooms: 2,
        lastRun: "Never",
        successRate: "—",
        killSwitch: false,
      },
      {
        id: "018f55d8-c4c7-7c3e-88ef-000000000025",
        name: "Parker",
        initials: "PA",
        purpose:
          "Produces evidence-linked operational reports and executive briefings.",
        runtime: "Codex subscription",
        model: "Configured Codex model",
        status: "active",
        owner: "Muster Administrator",
        tools: ["investigations.read", "kelpie.cases.read", "audit.read"],
        rooms: 2,
        lastRun: "Never",
        successRate: "—",
        killSwitch: false,
      },
    ] as const;

const demoRoomRows = [
  { slug: "soc-operations", name: "soc-operations", topic: "Daily coordination, shift handover and operational updates", unread: 8, mentions: 2, type: "operations", favourite: true },
  { slug: "alerts", name: "alerts", topic: "Incoming security signals and triage discussion", unread: 12, mentions: 3, type: "system", favourite: true },
  { slug: "active-incidents", name: "active-incidents", topic: "Coordination for active security incidents", unread: 4, mentions: 1, type: "incident", favourite: true },
  { slug: "threat-intelligence", name: "threat-intelligence", topic: "Indicator enrichment and intelligence sharing", unread: 0, mentions: 0, type: "operations", favourite: false },
  { slug: "detection-engineering", name: "detection-engineering", topic: "Detection proposals, reviews and releases", unread: 3, mentions: 0, type: "engineering", favourite: false },
  { slug: "endpoint-security", name: "endpoint-security", topic: "Tawny detections, endpoint hunts and response", unread: 0, mentions: 0, type: "operations", favourite: false },
  { slug: "bower-telemetry-health", name: "bower-telemetry-health", topic: "Collector posture, source coverage and delivery health", unread: 1, mentions: 0, type: "system", favourite: false },
  { slug: "incident-KP-2026-0042", name: "incident-KP-2026-0042", topic: "Malicious PowerShell — credential access", unread: 6, mentions: 2, type: "incident", favourite: true },
  { slug: "investigation-suspicious-powershell", name: "investigation-suspicious-powershell", topic: "Correlating Bower identity signals with Tawny endpoint activity", unread: 5, mentions: 1, type: "investigation", favourite: true },
] as const;

export const demoRooms = demoMode
  ? demoRoomRows
  : ([
      {
        slug: "soc-operations",
        name: "soc-operations",
        topic: "Security operations coordination",
        unread: 0,
        mentions: 0,
        type: "operations",
        favourite: true,
      },
    ] as const);

const demoDirectRoomRows = [
  {
    slug: "dm-maya-chen",
    name: "Maya Chen",
    topic: "Senior Analyst",
    initials: "MC",
    presence: "online",
    agent: false,
  },
  {
    slug: "dm-triage-agent",
    name: "Triage Agent",
    topic: "Correlates signals and recommends disposition",
    initials: "TA",
    presence: "online",
    agent: true,
  },
  {
    slug: "dm-tawny-hunt-agent",
    name: "Tawny Hunt Agent",
    topic: "Runs bounded endpoint telemetry hunts",
    initials: "TH",
    presence: "away",
    agent: true,
  },
] as const;

export const demoDirectRooms = demoMode
  ? demoDirectRoomRows
  : ([
      {
        slug: "dm-alfie",
        name: "Alfie",
        topic: "Threat and technology research",
        initials: "AL",
        presence: "online",
        agent: true,
      },
      {
        slug: "dm-jessie",
        name: "Jessie",
        topic: "Threat hunting, enrichment, and analyst guidance",
        initials: "JE",
        presence: "online",
        agent: true,
      },
      {
        slug: "dm-parker",
        name: "Parker",
        topic: "Operational reports and executive briefings",
        initials: "PA",
        presence: "online",
        agent: true,
      },
    ] as const);

export const roomIdBySlug: Record<string, string> = {
  "soc-operations": "018f55d8-c4c7-7c3e-88ef-000000000100",
  "active-incidents": "018f55d8-c4c7-7c3e-88ef-000000000101",
  "threat-intelligence": "018f55d8-c4c7-7c3e-88ef-000000000102",
  "detection-engineering": "018f55d8-c4c7-7c3e-88ef-000000000103",
  "endpoint-security": "018f55d8-c4c7-7c3e-88ef-000000000104",
  "bower-telemetry-health": "018f55d8-c4c7-7c3e-88ef-000000000105",
  "incident-KP-2026-0042": "018f55d8-c4c7-7c3e-88ef-000000000106",
  "investigation-suspicious-powershell": "018f55d8-c4c7-7c3e-88ef-000000000107",
  alerts: "018f55d8-c4c7-7c3e-88ef-000000000108",
  "dm-maya-chen": "018f55d8-c4c7-7c3e-88ef-000000000109",
  "dm-triage-agent": "018f55d8-c4c7-7c3e-88ef-000000000110",
  "dm-tawny-hunt-agent": "018f55d8-c4c7-7c3e-88ef-000000000111",
  "dm-alfie": "018f55d8-c4c7-7c3e-88ef-000000000110",
  "dm-jessie": "018f55d8-c4c7-7c3e-88ef-000000000111",
  "dm-parker": "018f55d8-c4c7-7c3e-88ef-000000000112",
};

const demoAlertRows = [
  {
    id: "ALT-2026-1042",
    severity: "critical" as Severity,
    title: "Suspicious PowerShell with encoded command",
    source: "Tawny",
    rule: "Suspicious PowerShell execution",
    entity: "WS-1042 · jsmith",
    occurred: "16:21:08",
    received: "16:21:11",
    status: "investigating",
    assignee: "Maya Chen",
    correlations: 7,
  },
  {
    id: "ALT-2026-1041",
    severity: "high" as Severity,
    title: "Repeated authentication failures from legacy portal",
    source: "Bower",
    rule: "Authentication failure burst",
    entity: "jsmith · 203.0.113.44",
    occurred: "16:18:39",
    received: "16:18:43",
    status: "promoted",
    assignee: "Maya Chen",
    correlations: 12,
  },
  {
    id: "ALT-2026-1040",
    severity: "high" as Severity,
    title: "Impossible travel between Sydney and Frankfurt",
    source: "Sentinel",
    rule: "Identity impossible travel",
    entity: "a.romero@example.invalid",
    occurred: "15:57:12",
    received: "15:59:02",
    status: "new",
    assignee: "Unassigned",
    correlations: 3,
  },
  {
    id: "ALT-2026-1039",
    severity: "medium" as Severity,
    title: "Unsigned binary created in user startup path",
    source: "Tawny",
    rule: "Persistence startup folder",
    entity: "WS-1098 · lwu",
    occurred: "15:44:50",
    received: "15:44:55",
    status: "acknowledged",
    assignee: "Priya Nair",
    correlations: 2,
  },
  {
    id: "ALT-2026-1038",
    severity: "low" as Severity,
    title: "Bower collector policy hash drift",
    source: "Bower",
    rule: "Collector policy drift",
    entity: "legacy-finance-au-02",
    occurred: "15:31:03",
    received: "15:31:29",
    status: "new",
    assignee: "Daniel Brooks",
    correlations: 1,
  },
] as const;

export const demoAlerts = demoMode ? demoAlertRows : [];

export const activeInvestigation = {
  id: "018f55d8-c4c7-7c3e-88ef-000000000200",
  number: "INV-2026-0178",
  title: "Legacy portal credential access and suspicious PowerShell",
  severity: "critical" as Severity,
  status: "awaiting approval",
  lead: "Maya Chen",
  participants: ["MC", "PN", "JM", "TA", "TH"],
  linkedAlerts: 2,
  linkedCase: "KP-2026-0042",
  created: "26 Jul 2026, 16:23",
  lastActivity: "2 min ago",
  summary:
    "Bower authentication failures and Tawny endpoint activity correlate on user jsmith, source IP 203.0.113.44, endpoint WS-1042, and a six-minute window.",
  recommendation:
    "Promote to a formal Kelpie case and isolate WS-1042 after human approval.",
  hypotheses: [
    {
      id: "HYP-12",
      statement: "Stolen portal credentials were used before endpoint execution.",
      status: "supported",
      confidence: 84,
      support: 4,
      contradict: 0,
      owner: "Maya Chen",
    },
    {
      id: "HYP-13",
      statement: "PowerShell activity is routine administrator automation.",
      status: "contradicted",
      confidence: 91,
      support: 0,
      contradict: 3,
      owner: "Triage Agent",
    },
    {
      id: "HYP-14",
      statement: "Destination infrastructure belongs to a known campaign.",
      status: "unverified",
      confidence: 43,
      support: 1,
      contradict: 0,
      owner: "Threat Intelligence Agent",
    },
    {
      id: "HYP-15",
      statement: "Persistence was established through the startup folder.",
      status: "inconclusive",
      confidence: 58,
      support: 1,
      contradict: 1,
      owner: "Priya Nair",
    },
  ],
  findings: [
    {
      id: "FND-87",
      title: "Encoded PowerShell retrieved second-stage content",
      severity: "critical" as Severity,
      confidence: 94,
      author: "Tawny Hunt Agent",
      authorType: "agent",
      runtime: "Codex subscription · configured model",
      reviewed: true,
      evidence: 5,
      summary:
        "powershell.exe decoded a command that contacted cdn-auth-check.example and wrote update.dat before execution.",
      action: "Isolate WS-1042 and preserve volatile endpoint evidence.",
    },
    {
      id: "FND-88",
      title: "Portal failures share identity and source IP",
      severity: "high" as Severity,
      confidence: 98,
      author: "Maya Chen",
      authorType: "human",
      reviewed: true,
      evidence: 3,
      summary:
        "Twelve failed sign-ins and one successful sign-in targeted jsmith from 203.0.113.44.",
      action: "Reset credentials and review active identity sessions.",
    },
    {
      id: "FND-89",
      title: "Destination infrastructure is newly observed",
      severity: "medium" as Severity,
      confidence: 71,
      author: "Threat Intelligence Agent",
      authorType: "agent",
      runtime: "Codex subscription · configured model",
      reviewed: false,
      evidence: 4,
      summary:
        "Domain age is three days. Passive DNS links the IP to two short-lived authentication-themed domains.",
      action: "Review and approve network indicator block.",
    },
  ],
} as const;

const demoRoomTimeline = [
  {
    id: "msg-1",
    type: "system",
    time: "16:23",
    title: "Investigation created",
    body: "INV-2026-0178 created from ALT-2026-1041 and ALT-2026-1042.",
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000701",
    type: "human",
    author: "Maya Chen",
    initials: "MC",
    role: "Senior Analyst",
    time: "16:24",
    body: "The Bower and Tawny events share the same user and source IP. Starting with endpoint activity from 16:10 to 16:30.",
    reactions: [{ emoji: "eyes", label: "Reviewing", count: 3 }],
    replies: 3,
  },
  {
    id: "msg-3",
    type: "alert",
    time: "16:25",
    severity: "critical" as Severity,
    title: "Suspicious PowerShell with encoded command",
    body: "WS-1042 · jsmith · sigma-123 · 7 correlated events",
    meta: "Tawny · ALT-2026-1042",
  },
  {
    id: "msg-4",
    type: "agent",
    author: "Tawny Hunt Agent",
    initials: "TH",
    role: "Agent · Codex subscription",
    time: "16:27",
    body: "Hunt completed. Found a PowerShell process tree, two outbound connections, and one file write matching the investigation window.",
    status: "completed",
    confidence: 94,
    tools: ["tawny.hunt", "tawny.process_tree", "tawny.network"],
    evidence: 5,
    reviewed: true,
    replies: 2,
  },
  {
    id: "msg-5",
    type: "finding",
    time: "16:29",
    severity: "critical" as Severity,
    title: "Encoded PowerShell retrieved second-stage content",
    body: "Process, network, and file telemetry support malicious execution with 94% confidence.",
    meta: "FND-87 · 5 evidence references · human reviewed",
  },
  {
    id: "018f55d8-c4c7-7c3e-88ef-000000000705",
    type: "human",
    author: "Priya Nair",
    initials: "PN",
    role: "Incident Responder",
    time: "16:31",
    body: "Endpoint is still online. I support isolation, but preserve current sessions and memory acquisition status first.",
    reactions: [{ emoji: "check", label: "Agreed", count: 2 }],
    replies: 0,
  },
  {
    id: "msg-7",
    type: "approval",
    time: "16:34",
    severity: "high" as Severity,
    title: "Approval required: isolate WS-1042",
    body: "Stops network activity on a production finance endpoint. Existing sessions may terminate.",
    meta: "Requested by Triage Agent · expires in 22 min · 1 approval required",
    status: "pending",
  },
  {
    id: "msg-8",
    type: "case",
    time: "16:37",
    severity: "critical" as Severity,
    title: "Kelpie case linked: KP-2026-0042",
    body: "Credential access and endpoint execution, assigned to Priya Nair. Playbook: Compromised endpoint and identity.",
    meta: "Kelpie mock · authoritative case lifecycle",
  },
] as const;

export const roomTimeline = demoMode ? demoRoomTimeline : [];

export const needsAttention = [
  {
    severity: "critical" as Severity,
    title: "Suspicious PowerShell on WS-1042",
    source: "Tawny",
    owner: "Maya Chen",
    age: "18 min",
    state: "Investigating",
    action: "Open",
    href: "/rooms/investigation-suspicious-powershell",
  },
  {
    severity: "high" as Severity,
    title: "Endpoint isolation awaiting approval",
    source: "Muster",
    owner: "Jordan Blake",
    age: "9 min",
    state: "Pending",
    action: "Review",
    href: "/approvals",
  },
  {
    severity: "high" as Severity,
    title: "Collector legacy-finance-au-02 is stale",
    source: "Bower",
    owner: "Daniel Brooks",
    age: "34 min",
    state: "Degraded",
    action: "Inspect",
    href: "/integrations/bower",
  },
  {
    severity: "medium" as Severity,
    title: "Identity enrichment workflow stalled",
    source: "Worker",
    owner: "Unassigned",
    age: "11 min",
    state: "Retrying",
    action: "Resume",
    href: "/workflows/identity-enrichment",
  },
] as const;

export const activeIncidents = [
  {
    case: "KP-2026-0042",
    title: "Credential access and endpoint execution",
    severity: "critical" as Severity,
    state: "Containment",
    commander: "Priya Nair",
    age: "42 min",
    activity: "2 min ago",
    room: "incident-KP-2026-0042",
    sla: "On track",
  },
  {
    case: "KP-2026-0039",
    title: "Exposed cloud service principal",
    severity: "high" as Severity,
    state: "Investigation",
    commander: "Jordan Blake",
    age: "3 h",
    activity: "14 min ago",
    room: "active-incidents",
    sla: "38 min left",
  },
] as const;

export const investigationQueue = [
  {
    number: "INV-2026-0178",
    title: activeInvestigation.title,
    severity: "critical" as Severity,
    lead: "Maya Chen",
    alerts: 2,
    agents: 4,
    activity: "2 min ago",
    recommendation: "Promote",
  },
  {
    number: "INV-2026-0177",
    title: "Impossible travel for privileged identity",
    severity: "high" as Severity,
    lead: "Unassigned",
    alerts: 3,
    agents: 1,
    activity: "19 min ago",
    recommendation: "Investigate",
  },
  {
    number: "INV-2026-0174",
    title: "Unsigned persistence artefact",
    severity: "medium" as Severity,
    lead: "Priya Nair",
    alerts: 1,
    agents: 2,
    activity: "1 h ago",
    recommendation: "Monitor",
  },
] as const;

export const platformHealth = [
  { name: "Muster worker", status: "healthy", detail: "9 queues active" },
  { name: "PostgreSQL", status: "healthy", detail: "18 ms" },
  { name: "Redis", status: "healthy", detail: "6 ms" },
  { name: "Object storage", status: "healthy", detail: "MinIO · mock" },
  { name: "Agent gateway", status: "healthy", detail: "3 runtimes" },
  { name: "Kelpie", status: "healthy", detail: "Mock · 42 ms" },
  { name: "Tawny", status: "healthy", detail: "Mock · 57 ms" },
  { name: "Bower", status: "degraded", detail: "1 stale collector" },
  { name: "Sentinel", status: "healthy", detail: "Mock · 83 ms" },
] as const;

export const operationsTrend = [
  { time: "10:00", alerts: 11, investigations: 2 },
  { time: "11:00", alerts: 18, investigations: 4 },
  { time: "12:00", alerts: 14, investigations: 3 },
  { time: "13:00", alerts: 27, investigations: 6 },
  { time: "14:00", alerts: 21, investigations: 5 },
  { time: "15:00", alerts: 32, investigations: 7 },
  { time: "16:00", alerts: 24, investigations: 5 },
] as const;

export const workflows = [
  {
    id: "suspicious-powershell-triage",
    name: "Suspicious PowerShell triage",
    version: "1.0.0",
    trigger: "endpoint.alert.created",
    status: "published",
    enabled: true,
    owner: "Maya Chen",
    lastRun: "4 min ago",
    successRate: "94.7%",
    steps: 7,
  },
  {
    id: "bower-source-stale",
    name: "Bower source stale response",
    version: "1.2.0",
    trigger: "telemetry.source.stale",
    status: "published",
    enabled: true,
    owner: "Daniel Brooks",
    lastRun: "34 min ago",
    successRate: "99.1%",
    steps: 5,
  },
  {
    id: "critical-case-close",
    name: "Critical incident closure",
    version: "0.4.0",
    trigger: "manual",
    status: "draft",
    enabled: false,
    owner: "Jordan Blake",
    lastRun: "Never",
    successRate: "—",
    steps: 8,
  },
] as const;

export const workflowYaml = `apiVersion: muster.security/v1
kind: Workflow
metadata:
  id: suspicious-powershell-triage
  name: Suspicious PowerShell triage
  version: 1.0.0

trigger:
  eventType: endpoint.alert.created
  conditions:
    severity:
      in: [high, critical]

steps:
  - id: create-investigation
    action: muster.investigations.create

  - id: gather-endpoint-context
    agent: tawny-hunt
    permissions:
      - tawny.telemetry.read
      - tawny.hunts.execute

  - id: enrich-observables
    agent: threat-intelligence
    outputSchema: ThreatIntelFinding

  - id: analyst-review
    approval:
      capability: investigations.promote
      timeout: 30m

  - id: promote
    when: "{{ steps.analyst-review.decision == 'approved' }}"
    action: kelpie.case.create
`;

export const integrationData = {
  bower: {
    name: "Bower",
    subtitle: "Trusted application telemetry bridge",
    status: "degraded",
    mock: true,
    stats: [
      ["Collectors", "18"],
      ["Healthy", "16"],
      ["Stale", "1"],
      ["Pending", "1"],
      ["Queue depth", "284"],
      ["Sources reporting", "42 / 44"],
    ],
    rows: [
      ["legacy-portal-au-01", "Active", "12 s ago", "0", "Healthy", "3 / 3"],
      ["legacy-finance-au-02", "Active", "34 min ago", "284", "Degraded", "4 / 5"],
      ["customer-api-au-01", "Active", "18 s ago", "0", "Healthy", "6 / 6"],
      ["warehouse-erp-au-01", "Pending", "Never", "0", "Awaiting approval", "0 / 4"],
    ],
  },
  tawny: {
    name: "Tawny",
    subtitle: "Endpoint telemetry, detection and bounded response",
    status: "healthy",
    mock: true,
    stats: [
      ["Endpoints", "412"],
      ["Online", "398"],
      ["Offline", "9"],
      ["Stale", "5"],
      ["Open alerts", "27"],
      ["Actions pending", "1"],
    ],
    rows: [
      ["WS-1042", "Online", "12 s ago", "Windows 11", "High", "Isolation pending"],
      ["WS-1098", "Online", "8 s ago", "Windows 11", "Medium", "No action"],
      ["SRV-FIN-02", "Online", "21 s ago", "Windows Server 2022", "Low", "No action"],
      ["LAP-2041", "Offline", "2 h ago", "macOS 15", "Informational", "No action"],
    ],
  },
  kelpie: {
    name: "Kelpie",
    subtitle: "Authoritative incident case management",
    status: "healthy",
    mock: true,
    stats: [
      ["Open cases", "7"],
      ["Critical", "1"],
      ["SLA at risk", "1"],
      ["Tasks open", "23"],
      ["Playbooks active", "5"],
      ["Last sync", "42 s"],
    ],
    rows: [
      ["KP-2026-0042", "Credential access and endpoint execution", "Containment", "Critical", "Priya Nair", "2 min ago"],
      ["KP-2026-0039", "Exposed cloud service principal", "Investigation", "High", "Jordan Blake", "14 min ago"],
      ["KP-2026-0037", "Suspicious mailbox forwarding rule", "Monitoring", "Medium", "Maya Chen", "1 h ago"],
      ["KP-2026-0033", "Public storage container", "Resolved", "Low", "Daniel Brooks", "Yesterday"],
    ],
  },
} as const;

const demoSearchResults = [
  {
    group: "Messages",
    title: "Encoded PowerShell retrieved second-stage content",
    context: "#investigation-suspicious-powershell · Tawny Hunt Agent",
    snippet: "Found a PowerShell process tree, two outbound connections, and one file write…",
  },
  {
    group: "Alerts",
    title: "ALT-2026-1042 · Suspicious PowerShell with encoded command",
    context: "Tawny · critical · WS-1042",
    snippet: "Sigma rule sigma-123 matched powershell.exe with encoded command line.",
  },
  {
    group: "Investigations",
    title: "INV-2026-0178 · Legacy portal credential access",
    context: "Awaiting approval · Maya Chen",
    snippet: "Bower authentication failures and Tawny endpoint activity correlate on jsmith…",
  },
  {
    group: "Cases",
    title: "KP-2026-0042 · Credential access and endpoint execution",
    context: "Kelpie · Containment · Priya Nair",
    snippet: "Formal incident linked to INV-2026-0178.",
  },
  {
    group: "Findings",
    title: "FND-87 · Encoded PowerShell retrieved content",
    context: "94% confidence · 5 evidence references",
    snippet: "Contacted cdn-auth-check.example and wrote update.dat before execution.",
  },
  {
    group: "Evidence",
    title: "WS-1042-process-tree.json",
    context: "SHA-256 68b3…91ad · restricted",
    snippet: "Tawny endpoint evidence · scan clean · object lock enabled.",
  },
] as const;

export const searchResults = demoMode ? demoSearchResults : [];
