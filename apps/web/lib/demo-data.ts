const starterIds = {
  organisation: "018f55d8-c4c7-7c3e-88ef-000000000001",
  actors: {
    jordan: "018f55d8-c4c7-7c3e-88ef-000000000010",
    triage: "018f55d8-c4c7-7c3e-88ef-000000000020",
    tawnyHunt: "018f55d8-c4c7-7c3e-88ef-000000000021",
    threatIntel: "018f55d8-c4c7-7c3e-88ef-000000000025",
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
} as const;

const demoIds = {
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
  messages: {
    mayaParent: "019e7a10-0000-7000-8000-000000000701",
    priyaParent: "019e7a10-0000-7000-8000-000000000705",
  },
} as const;

export type Severity = "critical" | "high" | "medium" | "low" | "informational";

export const demoMode = process.env.NEXT_PUBLIC_MUSTER_DEMO_MODE === "true";

const activeIds = demoMode ? demoIds : starterIds;

export const activeInvestigation = {
  id: activeIds.investigation,
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
      statement:
        "Stolen portal credentials were used before endpoint execution.",
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
      [
        "legacy-finance-au-02",
        "Active",
        "34 min ago",
        "284",
        "Degraded",
        "4 / 5",
      ],
      ["customer-api-au-01", "Active", "18 s ago", "0", "Healthy", "6 / 6"],
      [
        "warehouse-erp-au-01",
        "Pending",
        "Never",
        "0",
        "Awaiting approval",
        "0 / 4",
      ],
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
      [
        "WS-1042",
        "Online",
        "12 s ago",
        "Windows 11",
        "High",
        "Isolation pending",
      ],
      ["WS-1098", "Online", "8 s ago", "Windows 11", "Medium", "No action"],
      [
        "SRV-FIN-02",
        "Online",
        "21 s ago",
        "Windows Server 2022",
        "Low",
        "No action",
      ],
      [
        "LAP-2041",
        "Offline",
        "2 h ago",
        "macOS 15",
        "Informational",
        "No action",
      ],
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
      [
        "KP-2026-0042",
        "Credential access and endpoint execution",
        "Containment",
        "Critical",
        "Priya Nair",
        "2 min ago",
      ],
      [
        "KP-2026-0039",
        "Exposed cloud service principal",
        "Investigation",
        "High",
        "Jordan Blake",
        "14 min ago",
      ],
      [
        "KP-2026-0037",
        "Suspicious mailbox forwarding rule",
        "Monitoring",
        "Medium",
        "Maya Chen",
        "1 h ago",
      ],
      [
        "KP-2026-0033",
        "Public storage container",
        "Resolved",
        "Low",
        "Daniel Brooks",
        "Yesterday",
      ],
    ],
  },
} as const;
