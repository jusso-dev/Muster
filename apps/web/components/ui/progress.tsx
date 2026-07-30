import { cn } from "@/lib/utils";

/**
 * A ratio bar. It only ever renders a value the caller measured — there is no
 * indeterminate mode, because a moving bar over an unknown value reads as
 * progress that is not happening.
 */
export function Progress({
  value,
  max = 100,
  label,
  tone = "accent",
  className,
}: {
  value: number;
  max?: number;
  /** Accessible name; the visible caption normally sits beside the bar. */
  label: string;
  tone?: "accent" | "agent" | "success" | "warning" | "error";
  className?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  const fill =
    tone === "agent"
      ? "var(--color-agent)"
      : tone === "success"
        ? "var(--color-success)"
        : tone === "warning"
          ? "var(--color-warning)"
          : tone === "error"
            ? "var(--color-error)"
            : "var(--color-accent)";

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeMax)}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-paper-3)]",
        className,
      )}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${percent}%`, background: fill }}
      />
    </div>
  );
}
