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
