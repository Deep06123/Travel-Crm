import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmailPreviewHeader } from "@/features/bookings/email-preview-header";
import { SendETicketButton } from "@/features/bookings/send-eticket-button";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { PERMISSIONS } from "@/lib/permissions";
import { hasSignedAuthorization } from "@/server/services/booking-signature-service";
import { getETicketPreview } from "@/server/services/customer-email-service";
import { listSendableAccounts } from "@/server/services/mail-account-service";

/** Mirrors the gate in `bookingEmailAction`, which is where it is enforced. */
export const AWAITING_SIGNATURE =
  "The customer has not signed the authorization yet. Send them the authorization email from the booking page first.";

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

  const [canViewSensitive, canSend, canManageSettings] = await Promise.all([
    currentUserCan(PERMISSIONS.PASSENGER_VIEW_SENSITIVE),
    currentUserCan(PERMISSIONS.MESSAGE_SEND),
    currentUserCan(PERMISSIONS.SETTINGS_MANAGE),
  ]);

  const { id } = await params;

  const [preview, signed, senders] = await Promise.all([
    getETicketPreview(id, { redactDateOfBirth: !canViewSensitive }),
    hasSignedAuthorization(id),
    // Only to populate the picker. With fewer than two the control draws
    // nothing and the send takes the configured default.
    listSendableAccounts(),
  ]);

  if (!preview) notFound();

  return (
    <div className="min-h-screen bg-surface-muted py-6">
      {/* A little wider than the email's own 720px cap, so the body is never
          the thing being clipped. */}
      <div className="mx-auto w-full max-w-[768px] px-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {canSend ? (
            <SendETicketButton
              bookingId={id}
              recipient={preview.recipient}
              senders={senders}
              canManageSettings={canManageSettings}
              blockedReason={signed ? undefined : AWAITING_SIGNATURE}
            />
          ) : (
            <span className="text-xs text-ink-muted">
              Sending requires the message.send permission.
            </span>
          )}

        </div>

        {/* Above the document rather than between it and its subject: this is
            a note about the page, not part of the email. */}
        {!canViewSensitive ? (
          <p className="mb-4 rounded-md bg-status-info-bg px-3 py-2 text-xs text-navy-700">
            Dates of birth are masked for your role. The customer&rsquo;s own
            copy shows them in full.
          </p>
        ) : null}

        {/* The subject, attached to the body it belongs to. It is editable and
            it is the first thing the customer reads, so a page that shows the
            body without it is showing half the email. */}
        <EmailPreviewHeader
          subject={preview.subject}
          recipient={preview.recipient}
        />

        {/* The email body, rendered as it will arrive. `srcDoc` isolates it in
            its own document so the application's stylesheet cannot leak in and
            make it look better here than it will in a mail client. */}
        <iframe
          title="E-ticket preview"
          srcDoc={preview.html}
          className="h-[1400px] w-full rounded-b-lg border border-line bg-white shadow-sm"
          // Nothing in this document needs to run, and the booking it renders
          // carries traveller detail.
          sandbox=""
        />
      </div>
    </div>
  );
}
