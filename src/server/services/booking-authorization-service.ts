import "server-only";

import {
  BookingProduct,
  NotificationChannel,
  NotificationStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  bookingRecipientLine,
  bookingRecipients,
} from "@/lib/bookings/recipients";
import { prisma } from "@/lib/db/prisma";
import { isProduction } from "@/lib/env";
import { loggerFor } from "@/lib/logging/logger";
import {
  prepareItineraryForEmail,
  prepareItineraryForPreview,
} from "@/lib/mail/inline-itinerary";
import {
  defaultAuthorizationBody,
  renderBookingAuthorization,
  type AuthorizationOverride,
  type BookingAuthorizationData,
} from "@/lib/mail/booking-authorization";
import type { PolicyOverrides } from "@/lib/mail/policies";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/financial/money";

import {
  actorName,
  ADMIN_AUTHORIZATION_SENT,
  dispatchAdminNotice,
} from "./admin-notification-service";

import { loadPolicyOverrides } from "./email-policy-service";

import { resolveMailer } from "./mail-account-service";

import { createSignatureRequest } from "./booking-signature-service";

/**
 * Sending a customer the authorization email, and recording that it went.
 *
 * Kept out of `customer-email-service` on purpose. That module is built around
 * status-driven mail: one message per booking per lifecycle event, deduplicated
 * on a unique key so a booking that re-enters a status cannot send the same
 * confirmation twice. This message is the opposite shape — an agent sends it
 * when they judge the booking ready, may legitimately send it again, and each
 * send mints a token that invalidates the one before. Forcing it through the
 * dedupe path would mean fighting the design rather than using it.
 *
 * What is shared is the honesty rule: the Notification row says what actually
 * happened. SENT means the provider accepted the message, never that a row was
 * created or a template rendered.
 */

const log = loggerFor("booking-authorization");

export const BOOKING_AUTHORIZATION = "BOOKING_AUTHORIZATION";

export type AuthorizationSendResult =
  | {
      result: "sent";
      signatureId: string;
      recipient: string;
      expiresAt: Date;
      /** Which identity it went from, so the agent is told rather than assuming. */
      sentFrom: string;
    }
  | { result: "suppressed"; reason: string }
  | { result: "failed"; reason: string };

const AUTHORIZATION_SELECT = {
  id: true,
  bookingNumber: true,
  product: true,
  currency: true,
  totalMinor: true,
  travelStartDate: true,
  airlineConfirmation: true,
  customEmailSubject: true,
  emailTopHeading: true,
  bookedAt: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  cardHolderName: true,
  cardType: true,
  cardLast4: true,
  billingAddressLine1: true,
  billingAddressLine2: true,
  billingCity: true,
  billingState: true,
  billingPostalCode: true,
  billingCountry: true,
  billingEmails: true,
  customer: { select: { firstName: true, lastName: true, email: true } },
  segments: {
    orderBy: { sequence: "asc" },
    select: {
      airline: true,
      flightNumber: true,
      origin: true,
      destination: true,
      departureAt: true,
      arrivalAt: true,
    },
  },
  // Only the itinerary from each detail: the raw PNR and the reservation text
  // are staff working material and have no place in a customer's inbox.
  flightDetail: { select: { itineraryHtml: true } },
  cruiseDetail: {
    select: {
      cruiseLine: true,
      ship: true,
      reservationNumber: true,
      sailingName: true,
      specialRequest: true,
      departurePort: true,
      arrivalPort: true,
      sailDate: true,
      returnDate: true,
      nights: true,
      deckNumber: true,
      cabinNumber: true,
      cabinCategory: true,
      cabinCount: true,
      diningPreference: true,
      gratuitiesIncluded: true,
      insuranceIncluded: true,
      itineraryHtml: true,
    },
  },
  // Passport numbers are deliberately not selected, as in the lifecycle
  // emails: the safest guarantee that none reaches a mailbox is never loading
  // one.
  passengers: {
    orderBy: { sequence: "asc" },
    select: {
      firstName: true,
      lastName: true,
      ticketNumber: true,
      gender: true,
      dateOfBirth: true,
    },
  },
  chargeSplits: {
    orderBy: { sequence: "asc" },
    select: { title: true, amountMinor: true },
  },
  tfn: { select: { number: true } },
} as const;

