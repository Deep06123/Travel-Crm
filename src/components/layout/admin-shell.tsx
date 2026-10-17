"use client";

import { ChevronRight, LogOut, User } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Sidebar, SidebarToggle } from "./sidebar";
import type { NavSection } from "./navigation";

/**
 * Application chrome shared by every admin page.
 *
 * The sidebar sections arrive pre-filtered from the server, so this component
 * holds only presentational state: whether the mobile drawer is open.
 */

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface AdminShellProps {
  sections: readonly NavSection[];
  user: { name: string; role: string };
  breadcrumbs?: readonly Breadcrumb[];
  children: ReactNode;
}

export function AdminShell({
  sections,
  user,
  breadcrumbs = [],
  children,
}: AdminShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <Sidebar
        sections={sections}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white px-4">
          <SidebarToggle onClick={() => setSidebarOpen(true)} />

          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1.5 text-sm">
              <li>
                <Link href="/admin" className="text-ink-muted hover:text-navy-500">
                  Home
                </Link>
              </li>
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;

                return (
                  <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight className="size-3.5 shrink-0 text-ink-subtle" />
                    {crumb.href && !isLast ? (
                      <Link
                        href={crumb.href}
                        className="truncate text-ink-muted hover:text-navy-500"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        className="truncate font-medium text-ink"
                        aria-current={isLast ? "page" : undefined}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/admin/profile"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-amber-accent text-navy-900">
                <User className="size-4" />
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-xs leading-tight font-medium text-ink">
                  {user.name}
                </span>
                <span className="block text-[11px] leading-tight text-ink-muted">
                  {user.role}
                </span>
              </span>
            </Link>

            {/* A sign-out that mutates server state must be a POST, not a link. */}
            <form action="/api/admin/auth/logout" method="post">
              <button
                type="submit"
                className="rounded-md p-2 text-ink-muted hover:bg-surface-sunken hover:text-ink"
              >
                <LogOut className="size-4" />
                <span className="sr-only">Sign out</span>
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6">{children}</main>
      </div>
    </div>
  );
}

/** Page title block, used at the top of each module page. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
