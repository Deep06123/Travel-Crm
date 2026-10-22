import { redirect } from "next/navigation";

/**
 * Root route.
 *
 * This deployment is admin-only; there is no public surface. The sign-in page
 * is the entry point, and carries a "Skip sign-in" control when `DEMO_MODE` is
 * enabled.
 *
 * The static interface showcase remains at `/demo.html` for cases where the
 * screens need to be shown without a database at all.
 */
export default function RootPage() {
  redirect("/admin");
}
