import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Dense operational table.
 *
 * Matches the reference CRM's information density on desktop while staying
 * usable on smaller screens: the table scrolls inside its own container so the
 * page body never scrolls sideways.
 */

export function TableShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-line bg-surface-sunken">{children}</thead>
  );
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-cell-x py-cell-y text-[11px] font-semibold tracking-wider text-ink-muted uppercase whitespace-nowrap",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function Tr({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn("align-top hover:bg-navy-50/60", className)}>{children}</tr>
  );
}

export function Td({
  children,
  align = "left",
  numeric = false,
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  /** Applies tabular figures so columns of money line up. */
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-cell-x py-cell-y text-ink",
        align === "right" && "text-right",
        align === "center" && "text-center",
        numeric && "tabular",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Shown in place of rows when a filtered query matches nothing. */
export function EmptyState({
  title,
  description,
  action,
  colSpan,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  colSpan: number;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        ) : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </td>
    </tr>
  );
}
