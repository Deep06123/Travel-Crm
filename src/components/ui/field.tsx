import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Form field primitives.
 *
 * `Field` wires the label, control, hint and error together through ids and
 * `aria-describedby`, so a screen reader announces the validation message with
 * the control rather than leaving it stranded elsewhere on the page.
 */

const controlClasses =
  "h-9 w-full rounded-md border border-line-strong bg-white px-3 text-sm text-ink placeholder:text-ink-subtle focus:border-navy-500 disabled:bg-surface-muted disabled:text-ink-muted";

const invalidClasses = "border-status-danger focus-visible:outline-status-danger";

export function Label({
  className,
  required,
  children,
  ...props
}: ComponentProps<"label"> & { required?: boolean }) {
  return (
    <label
      className={cn("text-sm font-medium text-ink", className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="ml-0.5 text-status-danger" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

export function Input({
  className,
  "aria-invalid": ariaInvalid,
  ...props
}: ComponentProps<"input">) {
  return (
    <input
      className={cn(controlClasses, ariaInvalid ? invalidClasses : null, className)}
      aria-invalid={ariaInvalid}
      {...props}
    />
  );
}

export function Select({
  className,
  "aria-invalid": ariaInvalid,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      className={cn(controlClasses, ariaInvalid ? invalidClasses : null, className)}
      aria-invalid={ariaInvalid}
      {...props}
    />
  );
}

export function Textarea({
  className,
  "aria-invalid": ariaInvalid,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        controlClasses,
        "min-h-20 py-2 leading-relaxed",
        ariaInvalid ? invalidClasses : null,
        className,
      )}
      aria-invalid={ariaInvalid}
      {...props}
    />
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;

  return (
    <p role="alert" className="text-xs text-status-danger">
      {children}
    </p>
  );
}

export function FieldHint({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="text-xs text-ink-muted">{children}</p>;
}

export interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (controlProps: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
  }) => ReactNode;
}

export function Field({
  id,
  label,
  required,
  hint,
  error,
  className,
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? <span id={hintId}><FieldHint>{hint}</FieldHint></span> : null}
      {error ? <span id={errorId}><FieldError>{error}</FieldError></span> : null}
    </div>
  );
}
