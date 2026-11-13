import "server-only";

import { BookingProduct } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  prepareItineraryForEmail,
  type InlineAttachment,
} from "@/lib/mail/inline-itinerary";
import type { BookingAuthorizationData } from "@/lib/mail/booking-authorization";
import type { PolicyOverrides } from "@/lib/mail/policies";

import { loadPolicyOverrides } from "./email-policy-service";

/**
 * The booking, shaped for the authorization document.
 *
 * Its own module rather than part of `booking-authorization-service` because
 * two services need it and importing one from the other would close a cycle:
 * the authorization service creates the signature request, the signature
 * service dispatches the confirmation, and the confirmation reproduces the
 * document this builds. A shared leaf module is the way out.
 *
 * The confirmation that goes back to the office after a customer signs renders
 * the same tables the customer was sent — see `signature-confirmation.ts` —
 * so both read the booking through this one select.
 */

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

export { AUTHORIZATION_SELECT };

/** Derived from the select above, so adding a field cannot desync the two. */
export type AuthorizationRow = Prisma.BookingGetPayload<{
  select: typeof AUTHORIZATION_SELECT;
}>;

/** One line, in the order a postal address is read. */
export function billingAddress(booking: AuthorizationRow): string | null {
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
export function storedItinerary(booking: AuthorizationRow): string | null {
  return booking.product === BookingProduct.CRUISE
    ? (booking.cruiseDetail?.itineraryHtml ?? null)
    : (booking.flightDetail?.itineraryHtml ?? null);
}

/** The booking's own contact name, falling back to the customer record. */
export function customerNameOf(booking: AuthorizationRow): string {
  return (
    booking.contactName?.trim() ||
    `${booking.customer.firstName} ${booking.customer.lastName}`.trim() ||
    "traveller"
  );
}

export function toAuthorizationData(
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

export interface AuthorizationDocument {
  data: BookingAuthorizationData;
  /** The itinerary images, which must be carried on the same message. */
  attachments: InlineAttachment[];
}

/**
 * The authorization document for a booking, ready to render into an email.
 *
 * Null when the booking no longer exists. Callers that merely quote the
 * document — the signed-copy confirmation — treat that as "render without the
 * tables" rather than as a failure: the covering note still has to arrive.
 */
export async function loadAuthorizationDocument(
  bookingId: string,
): Promise<AuthorizationDocument | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: AUTHORIZATION_SELECT,
  });

  if (!booking) return null;

  const itinerary = await prepareItineraryForEmail(storedItinerary(booking));

  return {
    data: {
      ...toAuthorizationData(booking, await loadPolicyOverrides()),
      itineraryHtml: itinerary.html,
    },
    attachments: itinerary.attachments,
  };
}
