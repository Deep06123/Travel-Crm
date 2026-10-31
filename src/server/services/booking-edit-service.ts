import "server-only";

import { AuditAction } from "@/generated/prisma/enums";
import type { CardType, PassengerType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { derivePriority } from "@/lib/bookings/priority";
import { sanitiseRichText } from "@/lib/html/sanitise";
import { prisma } from "@/lib/db/prisma";
import type {
  BookingBillingInput,
  BookingOverviewInput,
  CruiseDetailInput,
  TravellerEditInput,
} from "@/features/bookings/edit-schemas";

import { BookingNotFoundError } from "./booking-service";

/**
 * Correcting a booking after it was taken.
 *
 * Everything here exists for one reason: the create forms were the only place
 * most booking fields could be set, so a detail missed at the time — or typed
 * wrongly — could only be fixed by deleting the booking and entering it again,
 * which throws away its history, its payments and its audit trail.
 *
 * Status, ticketing and money are NOT here. Each is owned by a service with
 * rules of its own — a status change needs evidence, a ticket number is issued
 * rather than typed — and an "edit the booking" path that could set them would
 * be a way around those rules rather than a convenience.
 *
 * Every update writes an audit entry carrying the before and after of each
 * field that actually moved, and writes nothing at all when none did.
 */

/** A field's value as the audit log should read it. */
function label(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

type Changes = Record<string, { before: string | null; after: string | null }>;

/**
 * The fields that actually moved, as the audit log should record them.
 *
 * Compared on the labelled form rather than the raw values, so two dates
 * meaning the same day do not read as a change.
 */
function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Changes {
  const changes: Changes = {};

  for (const [key, afterValue] of Object.entries(after)) {
    const beforeLabel = label(before[key]);
    const afterLabel = label(afterValue);
    if (beforeLabel === afterLabel) continue;
    changes[key] = { before: beforeLabel, after: afterLabel };
  }

  return changes;
}

export interface BookingEditResult {
  bookingId: string;
  bookingNumber: string;
  /** How many fields moved. Zero means nothing was written. */
  changed: number;
}

// --- Overview ---------------------------------------------------------------

export async function updateBookingOverview(
  input: BookingOverviewInput,
  actorId: string,
): Promise<BookingEditResult> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        bookingNumber: true,
        bookingTypeId: true,
        chargeOutcome: true,
        source: true,
        language: true,
        assignedAgentId: true,
        supplierId: true,
        bookedAt: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
      },
    });

    if (!booking) throw new BookingNotFoundError(input.bookingId);

    const after = {
      bookingTypeId: input.bookingTypeId ?? null,
      chargeOutcome: input.chargeOutcome,
      source: input.source ?? null,
      language: input.language ?? null,
      assignedAgentId: input.assignedAgentId ?? null,
      supplierId: input.supplierId ?? null,
      // The booking date is never cleared: a booking was taken at some point,
      // and a blank here means "leave it alone" rather than "it never happened".
      bookedAt: input.bookedAt ?? booking.bookedAt,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
    };

    const changes = diff(booking, after);
    if (Object.keys(changes).length === 0) {
      return {
        bookingId: booking.id,
        bookingNumber: booking.bookingNumber,
        changed: 0,
      };
    }

    await tx.booking.update({ where: { id: booking.id }, data: after });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: booking.id,
        adminUserId: actorId,
        summary: `Updated the overview of booking ${booking.bookingNumber}`,
        changes,
      },
      tx,
    );

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      changed: Object.keys(changes).length,
    };
  });
}

// --- Billing information ----------------------------------------------------

