import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/dal";

import { LoginForm } from "./login-form";

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
      <LoginForm next={next} passwordChanged={params["changed"] === "1"} />
    </div>
  );
}
