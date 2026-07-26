import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex min-h-5 items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-semibold leading-none",
        className,
      )}
      {...props}
    />
  );
}
