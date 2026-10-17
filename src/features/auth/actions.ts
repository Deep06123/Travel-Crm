"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/dal";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
} from "@/lib/auth/session";
import { loggerFor } from "@/lib/logging/logger";
import {
  changePassword,
  login,
  logout,
} from "@/server/services/auth-service";

const log = loggerFor("auth-actions");

/** Shape returned to the form by every action here. */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email address or username."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

/**
 * Restricts post-login redirects to same-site paths.
 *
 * Without this, `?next=https://evil.example` would turn the login form into an
 * open redirect that borrows this site's credibility for a phishing page.
 */
function safeRedirectTarget(next: string | undefined): string {
  if (!next) return "/admin";
  if (!next.startsWith("/")) return "/admin";
  // "//host" and "/\host" are protocol-relative and leave the site.
  if (next.startsWith("//") || next.startsWith("/\\")) return "/admin";
  return next;
}

async function requestContext() {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");

  return {
    ipAddress:
      forwardedFor?.split(",")[0]?.trim() ??
      headerList.get("x-real-ip") ??
      undefined,
    userAgent: headerList.get("user-agent") ?? undefined,
  };
}

export async function loginAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const context = await requestContext();
  const result = await login({
    identifier: parsed.data.identifier,
    password: parsed.data.password,
    context,
  });

  if (!result.ok) {
    return { error: result.message };
  }

  await setSessionCookie(result.session);

  // `redirect` throws to unwind, so it must be outside any try/catch here.
  redirect(
    result.mustChangePassword
      ? "/admin/change-password"
      : safeRedirectTarget(parsed.data.next),
  );
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  const user = await getCurrentUser();

  if (token) {
    const context = await requestContext();
    await logout(token, user?.id ?? null, user?.email ?? "unknown", context);
  }

  await clearSessionCookie();
  redirect("/admin/login");
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(
        MIN_PASSWORD_LENGTH,
        `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      ),
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "Choose a password you have not used here before.",
    path: ["newPassword"],
  });

export async function changePasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const result = await changePassword(
    user.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );

  if (!result.ok) {
    return { error: result.message };
  }

  log.info({ adminUserId: user.id }, "Password changed; all sessions revoked");

  // Every session was revoked, including this one, so the user signs in again.
  await clearSessionCookie();
  redirect("/admin/login?changed=1");
}