export async function updateBookingBilling(
  input: BookingBillingInput,
  actorId: string,
): Promise<BookingEditResult> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        bookingNumber: true,
        cardHolderName: true,
        cardType: true,
        cardLast4: true,
        cardExpiry: true,
        inboundPhone: true,
        billingPhone: true,
        billingEmails: true,
        billingAddressLine1: true,
        billingCity: true,
        billingState: true,
        billingPostalCode: true,
        billingCountry: true,
      },
    });

    if (!booking) throw new BookingNotFoundError(input.bookingId);

    const after = {
      cardHolderName: input.cardHolderName ?? null,
      cardType: (input.cardType ?? null) as CardType | null,
      cardLast4: input.cardLast4 ?? null,
      cardExpiry: input.cardExpiry ?? null,
      inboundPhone: input.inboundPhone ?? null,
      billingPhone: input.billingPhone ?? null,
      billingEmails: input.billingEmails ?? null,
      billingAddressLine1: input.billingAddressLine1 ?? null,
      billingCity: input.billingCity ?? null,
      billingState: input.billingState ?? null,
      billingPostalCode: input.billingPostalCode ?? null,
      billingCountry: input.billingCountry ?? null,
    };

    const changes = diff(booking, after);
    if (Object.keys(changes).length === 0) {
      return {
        bookingId: booking.id,
        bookingNumber: booking.bookingNumber,
        changed: 0,
      };
    }

    await tx.booking.update({ where: { id: booking.id }, data: after });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: booking.id,
        adminUserId: actorId,
        summary: `Updated the billing information on booking ${booking.bookingNumber}`,
        changes,
      },
      tx,
    );

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      changed: Object.keys(changes).length,
    };
  });
}

// --- Sailing ----------------------------------------------------------------

export async function updateCruiseDetail(
  input: CruiseDetailInput,
  actorId: string,
): Promise<BookingEditResult> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        bookingNumber: true,
        travelStartDate: true,
        travelEndDate: true,
        cruiseDetail: true,
      },
    });

    if (!booking) throw new BookingNotFoundError(input.bookingId);
    if (!booking.cruiseDetail) {
      throw new BookingNotFoundError(`${input.bookingId} (no sailing)`);
    }

    const after = {
      cruiseLine: input.cruiseLine,
      ship: input.ship ?? null,
      reservationNumber: input.reservationNumber ?? null,
      sailingName: input.sailingName ?? null,
      specialRequest: input.specialRequest ?? null,
      departurePort: input.departurePort ?? null,
      arrivalPort: input.arrivalPort ?? null,
      sailDate: input.sailDate ?? null,
      returnDate: input.returnDate ?? null,
      nights: input.nights ?? null,
      deckNumber: input.deckNumber ?? null,
      cabinNumber: input.cabinNumber ?? null,
      cabinCategory: input.cabinCategory ?? null,
      cabinCount: input.cabinCount ?? 1,
      diningPreference: input.diningPreference ?? null,
      gratuitiesIncluded: input.gratuitiesIncluded,
      insuranceIncluded: input.insuranceIncluded,
      assistanceNotes: input.assistanceNotes ?? null,
      // Markup is the one value kept as markup rather than escaped at render,
      // so it is made safe here, on the way in, as it is on creation.
      itineraryHtml: sanitiseRichText(input.itineraryHtml),
    };

    const changes = diff(booking.cruiseDetail, after);
    if (Object.keys(changes).length === 0) {
      return {
        bookingId: booking.id,
        bookingNumber: booking.bookingNumber,
        changed: 0,
      };
    }

    await tx.cruiseDetail.update({
      where: { bookingId: booking.id },
      data: after,
    });

    // The sailing dates are mirrored onto the booking, where the lists, the
    // reports and the calendar read them from, and priority follows the
    // sailing. Moving the date on the detail alone would leave a booking
    // sorted and prioritised by a sailing that no longer exists.
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        travelStartDate: after.sailDate,
        travelEndDate: after.returnDate,
        priority: derivePriority(after.sailDate ?? undefined, new Date()),
      },
    });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: booking.id,
        adminUserId: actorId,
        summary: `Updated the sailing on booking ${booking.bookingNumber}`,
        changes,
      },
      tx,
    );

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      changed: Object.keys(changes).length,
    };
  });
}

// --- Guests and passengers --------------------------------------------------

export class TicketedTravellerError extends Error {
  constructor(public readonly names: string[]) {
    super("A traveller holding a ticket cannot be removed.");
    this.name = "TicketedTravellerError";
  }
}

