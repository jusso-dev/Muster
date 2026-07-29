import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card px-6 py-12 text-center"
    >
      <div className="text-muted-foreground" aria-hidden>
        {icon ?? <Inbox className="size-8" />}
      </div>
      <h2 className="font-display text-sm font-semibold">{title}</h2>
      {description ? (
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
