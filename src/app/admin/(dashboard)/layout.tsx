import { redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { NAV_SECTIONS, type NavSection } from "@/components/layout/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import { getPermissionsForRole } from "@/lib/permissions";

/**
 * Authenticated admin layout.
 *
 * This is the enforcement point for the whole `/admin` tree: `proxy.ts` only
 * looked at whether a cookie was present, whereas this resolves the session
 * against the database and rejects revoked, expired and suspended accounts.
 * Individual pages still check their own permissions — a layout cannot know
 * what the page beneath it is about to do.
 */
/**
 * Never prerendered.
 *
 * Every page below this reads per-administrator data and checks permissions,
 * so there is nothing here that is the same for two visitors. Next.js cannot
 * infer that on its own: in demo mode the access layer resolves the
 * administrator without reading a cookie, which removes the only dynamic API
 * call from several pages and makes them look static. Six of them were then
 * built into HTML files at build time, with two consequences.
 *
 * They froze. A supplier, toll-free number or message group created in the
 * running application never appeared, because the page had been rendered
 * before it existed and was being served from a file.
 *
 * And they stopped being protected. Static output is served as-is, whatever
 * the runtime configuration says — so turning DEMO_MODE off later would leave
 * those pages still readable by anyone who got past the cookie-presence check
 * in `proxy.ts`, which is explicitly not a security boundary. The permission
 * check they contain had already run, at build time, as the demo SUPER_ADMIN.
 *
 * Declaring it is also simply honest about what this tree is. Rendering per
 * request costs nothing here: the pages are already behind authentication and
 * already query the database.
 */
export const dynamic = "force-dynamic";

/**
 * Ceiling for a request in this tree, in seconds.
 *
 * Only a cold start needs it. Without a hosted database the application embeds
 * PostgreSQL, and a serverless instance that has just been created spends
 * several seconds compiling it, applying migrations and seeding before it can
 * answer anything. Vercel's default allowance is short enough that the first
 * request to a new instance can be cut off mid-render, which reaches the
 * browser as a failed page rather than a slow one. Warm requests are unaffected
 * — this is a limit, not a reservation.
 */
export const maxDuration = 60;

export default async function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  const user = await getCurrentUser();

  if (!user) redirect("/admin/login");

  // A provisioned account must set its own password before reaching anything
  // else. The change-password page is outside this layout, so there is no loop.
  if (user.mustChangePassword) redirect("/admin/change-password");

  const granted = await getPermissionsForRole(user.role);

  // Drop links the role cannot use, then drop sections left empty. This is a
  // convenience, not a control: each destination re-checks on the server.
  const sections: NavSection[] = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => granted.has(item.permission)),
  })).filter((section) => section.items.length > 0);

  return (
    <AdminShell sections={sections} user={{ name: user.name, role: user.role }}>
      {children}
    </AdminShell>
  );
}
