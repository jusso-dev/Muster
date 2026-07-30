import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-[4.5rem] shrink-0 flex-col items-stretch gap-3 border-b px-4 py-3 tablet:flex-row tablet:items-center tablet:gap-4 tablet:px-5">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-xl font-semibold tracking-[-0.015em]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 tablet:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
}
