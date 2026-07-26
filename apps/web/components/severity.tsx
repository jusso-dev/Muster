import {
  CircleAlert,
  CircleDot,
  Info,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type { Severity } from "@/lib/demo-data";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const severityIcons = {
  critical: ShieldAlert,
  high: TriangleAlert,
  medium: CircleAlert,
  low: CircleDot,
  informational: Info,
};

export function SeverityBadge({
  severity,
  compact = false,
}: {
  severity: Severity;
  compact?: boolean;
}) {
  const Icon = severityIcons[severity];
  return (
    <Badge
      className={cn(`severity-${severity}`, compact && "px-1")}
      aria-label={`Severity: ${severity}`}
    >
      <Icon aria-hidden="true" className="size-3" />
      {!compact && <span className="capitalize">{severity}</span>}
    </Badge>
  );
}
