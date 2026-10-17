import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Pagination links.
 *
 * Rendered as real `<a href>` links rather than click handlers so the current
 * page lives in the URL: staff can bookmark a filtered view, share it, and use
 * the browser's back button.
 */
export function PaginationControls({
  page,
  pageCount,
  total,
  pageSize,
  buildHref,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  /** Returns the URL for a given page, preserving the active filters. */
  buildHref: (page: number) => string;
}) {
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  // Window of page numbers around the current page, so a 400-page list does
  // not render 400 links.
  const windowStart = Math.max(1, Math.min(page - 2, pageCount - 4));
  const windowEnd = Math.min(pageCount, Math.max(page + 2, 5));
  const pages: number[] = [];
  for (let value = windowStart; value <= windowEnd; value += 1) pages.push(value);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3"
    >
      <p className="tabular text-xs text-ink-muted">
        Showing {first.toLocaleString()}–{last.toLocaleString()} of{" "}
        {total.toLocaleString()}
      </p>

      <div className="flex items-center gap-1">
        <PageLink
          href={buildHref(page - 1)}
          disabled={page <= 1}
          label="Previous page"
        >
          ‹
        </PageLink>

        {pages.map((value) => (
          <PageLink
            key={value}
            href={buildHref(value)}
            current={value === page}
            label={`Page ${value}`}
          >
            {value}
          </PageLink>
        ))}

        <PageLink
          href={buildHref(page + 1)}
          disabled={page >= pageCount}
          label="Next page"
        >
          ›
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  children,
  label,
  current = false,
  disabled = false,
}: {
  href: string;
  children: React.ReactNode;
  label: string;
  current?: boolean;
  disabled?: boolean;
}) {
  const className = cn(
    "tabular inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-sm",
    current
      ? "bg-navy-500 font-medium text-white"
      : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
    disabled && "pointer-events-none opacity-40",
  );

  if (disabled) {
    return (
      <span className={className} aria-disabled="true">
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={className}
      aria-label={label}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
