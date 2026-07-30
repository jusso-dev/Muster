import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One content container for every OS page, so padding, rhythm, and measure
 * stay identical as views are added. Pick a width by content density rather
 * than picking a Tailwind class per page.
 */
const widths = {
  /** Reading-width detail and forms. */
  narrow: "max-w-3xl",
  /** Default: lists, tables, card grids. */
  wide: "max-w-7xl",
  /** Dense multi-column dashboards and the board. */
  full: "max-w-[100rem]",
} as const;

export function PageBody({
  width = "wide",
  className,
  children,
}: {
  width?: keyof typeof widths;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex flex-col gap-5 p-4 tablet:p-5",
        widths[width],
        className,
      )}
    >
      {children}
    </div>
  );
}
