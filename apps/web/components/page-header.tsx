import type { ReactNode } from "react";

/**
 * The page's own title block, sitting under the application top bar. It states
 * the page and its actions; product chrome stays above it.
 */
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
    <header className="mx-auto flex w-full max-w-[100rem] shrink-0 flex-col items-stretch gap-3 px-4 pb-1 pt-5 tablet:flex-row tablet:items-start tablet:gap-4 tablet:px-5">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-2xl font-semibold tracking-[-0.015em]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 tablet:justify-end tablet:pt-1">
          {actions}
        </div>
      )}
    </header>
  );
}
