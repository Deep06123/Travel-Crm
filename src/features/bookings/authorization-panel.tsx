"use client";

import { ExternalLink, Loader2, Pencil, Send } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/status-badge";
import type { BookingSignatureStatus } from "@/generated/prisma/enums";

import { EmailEditor } from "./email-editor";
import { SenderSelect, type SenderOption } from "./sender-select";
import {
  sendAuthorizationEmailAction,
  type AuthorizationState,
} from "./signature-actions";

/**
 * The customer's authorization: what was sent, and what came back.
 *
 * Client-side because it owns a form, but it renders data the page already
 * loaded rather than fetching any itself. Dates arrive pre-formatted: this is
 * a Client Component and `@/lib/format` reaches `@/lib/env`, which is
 * server-only — the same reason the customer email rows are formatted on the
 * page.
 *
 * The evidence block is deliberately plain text in a definition list rather
 * than anything clever. It is read when a charge is disputed, often by
 * somebody copying values into a form for a bank, and it has to be legible and
 * copyable more than it has to look good.
 */

/** Mirrors `getBookingSignatures`, with the dates already formatted. */
export interface SignatureRow {
  id: string;
  status: BookingSignatureStatus;
  recipientEmail: string;
  sentAtLabel: string;
  expiresAtLabel: string;
  viewedAtLabel: string | null;
  signedAtLabel: string | null;
  signatureName: string | null;
  signedPhone: string | null;
  consentText: string | null;
  ipAddress: string | null;
  device: string | null;
  operatingSystem: string | null;
  browser: string | null;
  screenSize: string | null;
  clientTimezone: string | null;
  geoCity: string | null;
  geoRegion: string | null;
  geoCountry: string | null;
  sentBy: { id: string; name: string } | null;
}

const PRESENTATION: Record<
  BookingSignatureStatus,
  { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }
> = {
  SENT: { label: "Sent", tone: "info" },
  VIEWED: { label: "Opened", tone: "warning" },
  SIGNED: { label: "Signed", tone: "success" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  REVOKED: { label: "Replaced", tone: "neutral" },
};

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-right text-sm break-words text-ink">{value}</dd>
    </div>
  );
}

/** "Leeds, England, United Kingdom", skipping whichever parts are unknown. */
function location(row: SignatureRow): string | null {
  const parts = [row.geoCity, row.geoRegion, row.geoCountry].filter(
    (part): part is string => Boolean(part),
  );

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Clickable even when the send cannot succeed.
 *
 * The button used to be disabled whenever the booking had no contact address.
 * It reads as a broken control: an operator sees a greyed-out Send, not the
 * sentence underneath explaining why. Letting the click through means the
 * action answers in the operator's own words — and the server applies the rule
 * either way, so nothing can leave that should not. `pending` still disables
 * it, which is the one case where a second click would do harm.
 */
function SubmitButton({ label, blocked }: { label: string; blocked?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} title={blocked}>
      {pending ? <Loader2 className="animate-spin" /> : <Send />}
      {pending ? "Sending…" : label}
    </Button>
  );
}

/**
 * Opens the message for editing before it goes.
 *
 * Carries `intent` as its own name/value rather than a hidden input, so only a
 * click on *this* button asks for a preview — the Send button beside it submits
 * the same form and must keep its default intent.
 *
 * Deliberately available even when the send is blocked: an operator with no
 * contact address on the booking still needs to read and prepare the wording.
 */
function EditButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name="intent"
      value="preview"
      variant="secondary"
      disabled={pending}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
      Edit email
    </Button>
  );
}

