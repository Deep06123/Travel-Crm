import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import { isProduction } from "@/lib/env";
import { PERMISSIONS } from "@/lib/permissions";
import { previewAuthorizationEmail } from "@/server/services/booking-authorization-service";

export const metadata: Metadata = {
  title: "Authorization email · Travel CRM",
  // Not a customer-facing page, and it carries card and billing detail.
  robots: { index: false, follow: false },
};

/**
 * The authorization email as the customer receives it.
 *
 * Outside the `(dashboard)` route group, like the e-ticket preview, so it
 * renders without the admin shell: the point is to read the message itself
 * rather than the message framed by a sidebar. Opened in its own tab from the
 * booking page.
 *
 * The markup comes from the same function that builds the email body, so this
 * is the message rather than a drawing of it — including its quirks.
 *
 * Nothing here issues a signing link. A preview that minted a token would
 * revoke the one already in the customer's inbox, which is a destructive side
 * effect for an action an operator reasonably expects to be read-only.
 */
export default async function AuthorizationEmailPage({
  params,
}: PageProps<"/admin/bookings/[id]/authorization">) {
  // The same permission as sending it: this exposes the exact wording, the
  // card's last four and the billing address a customer would receive.
  await requirePermission(PERMISSIONS.BOOKING_SIGNATURE_SEND);

  const { id } = await params;

  /**
   * Development gets a working confirm button; production gets the shape of
   * one.
   *
   * The route behind this link mints a token and opens the signing page, which
   * is the only way to reach it on a machine with no mail transport. It is a
   * real link with a real cost — it revokes any unsigned link for the booking,
   * exactly as a resend does — so the banner below says so rather than letting
   * it look free.
   */
  const signUrl = isProduction()
    ? ""
    : `/admin/bookings/${encodeURIComponent(id)}/authorization/sign`;

  const preview = await previewAuthorizationEmail(id, {}, signUrl);

  if (!preview) notFound();

  return (
    <div className="min-h-screen bg-surface-muted py-6">
      <div className="mx-auto w-full max-w-[680px] px-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold text-ink">
            {preview.subject}
          </span>

          <span className="text-xs text-ink-subtle">
            {preview.recipient
              ? `Would be sent to ${preview.recipient}`
              : "No contact address on this booking"}
          </span>
        </div>

        {signUrl === "" ? (
          <p className="mb-4 rounded-md bg-status-info-bg px-3 py-2 text-xs text-navy-700">
            This is a preview. <strong>Confirm</strong> below is inert — a
            signing link is issued only when the email is actually sent, because
            issuing one here would replace any link the customer is already
            holding.
          </p>
        ) : (
          <p className="mb-4 rounded-md bg-status-warning-bg px-3 py-2 text-xs text-status-warning">
            Development build. <strong>Click to confirm</strong> below issues a
            real signing link and opens the signing page in a new tab — and, as
            a resend does, revokes any unsigned link already out for this
            booking. In production this button is inert.
          </p>
        )}

        {/* The email body, rendered as it will arrive. `srcDoc` isolates it in
            its own document so the application's stylesheet cannot leak in and
            make it look better here than it will in a mail client. */}
        <iframe
          title="Authorization email preview"
          srcDoc={preview.html}
          className="h-[1800px] w-full rounded-lg border border-line bg-white shadow-sm"
          // Nothing in this document needs to run, and it carries the booking's
          // billing detail — so nothing is allowed, with one exception.
          //
          // Development additionally allows the confirm link to open a tab.
          // A sandboxed frame cannot navigate itself, and a popup inherits the
          // sandbox unless it is let out — the signing page is a client
          // component, so inheriting "no scripts" would hand over a dead form.
          // Neither flag lets anything run *in this frame*.
          sandbox={
            signUrl === "" ? "" : "allow-popups allow-popups-to-escape-sandbox"
          }
        />
      </div>
    </div>
  );
}
