import { cn } from "@/lib/utils";

export function Avatar({
  initials,
  agent = false,
  size = "md",
  className,
}: {
  initials: string;
  agent?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-md border font-display font-bold",
        agent
          ? "agent-surface border-[var(--color-agent)]"
          : "border-border bg-[var(--color-raised)] text-foreground",
        size === "sm" && "size-6 text-xs",
        size === "md" && "size-8 text-xs",
        size === "lg" && "size-10 text-xs",
        className,
      )}
    >
      {initials}
    </span>
  );
}
