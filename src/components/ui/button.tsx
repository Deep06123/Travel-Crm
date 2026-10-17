import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-navy-500 text-white hover:bg-navy-600 active:bg-navy-700",
        secondary:
          "bg-white text-ink border border-line-strong hover:bg-surface-muted",
        /** Financial and irreversible actions. Always pair with a confirmation. */
        destructive:
          "bg-status-danger text-white hover:brightness-110 active:brightness-95",
        accent:
          "bg-amber-accent text-navy-900 hover:bg-amber-accent-dark hover:text-white",
        ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
        link: "text-navy-500 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-10 px-5 text-sm",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      // Defaulting to "button" avoids the common bug where a control inside a
      // form submits it just by being clicked.
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
