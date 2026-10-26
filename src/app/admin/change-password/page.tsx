import type { Metadata } from "next";

import { requireAuth } from "@/lib/auth/dal";

import { ChangePasswordForm } from "./change-password-form";

/**
 * Never prerendered: this page is reached only with a valid session, which is
 * a runtime fact. Built as static HTML it would be served to anyone.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Change password · Travel CRM",
  robots: { index: false, follow: false },
};

/**
 * Sits outside the authenticated admin layout on purpose: that layout redirects
 * accounts flagged `mustChangePassword` here, so nesting this page inside it
 * would loop.
 */
export default async function ChangePasswordPage() {
  const user = await requireAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12">
      <ChangePasswordForm forced={user.mustChangePassword} />
    </div>
  );
}
