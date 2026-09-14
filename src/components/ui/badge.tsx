import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-muted-foreground",
        brand: "border-brand-border bg-brand-soft text-brand-strong",
        success: "border-success-border bg-success-soft text-success-strong",
        warning: "border-warning-border bg-warning-soft text-warning-strong",
        danger: "border-danger-border bg-danger-soft text-danger-strong",
        info: "border-info-border bg-info-soft text-info-strong",
        solid: "border-transparent bg-foreground text-card",
      },
      size: {
        sm: "px-1.5 py-0 text-[11px]",
        md: "px-2 py-0.5 text-xs",
        lg: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

export { badgeVariants };
