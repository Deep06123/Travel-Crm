import { logoutAction } from "@/features/auth/actions";

/** See the admin layout: a cold start must build the embedded database first. */
export const maxDuration = 60;

/**
 * Sign-out endpoint.
 *
 * POST only. A GET would let any image or link on a page sign the user out,
 * and browsers prefetch links. `logoutAction` revokes the session server-side
 * and redirects, so a stolen cookie is dead the moment this runs.
 */
export async function POST(): Promise<Response> {
  await logoutAction();

  // Unreachable: logoutAction always redirects.
  return new Response(null, { status: 303, headers: { Location: "/admin/login" } });
}
