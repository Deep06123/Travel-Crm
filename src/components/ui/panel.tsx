"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Collapsible section panel.
 *
 * The navy header bar and collapse control mirror the reference CRM's section
 * layout, which matters on the booking form: it runs to eight sections, and
 * staff collapse the ones they are not working in.
 */
export interface PanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({
  title,
  description,
  actions,
  defaultOpen = true,
  collapsible = true,
  className,
  children,
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-line bg-white shadow-sm",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 bg-navy-500 px-4 py-2.5 text-white">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="truncate text-xs text-navy-100">{description}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={contentId}
              className="rounded p-1 text-navy-100 hover:bg-navy-600 hover:text-white"
            >
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  open ? null : "-rotate-90",
                )}
              />
              <span className="sr-only">
                {open ? `Collapse ${title}` : `Expand ${title}`}
              </span>
            </button>
          ) : null}
        </div>
      </header>

      {/* Kept mounted while hidden so form state inside a collapsed section is
          not discarded. */}
      <div id={contentId} hidden={!open} className="p-4">
        {children}
      </div>
    </section>
  );
}

/** Plain surface for content that needs no section header. */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-white p-4 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