export function AuthorizationPanel({
  bookingId,
  rows,
  canSend,
  recipient,
  senders = [],
  canManageSettings = false,
}: {
  bookingId: string;
  /** Newest first. */
  rows: readonly SignatureRow[];
  canSend: boolean;
  /** Empty when the booking has no contact address; nothing could be sent. */
  recipient: string;
  /** Active sending accounts. Empty: no picker, only a pointer to Settings. */
  senders?: readonly SenderOption[];
  /** Whether this user could act on "no accounts configured". */
  canManageSettings?: boolean;
}) {
  const [state, formAction] = useActionState<AuthorizationState, FormData>(
    sendAuthorizationEmailAction,
    {},
  );

  /**
   * The preview the operator has dismissed, if any.
   *
   * Compared by identity against the current result, so asking for the preview
   * again reopens the editor rather than being swallowed by an earlier
   * dismissal. Derived rather than mirrored — a successful send returns a
   * result with no `preview`, which closes the editor on its own.
   */
  const [dismissed, setDismissed] = useState<AuthorizationState["preview"]>();

  /**
   * The sender, held here rather than in each form.
   *
   * The send form and the editor are two separate forms — nesting them would
   * be invalid HTML — so a select living in one of them could not speak for
   * the other. Lifting it means a choice made before clicking Edit is still
   * the choice when the edited version is sent.
   */
  const [senderId, setSenderId] = useState("");

  const editing =
    state.preview && state.preview !== dismissed ? state.preview : undefined;

  // The signature is the evidence, wherever it sits in the history — a later
  // send does not undo it. The outstanding link is only interesting while
  // nothing has been signed.
  const signed = rows.find((row) => row.status === "SIGNED");
  const outstanding = rows.find(
    (row) => row.status === "SENT" || row.status === "VIEWED",
  );

  const blocked =
    recipient === ""
      ? "This booking has no contact address to send to."
      : undefined;

  return (
    <div className="space-y-4">
      {signed ? (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="success">Signed</Badge>
            <span className="text-xs text-ink-muted">
              {signed.signedAtLabel}
            </span>
          </div>

          <dl className="divide-y divide-line">
            <Row label="Signed as" value={signed.signatureName} />
            <Row label="Mobile number" value={signed.signedPhone} />
            <Row label="Sent to" value={signed.recipientEmail} />
            <Row label="IP address" value={signed.ipAddress} />
            <Row label="Approximate location" value={location(signed)} />
            <Row label="Device" value={signed.device} />
            <Row label="Operating system" value={signed.operatingSystem} />
            <Row label="Browser" value={signed.browser} />
            <Row label="Screen size" value={signed.screenSize} />
            <Row label="Browser timezone" value={signed.clientTimezone} />
            <Row label="Opened" value={signed.viewedAtLabel} />
            <Row label="Link sent by" value={signed.sentBy?.name ?? null} />
          </dl>

          {signed.consentText ? (
            <p className="mt-3 rounded-md bg-surface-muted px-3 py-2 text-xs leading-relaxed text-ink-muted">
              &ldquo;{signed.consentText}&rdquo;
            </p>
          ) : null}

          {!location(signed) && signed.ipAddress ? (
            <p className="mt-2 text-xs text-ink-subtle">
              No location was resolved for this address. Set GEOIP_PROVIDER to
              record one on future signatures.
            </p>
          ) : null}
        </div>
      ) : outstanding ? (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone={PRESENTATION[outstanding.status].tone}>
              {PRESENTATION[outstanding.status].label}
            </Badge>
            <span className="text-xs text-ink-muted">
              awaiting the customer
            </span>
          </div>

          <dl className="divide-y divide-line">
            <Row label="Sent to" value={outstanding.recipientEmail} />
            <Row label="Sent" value={outstanding.sentAtLabel} />
            <Row label="Opened" value={outstanding.viewedAtLabel ?? "Not yet"} />
            <Row label="Expires" value={outstanding.expiresAtLabel} />
            <Row label="Sent by" value={outstanding.sentBy?.name ?? null} />
          </dl>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          The customer has not been asked to authorize this booking yet.
        </p>
      )}

      {canSend ? (
        <form action={formAction} className="flex flex-col items-start gap-2">
          <input type="hidden" name="bookingId" value={bookingId} />

          <SenderSelect
            id={`authorization-sender-${bookingId}`}
            options={senders}
            value={senderId}
            onChange={setSenderId}
            canManageSettings={canManageSettings}
          />

          <div className="flex flex-wrap gap-2">
            <SubmitButton
              label={
                signed
                  ? "Send a new authorization email"
                  : outstanding
                    ? "Resend authorization email"
                    : "Send authorization email"
              }
              {...(blocked ? { blocked } : {})}
            />

            {/* Reading the message before sending it, in a new tab rather than
                a dialog: it is a full page, and the operator usually wants the
                booking still open beside it. Outside the form's submit path —
                an anchor cannot submit it — so checking the wording never
                risks putting a second copy in the customer's inbox. */}
            <a
              href={`/admin/bookings/${bookingId}/authorization`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary" })}
            >
              <ExternalLink className="size-4" />
              View email
            </a>

            <EditButton />
          </div>

          {blocked ? (
            <p className="mt-2 text-xs text-ink-muted">{blocked}</p>
          ) : null}
          {/* A fresh send invalidates the outstanding link, so say so before
              the agent clicks rather than after the customer complains. */}
          {outstanding && !signed ? (
            <p className="mt-2 text-xs text-ink-subtle">
              Resending replaces the link already sent; only the newest one
              works.
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-xs text-ink-subtle">
          Sending requires the booking.signature.send permission.
        </p>
      )}

      {/* A separate form from the one above: nesting forms is invalid HTML,
          and this one posts the edited wording rather than a bare send. */}
      {canSend && editing ? (
        <EmailEditor
          title="Authorization email"
          fieldKey={`authorization-${bookingId}`}
          recipient={editing.recipient}
          subject={editing.subject}
          body={editing.body}
          hidden={{
            bookingId,
            intent: "send",
            // Carried across from the picker above: the editor is its own
            // form and would otherwise post no sender at all.
            ...(senderId ? { mailAccountId: senderId } : {}),
          }}
          bodyHint="Plain text, shown at the top of the email. Leave a blank line between paragraphs."
          note={
            <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
              Only this opening message and the subject can be changed. The
              traveller table, card and billing details, charges and the confirm
              button are generated from the booking and go out as shown in{" "}
              <a
                href={`/admin/bookings/${bookingId}/authorization`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                the preview
              </a>
              .
            </p>
          }
          submitLabel="Send this version"
          onClose={() => setDismissed(state.preview)}
          formAction={formAction}
        />
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-status-danger-bg px-3 py-2 text-xs text-status-danger"
        >
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p
          role="status"
          className="rounded-md bg-status-success-bg px-3 py-2 text-xs text-status-success"
        >
          {state.success}
        </p>
      ) : null}
    </div>
  );
}
