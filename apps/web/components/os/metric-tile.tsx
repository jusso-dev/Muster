import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CommandMetric } from "@/types/os";

export function MetricTile({ metric }: { metric: CommandMetric }) {
  const tone =
    metric.tone === "danger"
      ? "border-[var(--color-error)]/30"
      : metric.tone === "warning"
        ? "border-[var(--color-warning)]/30"
        : metric.tone === "success"
          ? "border-[var(--color-success)]/30"
          : "border-border";

  const valueTone =
    metric.tone === "danger"
      ? "text-[var(--color-error)]"
      : metric.tone === "warning"
        ? "text-[var(--color-warning)]"
        : metric.tone === "success"
          ? "text-[var(--color-success)]"
          : "text-foreground";

  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {metric.label}
      </p>
      <p className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", valueTone)}>
        {metric.value}
      </p>
      {metric.hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{metric.hint}</p>
      ) : null}
    </>
  );

  const className = cn(
    "block rounded-md border bg-card p-3 transition-colors",
    tone,
    metric.href && "hover:bg-muted/40 focus-visible:outline-none",
  );

  if (metric.href) {
    return (
      <Link href={metric.href} className={className}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}
