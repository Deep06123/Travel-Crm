import { redirect } from "next/navigation";

/**
 * Root route.
 *
 * This deployment is admin-only; there is no public surface. The sign-in page
 * is the only entry point.
 */
export default function RootPage() {
  redirect("/admin");
}
