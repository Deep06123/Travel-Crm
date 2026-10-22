import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/dal";
import { getEnv } from "@/lib/env";

import { LoginForm } from "./login-form";

/**
 * Never prerendered: this page's content depends on DEMO_MODE and on whether
 * the visitor already has a valid session, both of which are runtime facts.
 * Built as static HTML it would keep offering whatever the build decided.
 */
export const dynamic = "force-dynamic";

/** See the admin layout: a cold start must build the embedded database first. */
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Sign in · Travel CRM",
  // Keep the sign-in page out of search indexes.
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/admin/login">) {
  // An already-authenticated administrator has no reason to see this form.
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? "/admin/change-password" : "/admin");

  const params = await searchParams;
  const next = typeof params["next"] === "string" ? params["next"] : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12">
      <LoginForm
        next={next}
        passwordChanged={params["changed"] === "1"}
        demoMode={getEnv().DEMO_MODE}
      />
    </div>
  );
}
