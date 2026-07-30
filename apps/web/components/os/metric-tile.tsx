import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Sparkline } from "@/components/os/charts";
import { cn } from "@/lib/utils";
import type { CommandMetric } from "@/types/os";

/**
 * One operational count per tile: label, current value, and — only where the
 * database can answer it — how the last 24 hours compared with the 24 before,
 * plus the seven-day series behind the number. Tiles without real history stay
 * plain rather than growing decorative trend chrome.
 */
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

  const trend = metric.trend;
  const good =
    trend && trend.improving !== "neutral" && trend.direction !== "flat"
      ? trend.direction === trend.improving
      : null;
  const trendTone =
    good === null
      ? "text-muted-foreground"
      : good
        ? "text-[var(--color-success)]"
        : "text-[var(--color-error)]";
  const TrendIcon =
    trend?.direction === "up"
      ? ArrowUpRight
      : trend?.direction === "down"
        ? ArrowDownRight
        : ArrowRight;

  const sparkTone =
    metric.tone === "danger"
      ? "negative"
      : metric.tone === "warning"
        ? "warning"
        : metric.tone === "success"
          ? "positive"
          : "neutral";

  const content = (
    <>
      <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p
          className={cn(
            "font-display text-3xl font-semibold leading-none tabular-nums",
            valueTone,
          )}
        >
          {metric.value}
        </p>
        {metric.series && metric.series.some((point) => point > 0) ? (
          <Sparkline
            values={metric.series}
            tone={sparkTone}
            label={metric.seriesLabel ?? `${metric.label} over the last 7 days`}
          />
        ) : null}
      </div>
      {trend ? (
        <p className={cn("mt-2 flex items-center gap-1 text-xs", trendTone)}>
          <TrendIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="font-semibold tabular-nums">
            {trend.delta > 0 ? "+" : ""}
            {trend.delta}
          </span>
          <span className="text-muted-foreground">{trend.label}</span>
        </p>
      ) : null}
      {metric.hint ? (
        <p className="mt-2 text-xs text-muted-foreground">{metric.hint}</p>
      ) : null}
    </>
  );

  const className = cn(
    "block rounded-lg border bg-card p-4 transition-colors",
    tone,
    metric.href && "hover:border-[var(--color-rule-strong)]",
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
