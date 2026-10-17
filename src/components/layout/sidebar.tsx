"use client";

import * as icons from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { cn } from "@/lib/utils";

import { NAV_SECTIONS, type NavItem, type NavSection } from "./navigation";

/**
 * Admin sidebar.
 *
 * Receives the already-filtered navigation from the server, so the browser
 * never learns about modules the signed-in role cannot reach.
 */

function Icon({ name, className }: { name: string; className?: string }) {
  const candidate = (icons as unknown as Record<string, unknown>)[name];
  const Component =
    typeof candidate === "function"
      ? (candidate as React.ComponentType<{ className?: string }>)
      : icons.Circle;

  return <Component className={className} />;
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();

  // A module whose page does not exist yet is shown but not navigable. Keeping
  // it visible communicates the intended structure; keeping it unclickable
  // avoids sending anyone to a 404.
  if (item.plannedInPhase !== undefined) {
    return (
      <span
        className="flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-subtle"
        title={`Planned for phase ${item.plannedInPhase}`}
      >
        <Icon name={item.icon} className="size-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-subtle">
          P{item.plannedInPhase}
        </span>
      </span>
    );
  }

  // "/admin" would otherwise match every admin route, so the dashboard is
  // compared exactly while section roots match their descendants.
  const isActive =
    item.href === "/admin"
      ? pathname === "/admin"
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
        isActive
          ? "bg-navy-500 font-medium text-white"
          : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
      )}
    >
      <Icon name={item.icon} className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export interface SidebarProps {
  sections: readonly NavSection[];
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ sections, open, onClose }: SidebarProps) {
  const pathname = usePathname();

  // Close the mobile drawer on navigation, otherwise it covers the page the
  // user just asked for.
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  return (
    <>
      {/* Scrim, mobile only. */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-navy-900/40 lg:hidden",
          open ? "block" : "hidden",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-white transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
          <icons.PlaneTakeoff className="size-6 text-navy-500" />
          <span className="text-lg font-bold tracking-tight text-navy-500">
            Travel<span className="text-amber-accent-dark">CRM</span>
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section, index) => (
            <div key={section.heading ?? `section-${index}`} className="mb-4">
              {section.heading ? (
                <h3 className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-ink-subtle uppercase">
                  {section.heading}
                </h3>
              ) : null}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} onNavigate={onClose} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

export { NAV_SECTIONS };

/** Mobile toggle, rendered in the header. */
export function SidebarToggle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md p-2 text-ink-muted hover:bg-surface-sunken hover:text-ink lg:hidden"
    >
      <icons.Menu className="size-5" />
      <span className="sr-only">Open navigation</span>
    </button>
  );
}
