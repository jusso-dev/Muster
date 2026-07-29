/**
 * Canonical Security Company OS status vocabulary.
 * One system only — do not invent parallel badge enums in features.
 */

export const SEVERITIES = [
  "informational",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type Severity = (typeof SEVERITIES)[number];

export const OPERATIONAL_STATES = [
  "queued",
  "running",
  "waiting",
  "blocked",
  "review",
  "completed",
  "failed",
  "cancelled",
] as const;
export type OperationalState = (typeof OPERATIONAL_STATES)[number];

export const HEALTH_STATES = [
  "healthy",
  "degraded",
  "unhealthy",
  "unknown",
] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export const APPROVAL_STATES = [
  "not-required",
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

/** Map control-plane / readiness strings into HealthState. */
export function toHealthState(value: string | null | undefined): HealthState {
  if (!value) return "unknown";
  const v = value.toLowerCase();
  if (v === "ready" || v === "healthy" || v === "active" || v === "completed")
    return "healthy";
  if (v === "degraded" || v === "configured" || v === "queued" || v === "waiting")
    return "degraded";
  if (
    v === "unavailable" ||
    v === "failed" ||
    v === "unhealthy" ||
    v === "error" ||
    v === "suspended"
  )
    return "unhealthy";
  return "unknown";
}

/** Map approval row status into ApprovalState. */
export function toApprovalState(value: string | null | undefined): ApprovalState {
  if (!value) return "not-required";
  const v = value.toLowerCase();
  if (v === "pending") return "pending";
  if (v === "approved") return "approved";
  if (v === "rejected") return "rejected";
  if (v === "expired") return "expired";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  return "not-required";
}

/** Map task / run status into OperationalState. */
export function toOperationalState(
  value: string | null | undefined,
): OperationalState {
  if (!value) return "queued";
  const v = value.toLowerCase();
  if (v === "backlog" || v === "todo" || v === "open" || v === "queued")
    return "queued";
  if (v === "in_progress" || v === "running" || v === "active") return "running";
  if (v === "waiting" || v === "awaiting_approval" || v === "blocked_on_approval")
    return "waiting";
  if (v === "blocked") return "blocked";
  if (v === "review" || v === "in_review") return "review";
  if (v === "done" || v === "completed" || v === "closed" || v === "resolved")
    return "completed";
  if (v === "failed" || v === "error") return "failed";
  if (v === "cancelled" || v === "canceled" || v === "archived")
    return "cancelled";
  return "queued";
}
