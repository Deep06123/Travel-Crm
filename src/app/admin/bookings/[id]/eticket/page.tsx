import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SendETicketButton } from "@/features/bookings/send-eticket-button";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { PERMISSIONS } from "@/lib/permissions";
import { getETicketPreview } from "@/server/services/customer-email-service";

export const metadata: Metadata = {
  title: "E-ticket · Travel CRM",
  // Not a customer-facing page, and it carries traveller detail.
  robots: { index: false, follow: false },
};

/**
 * The e-ticket as the customer receives it.
 *
 * Deliberately outside the `(dashboard)` route group, so it renders without
 * the admin shell: the point is to see the document itself, not the document
 * framed by a sidebar. It is opened in its own tab from the booking page.
 *
 * The markup is produced by the same function that builds the email body, so
 * this is the message rather than a drawing of it. The one difference is the
 * date of birth, masked here for roles that may not see it — the customer's
 * own copy always shows it, because it is their date of birth.
 */
export default async function ETicketPage({
  params,
}: PageProps<"/admin/bookings/[id]/eticket">) {
  await requirePermission(PERMISSIONS.BOOKING_VIEW);

  const [canViewSensitive, canSend] = await Promise.all([
    currentUserCan(PERMISSIONS.PASSENGER_VIEW_SENSITIVE),
    currentUserCan(PERMISSIONS.MESSAGE_SEND),
  ]);

  const { id } = await params;

  const preview = await getETicketPreview(id, {
    redactDateOfBirth: !canViewSensitive,
  });

  if (!preview) notFound();

  return (
    <div className="min-h-screen bg-surface-muted py-6">
      <div className="mx-auto w-full max-w-[680px] px-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {canSend ? (
            <SendETicketButton bookingId={id} recipient={preview.recipient} />
          ) : (
            <span className="text-xs text-ink-muted">
              Sending requires the message.send permission.
            </span>
          )}

          <span className="text-xs text-ink-subtle">
            {preview.recipient
              ? `Would be sent to ${preview.recipient}`
              : "No contact address on this booking"}
          </span>
        </div>

        {!canViewSensitive ? (
          <p className="mb-4 rounded-md bg-status-info-bg px-3 py-2 text-xs text-navy-700">
            Dates of birth are masked for your role. The customer&rsquo;s own
            copy shows them in full.
          </p>
        ) : null}

        {/* The email body, rendered as it will arrive. `srcDoc` isolates it in
            its own document so the application's stylesheet cannot leak in and
            make it look better here than it will in a mail client. */}
        <iframe
          title="E-ticket preview"
          srcDoc={preview.html}
          className="h-[1400px] w-full rounded-lg border border-line bg-white shadow-sm"
          // Nothing in this document needs to run, and the booking it renders
          // carries traveller detail.
          sandbox=""
        />
      </div>
    </div>
  );
}