/** Derived from the select above, so adding a field cannot desync the two. */
type AuthorizationRow = Prisma.BookingGetPayload<{
  select: typeof AUTHORIZATION_SELECT;
}>;

/** One line, in the order a postal address is read. */
function billingAddress(booking: AuthorizationRow): string | null {
  const parts = [
    booking.billingAddressLine1,
    booking.billingAddressLine2,
    booking.billingCity,
    booking.billingState,
    booking.billingPostalCode,
    booking.billingCountry,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The itinerary as stored, before its images have been relocated.
 *
 * Never rendered as-is: every `src` in it addresses an administrator-only
 * route. `toAuthorizationData` leaves `itineraryHtml` unset for that reason,
 * and each caller sets the prepared form on the data it renders from.
 */
function storedItinerary(booking: AuthorizationRow): string | null {
  return booking.product === BookingProduct.CRUISE
    ? (booking.cruiseDetail?.itineraryHtml ?? null)
    : (booking.flightDetail?.itineraryHtml ?? null);
}

/** The booking's own contact name, falling back to the customer record. */
function customerNameOf(booking: AuthorizationRow): string {
  return (
    booking.contactName?.trim() ||
    `${booking.customer.firstName} ${booking.customer.lastName}`.trim() ||
    "traveller"
  );
}

function toAuthorizationData(
  booking: AuthorizationRow,
  policyOverrides: PolicyOverrides,
): BookingAuthorizationData {
  const customerName = customerNameOf(booking);

  return {
    bookingNumber: booking.bookingNumber,
    customerName,
    product: booking.product === BookingProduct.CRUISE ? "CRUISE" : "FLIGHT",
    currency: booking.currency,
    totalMinor: booking.totalMinor,
    travelStartDate: booking.travelStartDate,
    airlineConfirmation: booking.airlineConfirmation,
    segments: booking.segments,
    cruise: booking.cruiseDetail,
    passengers: booking.passengers,
    customEmailSubject: booking.customEmailSubject,
    emailTopHeading: booking.emailTopHeading,
    supportPhone: booking.tfn?.number ?? null,
    policyOverrides,
    bookedAt: booking.bookedAt,
    contactEmail: booking.contactEmail ?? booking.customer.email,
    contactPhone: booking.contactPhone,
    cardHolderName: booking.cardHolderName,
    cardType: booking.cardType,
    cardLast4: booking.cardLast4,
    billingAddress: billingAddress(booking),
    chargeSplits: booking.chargeSplits,
    // Only on a cruise: a flight booking can carry a stale cruise detail row
    // from a product change, and printing the sailing it was never for would
    // be worse than printing nothing.
    sailing:
      booking.product === BookingProduct.CRUISE && booking.cruiseDetail
        ? booking.cruiseDetail
        : null,
  };
}

export interface SendAuthorizationInput {
  bookingId: string;
  actorId: string;
  /** Absolute origin the signing link is built against, e.g. `https://crm.example.com`. */
  origin: string;
  /**
   * The operator's edits from the preview editor, where they made any.
   *
   * Absent means "send the generated message", which is what the plain Send
   * button does.
   */
  override?: AuthorizationOverride | undefined;
  /**
   * The sending identity the operator picked, where they picked one.
   *
   * Absent means "use the configured default for an authorization" — see
   * `resolveMailer`. An id that no longer resolves falls back the same way
   * rather than failing the send.
   */
  mailAccountId?: string | undefined;
}

export interface AuthorizationPreview {
  /** Empty when the booking has no contact address — nothing could be sent. */
  recipient: string;
  subject: string;
  /**
   * The editable message block, as plain text.
   *
   * Only the opening message is editable — see `defaultAuthorizationBody`.
   * Offered alongside `html` so the same preview can serve both the read-only
   * page and the editor on the booking.
   */
  body: string;
  html: string;
}

/**
 * Renders the authorization email so it can be read before it is sent.
 *
 * Writes nothing, sends nothing, and — the part that matters — mints no token.
 * Issuing one would revoke whatever link the customer is already holding, so
 * merely looking at the message would silently break the one in their inbox.
 * The confirm button therefore points at a placeholder, and the page says so.
 *
 * Returns `null` when the booking does not exist, so the caller can answer
 * with a 404 rather than an error.
 */
export async function previewAuthorizationEmail(
  bookingId: string,
  override: AuthorizationOverride = {},
  /**
   * What the confirm button points at, or `""` to render it inert.
   *
   * Empty everywhere that matters: no token has been minted, so there is
   * genuinely nowhere to go. Development passes the route that mints one on
   * demand, which is the only way to reach the signing page without a mailbox.
   */
  signUrl: string = PREVIEW_SIGN_URL,
): Promise<AuthorizationPreview | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: AUTHORIZATION_SELECT,
  });

  if (!booking) return null;

  // Data URIs, not `cid:`: there is no message here to attach to, and the
  // preview renders in a sandboxed iframe where the stored path resolves to
  // nothing.
  const data: BookingAuthorizationData = {
    ...toAuthorizationData(booking, await loadPolicyOverrides()),
    itineraryHtml: await prepareItineraryForPreview(storedItinerary(booking)),
  };

  const rendered = renderBookingAuthorization(
    data,
    {
      signUrl,
      // Only ever printed as a date in the body. The real expiry is set when a
      // link is actually issued; this stands in for the shape of the sentence.
      expiresAt: new Date(
        Date.now() + PREVIEW_EXPIRY_DAYS * 24 * 60 * 60 * 1_000,
      ),
    },
    override,
  );

  return {
    recipient: bookingRecipientLine(booking),
    subject: rendered.subject,
    body: override.body?.trim() || defaultAuthorizationBody(data),
    html: rendered.html,
  };
}

