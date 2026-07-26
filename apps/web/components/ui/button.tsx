import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "button-motion inline-flex min-h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border text-xs font-semibold focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=loading]:cursor-wait data-[state=error]:border-[var(--color-error)] data-[state=error]:text-[var(--color-error)] data-[state=success]:border-[var(--color-success)] data-[state=success]:text-[var(--color-success)] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-[var(--color-accent-hover)]",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:bg-[var(--color-raised)]",
        outline:
          "border-border bg-transparent text-foreground hover:border-[var(--color-rule-strong)] hover:bg-muted",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive:
          "border-[var(--color-error)] bg-[var(--color-error-soft)] text-[var(--color-error)] hover:bg-[var(--color-critical-soft)]",
      },
      size: {
        sm: "h-8 min-h-8 px-2.5 text-xs",
        default: "h-9 px-3",
        lg: "h-11 px-4 text-sm",
        icon: "size-9 min-h-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  state?: "default" | "loading" | "error" | "success";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, state = "default", ...props }, ref) => (
    <button
      ref={ref}
      data-slot="button"
      data-state={state}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
