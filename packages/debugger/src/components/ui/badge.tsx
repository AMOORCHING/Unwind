import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "bg-uw-surface text-uw-muted border border-uw-border-subtle",
        success: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
        info: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
        warning: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
        destructive: "bg-red-500/10 text-red-400 border border-red-500/20",
        status: "rounded-full px-2.5 py-0.5 text-xs font-medium border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