/**
 * Replaces the traveller list, keeping the rows that were edited rather than
 * replaced.
 *
 * Rows arrive carrying the id they already had, so an edit stays an edit: a
 * ticket number, and anything else pointing at that traveller, survives a
 * corrected spelling of their name. A row that arrives without an id is new,
 * and one whose id no longer appears has been removed.
 *
 * `canEditSensitive` is not a display concern here. A role that may not see
 * passport details must not be able to blank them by saving a form that never
 * showed them, so for those roles the stored values are carried through
 * untouched rather than taken from the submission.
 */
export async function updateBookingTravellers(
  input: {
    bookingId: string;
    travellers: TravellerEditInput[];
    canEditSensitive: boolean;
  },
  actorId: string,
): Promise<BookingEditResult> {
  const { bookingId, travellers, canEditSensitive } = input;

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingNumber: true,
        passengers: { orderBy: { sequence: "asc" } },
      },
    });

    if (!booking) throw new BookingNotFoundError(bookingId);

    const existing = new Map(booking.passengers.map((row) => [row.id, row]));
    const kept = new Set(
      travellers
        .map((traveller) => traveller.id)
        .filter((id): id is string => id !== undefined && existing.has(id)),
    );

    // A traveller a ticket was issued to is a record of something that
    // happened. Removing the row would leave the ticket pointing at nobody.
    const ticketedRemovals = booking.passengers.filter(
      (row) => !kept.has(row.id) && row.ticketNumber,
    );

    if (ticketedRemovals.length > 0) {
      throw new TicketedTravellerError(
        ticketedRemovals.map((row) => `${row.firstName} ${row.lastName}`),
      );
    }

    const changes: Changes = {};
    let sequence = 0;

    for (const traveller of travellers) {
      sequence += 1;
      const current = traveller.id ? existing.get(traveller.id) : undefined;

      const data = {
        sequence,
        title: traveller.title ?? null,
        firstName: traveller.firstName,
        middleName: traveller.middleName ?? null,
        lastName: traveller.lastName,
        type: traveller.type as PassengerType,
        gender: traveller.gender ?? null,
        cabinNumber: traveller.cabinNumber ?? null,
        notes: traveller.notes ?? null,
        // Withheld from this role, so carried through rather than cleared.
        dateOfBirth: canEditSensitive
          ? (traveller.dateOfBirth ?? null)
          : (current?.dateOfBirth ?? null),
        passportNumber: canEditSensitive
          ? (traveller.passportNumber ?? null)
          : (current?.passportNumber ?? null),
        passportCountry: canEditSensitive
          ? (traveller.passportCountry ?? null)
          : (current?.passportCountry ?? null),
        passportExpiry: canEditSensitive
          ? (traveller.passportExpiry ?? null)
          : (current?.passportExpiry ?? null),
      } satisfies Prisma.PassengerUncheckedUpdateInput;

      if (current) {
        const rowChanges = diff(current, data);
        if (Object.keys(rowChanges).length === 0) continue;

        for (const [field, change] of Object.entries(rowChanges)) {
          changes[`traveller ${sequence}.${field}`] = change;
        }

        await tx.passenger.update({ where: { id: current.id }, data });
        continue;
      }

      await tx.passenger.create({ data: { ...data, bookingId: booking.id } });
      changes[`traveller ${sequence}`] = {
        before: null,
        after: `${data.firstName} ${data.lastName}`,
      };
    }

    for (const row of booking.passengers) {
      if (kept.has(row.id)) continue;
      await tx.passenger.delete({ where: { id: row.id } });
      changes[`removed ${row.firstName} ${row.lastName}`] = {
        before: `${row.firstName} ${row.lastName}`,
        after: null,
      };
    }

    if (Object.keys(changes).length === 0) {
      return {
        bookingId: booking.id,
        bookingNumber: booking.bookingNumber,
        changed: 0,
      };
    }

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: booking.id,
        adminUserId: actorId,
        summary: `Updated the travellers on booking ${booking.bookingNumber}`,
        changes,
      },
      tx,
    );

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      changed: Object.keys(changes).length,
    };
  });
}
