/**
 * Development/fixture catalogue for governed capability packs.
 * Source packs live under skills/; installation remains backend-governed.
 * Marked origin: fixture until a first-class capability install API exists.
 */
import type { CapabilityPack } from "@/types/os";

export const FIXTURE_CAPABILITY_PACKS: CapabilityPack[] = [
  {
    id: "fixture:soc-operations",
    name: "SOC operations",
    description:
      "Governed SOC triage, prioritisation, and handoff patterns for Parker-led ops.",
    version: "0.1.0",
    source: "skills/muster-soc-operations",
    category: "security-operations",
    installed: true,
    enabled: true,
    validationStatus: "valid",
    requiredConnectors: ["kelpie", "slack"],
    allowedAgentRoles: ["parker"],
    approvalRequired: false,
    dataClassification: "operational",
    origin: "fixture",
  },
  {
    id: "fixture:threat-hunting",
    name: "Threat hunting",
    description:
      "Bounded hunt workflows for Jessie with Tawny/UniFi evidence requirements.",
    version: "0.1.0",
    source: "skills/muster-threat-hunting",
    category: "threat-hunting",
    installed: true,
    enabled: true,
    validationStatus: "valid",
    requiredConnectors: ["tawny", "unifi"],
    allowedAgentRoles: ["jessie"],
    approvalRequired: true,
    dataClassification: "sensitive",
    origin: "fixture",
  },
  {
    id: "fixture:kelpie-case-management",
    name: "Kelpie case management",
    description:
      "Coordination around Kelpie cases without replacing Kelpie as system of record.",
    version: "0.1.0",
    source: "skills/muster-kelpie-case-management",
    category: "case-coordination",
    installed: true,
    enabled: true,
    validationStatus: "valid",
    requiredConnectors: ["kelpie"],
    allowedAgentRoles: ["parker", "jessie", "alfie"],
    approvalRequired: true,
    dataClassification: "customer",
    origin: "fixture",
  },
  {
    id: "fixture:evidence-handling",
    name: "Evidence handling",
    description:
      "Evidence capture, retention metadata, and untrusted connector content rules.",
    version: "0.1.0",
    source: "skills/muster-evidence-handling",
    category: "evidence",
    installed: true,
    enabled: true,
    validationStatus: "valid",
    requiredConnectors: ["evidence-storage"],
    allowedAgentRoles: ["parker", "jessie", "alfie"],
    approvalRequired: true,
    dataClassification: "sensitive",
    origin: "fixture",
  },
  {
    id: "fixture:security-reporting",
    name: "Security reporting",
    description:
      "Governed ops and executive report generation with review gates.",
    version: "0.1.0",
    source: "skills/muster-security-reporting",
    category: "reporting",
    installed: true,
    enabled: true,
    validationStatus: "valid",
    requiredConnectors: ["slack", "kelpie"],
    allowedAgentRoles: ["parker"],
    approvalRequired: true,
    dataClassification: "operational",
    origin: "fixture",
  },
];
