import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleDot,
  Clock3,
  Info,
  Loader2,
  PauseCircle,
  ShieldAlert,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  ApprovalState,
  HealthState,
  OperationalState,
  Severity,
} from "@/types/status";

const severityConfig: Record<
  Severity,
  { icon: typeof Info; className: string; label: string }
> = {
  informational: {
    icon: Info,
    className: "severity-informational",
    label: "Informational",
  },
  low: { icon: CircleDot, className: "severity-low", label: "Low" },
  medium: {
    icon: CircleAlert,
    className: "severity-medium",
    label: "Medium",
  },
  high: {
    icon: TriangleAlert,
    className: "severity-high",
    label: "High",
  },
  critical: {
    icon: ShieldAlert,
    className: "severity-critical",
    label: "Critical",
  },
};

const healthConfig: Record<
  HealthState,
  { icon: typeof CheckCircle2; className: string; label: string }
> = {
  healthy: {
    icon: CheckCircle2,
    className: "success-surface text-[var(--color-success)]",
    label: "Healthy",
  },
  degraded: {
    icon: AlertTriangle,
    className: "approval-surface text-[var(--color-warning)]",
    label: "Degraded",
  },
  unhealthy: {
    icon: XCircle,
    className: "border-[var(--color-error)]/40 bg-[var(--color-error-soft)] text-[var(--color-error)]",
    label: "Unhealthy",
  },
  unknown: {
    icon: CircleDashed,
    className: "bg-muted text-muted-foreground",
    label: "Unknown",
  },
};

const operationalConfig: Record<
  OperationalState,
  { icon: typeof Loader2; className: string; label: string }
> = {
  queued: {
    icon: Clock3,
    className: "bg-muted text-muted-foreground",
    label: "Queued",
  },
  running: {
    icon: Loader2,
    className: "border-[var(--color-info)]/40 bg-[var(--color-info-soft)] text-[var(--color-info)]",
    label: "Running",
  },
  waiting: {
    icon: PauseCircle,
    className: "approval-surface text-[var(--color-warning)]",
    label: "Waiting",
  },
  blocked: {
    icon: Ban,
    className: "border-[var(--color-error)]/40 bg-[var(--color-error-soft)] text-[var(--color-error)]",
    label: "Blocked",
  },
  review: {
    icon: CircleAlert,
    className: "border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
    label: "Review",
  },
  completed: {
    icon: CheckCircle2,
    className: "success-surface text-[var(--color-success)]",
    label: "Completed",
  },
  failed: {
    icon: XCircle,
    className: "border-[var(--color-error)]/40 bg-[var(--color-error-soft)] text-[var(--color-error)]",
    label: "Failed",
  },
  cancelled: {
    icon: Ban,
    className: "bg-muted text-muted-foreground",
    label: "Cancelled",
  },
};

const approvalConfig: Record<
  ApprovalState,
  { icon: typeof Clock3; className: string; label: string }
> = {
  "not-required": {
    icon: CheckCircle2,
    className: "bg-muted text-muted-foreground",
    label: "Not required",
  },
  pending: {
    icon: Clock3,
    className: "approval-surface text-[var(--color-warning)]",
    label: "Pending",
  },
  approved: {
    icon: CheckCircle2,
    className: "success-surface text-[var(--color-success)]",
    label: "Approved",
  },
  rejected: {
    icon: XCircle,
    className: "border-[var(--color-error)]/40 bg-[var(--color-error-soft)] text-[var(--color-error)]",
    label: "Rejected",
  },
  expired: {
    icon: AlertTriangle,
    className: "approval-surface text-[var(--color-warning)]",
    label: "Expired",
  },
  cancelled: {
    icon: Ban,
    className: "bg-muted text-muted-foreground",
    label: "Cancelled",
  },
};

export function SeverityBadge({
  severity,
  compact = false,
}: {
  severity: Severity;
  compact?: boolean;
}) {
  const config = severityConfig[severity];
  const Icon = config.icon;
  return (
    <Badge className={cn(config.className, compact && "px-1")}>
      <Icon aria-hidden className="size-3" />
      {compact ? (
        <span className="sr-only">{config.label} severity</span>
      ) : (
        <span>{config.label}</span>
      )}
    </Badge>
  );
}

export function HealthBadge({ health }: { health: HealthState }) {
  const config = healthConfig[health];
  const Icon = config.icon;
  return (
    <Badge className={config.className}>
      <Icon aria-hidden className="size-3" />
      <span>{config.label}</span>
    </Badge>
  );
}

export function OperationalStateBadge({ state }: { state: OperationalState }) {
  const config = operationalConfig[state];
  const Icon = config.icon;
  return (
    <Badge className={config.className}>
      <Icon
        aria-hidden
        className={cn("size-3", state === "running" && "animate-spin")}
      />
      <span>{config.label}</span>
    </Badge>
  );
}

export function ApprovalStateBadge({ state }: { state: ApprovalState }) {
  const config = approvalConfig[state];
  const Icon = config.icon;
  return (
    <Badge className={config.className}>
      <Icon aria-hidden className="size-3" />
      <span>{config.label}</span>
    </Badge>
  );
}