/**
 * Stands in for the real signing link in a preview.
 *
 * Empty, so `renderBookingAuthorization` draws the call to action as text
 * instead of a link. It was a `#preview-link-not-issued` fragment, which only
 * looked inert: the preview shows the email in a `srcDoc` iframe, whose base
 * URL is the admin page's own, so clicking it navigated the frame to the admin
 * page inside a `sandbox=""` frame — an opaque origin with no cookies, which
 * fails to load and leaves the operator staring at a blank panel.
 */
const PREVIEW_SIGN_URL = "";

/** Matches `EXPIRY_DAYS` in `booking-signature-service`. */
const PREVIEW_EXPIRY_DAYS = 14;

/**
 * Emails the customer their authorization link.
 *
 * Awaited rather than dispatched in the background, unlike the lifecycle mail.
 * This is explicit operator intent and the token it mints is only useful if it
 * actually left the building, so the agent is told the outcome instead of being
 * sent back to the page to guess.
 *
 * The token is minted *before* the send, so a message that reaches the customer
 * always has a working link behind it. The cost is a revoked-but-unused row
 * when the transport rejects the message, which is the harmless direction to
 * fail in: the agent sees the failure and sends again.
 */
export async function sendAuthorizationEmail({
  bookingId,
  actorId,
  origin,
  override = {},
  mailAccountId,
}: SendAuthorizationInput): Promise<AuthorizationSendResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: AUTHORIZATION_SELECT,
  });

  if (!booking) {
    throw new Error(`Booking ${bookingId} does not exist.`);
  }

  const recipients = bookingRecipients(booking);
  const recipient = recipients.length > 0 ? recipients.join(", ") : null;

  // Resolved before the first row is written so every Notification — sent,
  // failed or suppressed — can say which identity it was going to use. A
  // suppressed row with no account is then unambiguous: there was no transport
  // at all, rather than one that was never recorded.
  const mailer = await resolveMailer("authorization", mailAccountId);

  const record = async (
    status: NotificationStatus,
    extra: {
      lastError?: string;
      sentAt?: Date;
      providerReference?: string;
    } = {},
  ) =>
    prisma.notification.create({
      data: {
        // No dedupe key: a resend is a legitimate second message, not a
        // duplicate of the first. The column is nullable precisely for this.
        bookingId,
        eventType: BOOKING_AUTHORIZATION,
        channel: NotificationChannel.EMAIL,
        template: "booking-authorization",
        recipient: recipient ?? "",
        status,
        attemptCount: status === NotificationStatus.SUPPRESSED ? 0 : 1,
        provider:
          status === NotificationStatus.SUPPRESSED
            ? null
            : (mailer?.adapter.provider ?? "smtp"),
        ...(mailer?.accountId ? { mailAccountId: mailer.accountId } : {}),
        payload: { bookingNumber: booking.bookingNumber },
        ...extra,
      },
      select: { id: true },
    });

  if (!recipient) {
    const reason =
      "No contact email on the booking or the customer record, so there is nowhere to send it.";
    await record(NotificationStatus.SUPPRESSED, { lastError: reason });
    log.warn({ bookingId }, "Authorization email suppressed: no recipient");
    return { result: "suppressed", reason };
  }

  if (!mailer && isProduction()) {
    const reason =
      "No sending account is configured, so no email was attempted. Add one under Settings → Sending accounts.";
    await record(NotificationStatus.SUPPRESSED, { lastError: reason });
    log.warn({ bookingId }, "Authorization email suppressed: no transport");
    return { result: "suppressed", reason };
  }

  // The sender is captured here, with the invitation, and never re-resolved.
  // The confirmation that comes back after the customer signs is addressed to
  // this mailbox — which can be days later, by which time the default for an
  // authorization may well be a different account.
  const {
    id: signatureId,
    token,
    expiresAt,
  } = await createSignatureRequest(
    bookingId,
    recipient,
    actorId,
    // Optional: in development with no transport at all the link is still
    // minted and logged, and a row with no sender is the honest record of an
    // invitation that was never actually sent from anywhere.
    { email: mailer?.fromEmail ?? null, accountId: mailer?.accountId ?? null },
  );

  const signUrl = `${origin.replace(/\/+$/, "")}/sign/${encodeURIComponent(token)}`;

  // The raw token is a bearer credential: whoever holds this URL can sign the
  // booking. It is written to the log only outside production, and only so the
  // signing page can be reached on a machine with no mail transport — the one
  // situation where the link has nowhere else to go. `isProduction()` is the
  // guard rather than the absence of a mailer, so a misconfigured deployment
  // that loses its SMTP settings cannot start printing live links.
  if (!isProduction()) {
    log.warn(
      { bookingId, signatureId, signUrl },
      "Development build: signing URL logged in full",
    );
  }

  // Development with no transport: the token exists and the link above is
  // usable, but nothing was delivered. The Notification says SUPPRESSED
  // because that is what happened — the row must not claim a send that the
  // customer could never have received.
  if (!mailer) {
    const reason =
      "No sending account is configured. A signing link was issued and written to the server log, so the signing page can be opened directly. Nothing was emailed.";
    await record(NotificationStatus.SUPPRESSED, { lastError: reason });
    return { result: "suppressed", reason };
  }

  // Prepared after the suppression checks above, so a booking that was never
  // going to be emailed does not pull image bytes out of storage first.
  const itinerary = await prepareItineraryForEmail(storedItinerary(booking));

  const rendered = renderBookingAuthorization(
    {
      ...toAuthorizationData(booking, await loadPolicyOverrides()),
      itineraryHtml: itinerary.html,
    },
    { signUrl, expiresAt },
    override,
  );

  try {
    const { providerReference } = await mailer.adapter.send({
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      attachments: itinerary.attachments,
    });

    await record(NotificationStatus.SENT, {
      sentAt: new Date(),
      ...(providerReference ? { providerReference } : {}),
    });

    log.info({ bookingId, signatureId, actorId }, "Authorization email sent");

    // Dispatched, not awaited: the customer's email has left and the agent is
    // waiting on this call. Whether the office got its copy is recorded on its
    // own Notification row and must not turn a successful send into an error
    // on the agent's screen.
    dispatchAdminNotice({
      bookingId,
      bookingNumber: booking.bookingNumber,
      event: ADMIN_AUTHORIZATION_SENT,
      headline: "Authorization email sent",
      rows: [
        { label: "Customer", value: customerNameOf(booking) },
        { label: "Sent to", value: recipient },
        { label: "Sent from", value: mailer.label },
        { label: "Sent by", value: await actorName(actorId) },
        {
          label: "Amount",
          value: formatMoney(booking.totalMinor, booking.currency),
        },
        { label: "Link expires", value: formatDate(expiresAt) },
        { label: "Edited before sending", value: override.body ? "Yes" : null },
      ],
      footnote:
        "The customer has not signed yet. A second notice follows when they do.",
    });

    return {
      result: "sent",
      signatureId,
      recipient,
      expiresAt,
      sentFrom: mailer.label,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown transport error";
    await record(NotificationStatus.FAILED, { lastError: reason });
    log.error({ err: error, bookingId }, "Authorization email failed");
    return { result: "failed", reason };
  }
}
