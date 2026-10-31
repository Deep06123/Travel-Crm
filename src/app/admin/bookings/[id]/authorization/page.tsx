import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
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
  const preview = await previewAuthorizationEmail(id);

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

        <p className="mb-4 rounded-md bg-status-info-bg px-3 py-2 text-xs text-navy-700">
          This is a preview. <strong>Confirm</strong> below is inert — a signing
          link is issued only when the email is actually sent, because issuing
          one here would replace any link the customer is already holding.
        </p>

        {/* The email body, rendered as it will arrive. `srcDoc` isolates it in
            its own document so the application's stylesheet cannot leak in and
            make it look better here than it will in a mail client. */}
        <iframe
          title="Authorization email preview"
          srcDoc={preview.html}
          className="h-[1800px] w-full rounded-lg border border-line bg-white shadow-sm"
          // Nothing in this document needs to run, and it carries the booking's
          // billing detail.
          sandbox=""
        />
      </div>
    </div>
  );
}
