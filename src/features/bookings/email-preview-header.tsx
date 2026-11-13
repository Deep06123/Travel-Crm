/**
 * The subject line above a previewed email.
 *
 * Both previews — the authorization and the e-ticket — open to answer the same
 * question: what is the customer looking at? The subject is the first thing
 * they read and the part an operator is most likely to have edited, so it is
 * shown attached to the top of the document rather than in a card of its own:
 * a mail client puts the subject against the message, and a floating labelled
 * box read as page furniture belonging to the admin rather than as part of the
 * email.
 *
 * It carries no "Subject" label for the same reason. The line sits where a
 * subject sits, in the weight a subject has, directly above the body — which
 * says what it is without a caption.
 *
 * Shared so the two pages cannot drift apart, which is what happened when each
 * carried its own copy of the markup. Both pair it with an iframe whose top
 * corners are square (`rounded-b-lg`), so the two read as one sheet.
 */
export function EmailPreviewHeader({
  subject,
  recipient,
}: {
  subject: string;
  /** Empty when the booking has no contact address; nothing could be sent. */
  recipient: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-t-lg border border-b-0 border-line bg-surface px-4 py-3 shadow-sm">
      {/* `break-words` because a subject is free text an operator typed: one
          long unbroken string used to run off the side and take the recipient
          line with it, which is how a subject that was being rendered all
          along came to look missing. */}
      <p className="min-w-0 break-words text-sm font-semibold text-ink">
        {subject || <span className="text-ink-subtle">— no subject —</span>}
      </p>

      <p className="break-words text-xs text-ink-subtle">
        {recipient
          ? `Would be sent to ${recipient}`
          : "No contact address on this booking"}
      </p>
    </div>
  );
}
