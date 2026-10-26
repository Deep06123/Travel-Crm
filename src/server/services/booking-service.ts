import "server-only";

import {
  AuditAction,
  BookingProduct,
  FollowUpStatus,
  type BookingPriority,
  type BookingStatus,
  type McoStatus,
  TicketStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { sanitiseRichText } from "@/lib/html/sanitise";
import { prisma } from "@/lib/db/prisma";
import { nextBookingNumber } from "@/lib/db/references";
import {
  paginate,
  resolveSort,
  toPageRequest,
  type Paginated,
  type PaginationInput,
} from "@/lib/pagination";
import {
  BOOKING_SORT_FIELDS,
  type FlightBookingInput,
  type FlightSegmentInput,
  type PassengerInput,
} from "@/features/bookings/schemas";
import type {
  CruiseBookingInput,
  CruiseGuestInput,
} from "@/features/bookings/cruise-schemas";

/**
 * Bookings.
 *
 * Status changes do NOT happen here — `booking-status-service` owns them, so
 * the lifecycle rules cannot be sidestepped by an update that happens to set a
 * status field. Creation may only open a booking in Draft or Pending, which the
 * schema enforces.
 */

export interface CreateFlightBookingInput {
  booking: FlightBookingInput;
  /** Minor-unit amounts, already converted against the booking's currency. */
  amounts: {
    baseFareMinor: number;
    taxesFeesMinor: number;
    totalMinor: number;
    supplierCostMinor: number;
    grossMcoMinor: number;
    netMcoMinor: number;
  };
  passengers: PassengerInput[];
  segments: FlightSegmentInput[];
}

export async function createFlightBooking(
  { booking, amounts, passengers, segments }: CreateFlightBookingInput,
  actorId: string,
): Promise<{ id: string; bookingNumber: string }> {
  return prisma.$transaction(async (tx) => {
    const bookingNumber = await nextBookingNumber(tx);

    const created = await tx.booking.create({
      data: {
        bookingNumber,
        product: BookingProduct.FLIGHT,
        status: booking.status,
        priority: booking.priority,
        bookingTypeId: booking.bookingTypeId ?? null,
        customerId: booking.customerId,
        createdById: actorId,
        assignedAgentId: booking.assignedAgentId ?? null,
        supplierId: booking.supplierId ?? null,
        mcoSupplierId: booking.mcoSupplierId ?? null,
        tfnId: booking.tfnId ?? null,
        source: booking.source ?? null,
        language: booking.language ?? null,
        customEmailSubject: booking.customEmailSubject ?? null,
        emailTopHeading: booking.emailTopHeading ?? null,

        contactName: booking.contactName ?? null,
        contactEmail: booking.contactEmail ?? null,
        contactPhone: booking.contactPhone ?? null,
        billingAddressLine1: booking.billingAddressLine1 ?? null,
        billingAddressLine2: booking.billingAddressLine2 ?? null,
        billingCity: booking.billingCity ?? null,
        billingState: booking.billingState ?? null,
        billingPostalCode: booking.billingPostalCode ?? null,
        billingCountry: booking.billingCountry ?? null,

        // The card number and CVV are not in `booking` to be written: the form
        // never submits them. Only what is safe to keep reaches this far.
        cardHolderName: booking.cardHolderName ?? null,
        cardType: booking.cardType ?? null,
        cardLast4: booking.cardLast4 ?? null,
        cardExpiry: booking.cardExpiry ?? null,
        inboundPhone: booking.inboundPhone ?? null,
        billingPhone: booking.billingPhone ?? null,
        billingEmails: booking.billingEmails ?? null,

        ticketStatus: booking.ticketStatus,
        airlineConfirmation: booking.airlineConfirmation ?? null,
        ticketingReference: booking.ticketingReference ?? null,
        ticketingNotes: booking.ticketingNotes ?? null,

        mcoStatus: booking.mcoStatus,

        currency: booking.currency,
        baseFareMinor: amounts.baseFareMinor,
        taxesFeesMinor: amounts.taxesFeesMinor,
        totalMinor: amounts.totalMinor,
        supplierCostMinor: amounts.supplierCostMinor,
        grossMcoMinor: amounts.grossMcoMinor,
        netMcoMinor: amounts.netMcoMinor,
        splitCharges: booking.splitCharges,
        financialNotes: booking.financialNotes ?? null,

        travelStartDate: booking.departureDate ?? null,
        travelEndDate: booking.returnDate ?? null,
        followUpAt: booking.followUpAt ?? null,
        ...(booking.bookedAt ? { bookedAt: booking.bookedAt } : {}),

        flightDetail: {
          create: {
            // Stored exactly as typed. Decoding a PNR into segments is a
            // separate, explicit action — this field is never assumed parsed.
            pnrText: booking.pnrText ?? null,
            // Markup is the one value here kept as markup rather than escaped at
            // render, so it is made safe on the way in.
            itineraryHtml: sanitiseRichText(booking.itineraryHtml),
            pnrLocator: booking.pnrLocator ?? null,
            airline: booking.airline ?? null,
            bookingClass: booking.bookingClass ?? null,
            origin: booking.origin?.toUpperCase() ?? null,
            destination: booking.destination?.toUpperCase() ?? null,
            departureDate: booking.departureDate ?? null,
            returnDate: booking.returnDate ?? null,
            isRoundTrip: booking.returnDate !== undefined,
          },
        },

        passengers: {
          create: passengers.map((passenger, index) => ({
            sequence: index + 1,
            title: passenger.title ?? null,
            firstName: passenger.firstName,
            middleName: passenger.middleName ?? null,
            lastName: passenger.lastName,
            type: passenger.type,
            gender: passenger.gender ?? null,
            dateOfBirth: passenger.dateOfBirth ?? null,
            passportNumber: passenger.passportNumber ?? null,
            passportCountry: passenger.passportCountry ?? null,
            passportExpiry: passenger.passportExpiry ?? null,
            frequentFlyerNumber: passenger.frequentFlyerNumber ?? null,
            ticketNumber: passenger.ticketNumber ?? null,
            notes: passenger.notes ?? null,
          })),
        },

        segments: {
          create: segments.map((segment, index) => ({
            sequence: index + 1,
            airline: segment.airline,
            flightNumber: segment.flightNumber,
            origin: segment.origin,
            destination: segment.destination,
            departureAt: segment.departureAt,
            arrivalAt: segment.arrivalAt,
            bookingClass: segment.bookingClass ?? null,
            cabin: segment.cabin ?? null,
            operatingCarrier: segment.operatingCarrier ?? null,
          })),
        },

        // The opening status is recorded in history from the outset, so the
        // trail starts at creation rather than at the first later change.
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: booking.status,
            reason: "Booking created",
            changedById: actorId,
          },
        },

        ...(booking.comment
          ? {
              comments: {
                create: {
                  body: booking.comment,
                  authorId: actorId,
                  followUpAt: booking.followUpAt ?? null,
                },
              },
            }
          : {}),
      },
      select: { id: true, bookingNumber: true },
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        entityType: "Booking",
        entityId: created.id,
        adminUserId: actorId,
        summary: `Created flight booking ${created.bookingNumber}`,
      },
      tx,
    );

    return created;
  });
}

// --- Listing ----------------------------------------------------------------

export interface BookingListFilters {
  q?: string | undefined;
  status?: BookingStatus | undefined;
  ticketStatus?: TicketStatus | undefined;
  mcoStatus?: McoStatus | undefined;
  priority?: BookingPriority | undefined;
  agentId?: string | undefined;
  supplierId?: string | undefined;
  /** Language the booking is handled in, e.g. `en`. */
  language?: string | undefined;
  /**
   * Last four digits of a card used to pay for the booking.
   *
   * Matched against the payments attached to it, because that is the only
   * place card detail exists — the booking itself holds none. Full numbers
   * are never stored, so four digits is the most that can ever be searched
   * on, and they identify a card weakly: expect several bookings back.
   */
  cardLast4?: string | undefined;
  bookingTypeId?: string | undefined;
  currency?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  sort?: string | undefined;
}

export function buildBookingWhere(
  filters: BookingListFilters,
): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.ticketStatus) where.ticketStatus = filters.ticketStatus;
  if (filters.mcoStatus) where.mcoStatus = filters.mcoStatus;
  if (filters.priority) where.priority = filters.priority;
  if (filters.agentId) where.assignedAgentId = filters.agentId;
  if (filters.language) where.language = filters.language;

  if (filters.cardLast4) {
    where.payments = { some: { cardLast4: filters.cardLast4.trim() } };
  }
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.bookingTypeId) where.bookingTypeId = filters.bookingTypeId;
  if (filters.currency) where.currency = filters.currency.toUpperCase();

  if (filters.from || filters.to) {
    where.bookedAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      // The "to" bound is inclusive of the whole day the operator picked.
      ...(filters.to
        ? { lte: new Date(filters.to.getTime() + 86_400_000 - 1) }
        : {}),
    };
  }

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { bookingNumber: { contains: term } },
      { airlineConfirmation: { contains: term } },
      { contactEmail: { contains: term } },
      { contactPhone: { contains: term } },
      { contactName: { contains: term } },
      { customer: { firstName: { contains: term } } },
      { customer: { lastName: { contains: term } } },
      { customer: { email: { contains: term } } },
      { customer: { phone: { contains: term } } },
      { customer: { reference: { contains: term } } },
      { flightDetail: { pnrLocator: { contains: term } } },
      { passengers: { some: { ticketNumber: { contains: term } } } },
    ];
  }

  return where;
}

export interface BookingListRow {
  id: string;
  bookingNumber: string;
  product: BookingProduct;
  status: BookingStatus;
  ticketStatus: TicketStatus;
  mcoStatus: McoStatus;
  priority: BookingPriority;
  currency: string;
  totalMinor: number;
  grossMcoMinor: number;
  netMcoMinor: number;
  bookedAt: Date;
  followUpAt: Date | null;
  airlineConfirmation: string | null;
  customer: { id: string; firstName: string; lastName: string; email: string | null };
  bookingType: { label: string } | null;
  assignedAgent: { id: string; name: string } | null;
  /** Who raised the booking. Reassignment changes the agent, not the author. */
  createdBy: { id: string; name: string } | null;
  supplier: { name: string } | null;
  /**
   * Only the follow-ups still outstanding.
   *
   * The list column answers "is anything owed on this booking", so a resolved
   * follow-up is not interesting here and a booking with ten of them has
   * nothing outstanding.
   */
  followUps: { id: string; dueAt: Date | null }[];
}

export async function listBookings(
  filters: BookingListFilters,
  pagination: PaginationInput,
): Promise<Paginated<BookingListRow>> {
  const where = buildBookingWhere(filters);
  const { field, direction } = resolveSort(
    filters.sort,
    BOOKING_SORT_FIELDS,
    "bookedAt",
  );
  const { skip, take } = toPageRequest(pagination);

  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { [field]: direction },
      skip,
      take,
      select: {
        id: true,
        bookingNumber: true,
        product: true,
        status: true,
        ticketStatus: true,
        mcoStatus: true,
        priority: true,
        currency: true,
        totalMinor: true,
        grossMcoMinor: true,
        netMcoMinor: true,
        bookedAt: true,
        followUpAt: true,
        airlineConfirmation: true,
        customer: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        bookingType: { select: { label: true } },
        assignedAgent: { select: { id: true, name: true } },
        // Who raised the booking, which is not always who now owns it.
        createdBy: { select: { id: true, name: true } },
        supplier: { select: { name: true } },
        // Only the open ones: the column answers "is anything outstanding",
        // and a booking with ten resolved follow-ups has nothing outstanding.
        followUps: {
          where: {
            status: {
              in: [FollowUpStatus.OPEN, FollowUpStatus.IN_PROGRESS],
            },
          },
          select: { id: true, dueAt: true },
        },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return paginate(rows, total, pagination);
}

/**
 * Full booking record for the detail page.
 *
 * Passport fields are selected here but stripped by the caller for roles
 * without `passenger.viewSensitive`; see `redactPassengers`.
 */
export async function getBookingDetail(id: string) {
  return prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      bookingNumber: true,
      product: true,
      status: true,
      priority: true,
      source: true,
      language: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      billingAddressLine1: true,
      billingAddressLine2: true,
      billingCity: true,
      billingState: true,
      billingPostalCode: true,
      billingCountry: true,
      cardHolderName: true,
      cardType: true,
      cardLast4: true,
      cardExpiry: true,
      inboundPhone: true,
      billingPhone: true,
      billingEmails: true,
      ticketStatus: true,
      airlineConfirmation: true,
      ticketingReference: true,
      ticketedAt: true,
      ticketingNotes: true,
      mcoStatus: true,
      currency: true,
      baseFareMinor: true,
      taxesFeesMinor: true,
      totalMinor: true,
      supplierCostMinor: true,
      grossMcoMinor: true,
      netMcoMinor: true,
      splitCharges: true,
      financialNotes: true,
      travelStartDate: true,
      travelEndDate: true,
      followUpAt: true,
      bookedAt: true,
      createdAt: true,
      updatedAt: true,

      customer: {
        select: {
          id: true,
          reference: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      bookingType: { select: { id: true, label: true } },
      createdBy: { select: { id: true, name: true } },
      assignedAgent: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      mcoSupplier: { select: { id: true, name: true } },
      tfn: { select: { id: true, number: true, label: true } },

      flightDetail: true,
      cruiseDetail: true,
      segments: { orderBy: { sequence: "asc" } },
      passengers: { orderBy: { sequence: "asc" } },

      comments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          body: true,
          category: true,
          visibility: true,
          followUpAt: true,
          createdAt: true,
          author: { select: { id: true, name: true } },
        },
      },

      followUps: {
        orderBy: { dueAt: "asc" },
        select: {
          id: true,
          reason: true,
          priority: true,
          status: true,
          dueAt: true,
          lastActionAt: true,
          lastActionNote: true,
          resolutionNotes: true,
          completedAt: true,
          assignee: { select: { id: true, name: true } },
        },
      },

      statusHistory: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          createdAt: true,
          changedBy: { select: { id: true, name: true } },
        },
      },

      payments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          reference: true,
          amountMinor: true,
          currency: true,
          method: true,
          status: true,
          captureMode: true,
          provider: true,
          providerTransactionId: true,
          cardLast4: true,
          cardBrand: true,
          reconciliationStatus: true,
          createdAt: true,
        },
      },

      refunds: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          reference: true,
          kind: true,
          requestedAmountMinor: true,
          approvedAmountMinor: true,
          currency: true,
          reason: true,
          status: true,
          requestedAt: true,
          completedAt: true,
        },
      },

      documents: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          category: true,
          origin: true,
          verificationStatus: true,
          createdAt: true,
        },
      },
    },
  });
}

export type BookingDetail = NonNullable<
  Awaited<ReturnType<typeof getBookingDetail>>
>;

/**
 * Removes restricted traveller detail.
 *
 * Applied for any role without `passenger.viewSensitive`. Stripping at the
 * boundary means the values never reach the rendered HTML, rather than being
 * sent and merely hidden by CSS.
 */
export function redactPassengers(
  passengers: BookingDetail["passengers"],
): BookingDetail["passengers"] {
  return passengers.map((passenger) => ({
    ...passenger,
    dateOfBirth: null,
    passportNumber: null,
    passportCountry: null,
    passportExpiry: null,
  }));
}

// --- Cruise bookings --------------------------------------------------------

export interface CreateCruiseBookingInput {
  booking: CruiseBookingInput;
  /** Minor-unit amounts, already converted against the booking's currency. */
  amounts: {
    baseFareMinor: number;
    taxesFeesMinor: number;
    totalMinor: number;
    supplierCostMinor: number;
    grossMcoMinor: number;
    netMcoMinor: number;
  };
  guests: CruiseGuestInput[];
}

/**
 * Creates a cruise booking.
 *
 * Shares Booking with flights but writes CruiseDetail instead of FlightDetail,
 * and leaves every airline column untouched: a cruise record carries no PNR, no
 * airline confirmation and no ticket status. `ticketStatus` is set to
 * NOT_APPLICABLE rather than PENDING so cruise bookings never appear in the
 * ticketing backlog.
 */
export async function createCruiseBooking(
  { booking, amounts, guests }: CreateCruiseBookingInput,
  actorId: string,
): Promise<{ id: string; bookingNumber: string }> {
  return prisma.$transaction(async (tx) => {
    const bookingNumber = await nextBookingNumber(tx);

    const created = await tx.booking.create({
      data: {
        bookingNumber,
        product: BookingProduct.CRUISE,
        status: booking.status,
        priority: booking.priority,
        bookingTypeId: booking.bookingTypeId ?? null,
        customerId: booking.customerId,
        createdById: actorId,
        assignedAgentId: booking.assignedAgentId ?? null,
        supplierId: booking.supplierId ?? null,
        mcoSupplierId: booking.mcoSupplierId ?? null,
        tfnId: booking.tfnId ?? null,
        source: booking.source ?? null,
        language: booking.language ?? null,
        customEmailSubject: booking.customEmailSubject ?? null,
        emailTopHeading: booking.emailTopHeading ?? null,

        contactName: booking.contactName ?? null,
        contactEmail: booking.contactEmail ?? null,
        contactPhone: booking.contactPhone ?? null,
        billingAddressLine1: booking.billingAddressLine1 ?? null,
        billingCity: booking.billingCity ?? null,
        billingState: booking.billingState ?? null,
        billingPostalCode: booking.billingPostalCode ?? null,
        billingCountry: booking.billingCountry ?? null,

        // As on the flight path: the card number and CVV never arrive here.
        cardHolderName: booking.cardHolderName ?? null,
        cardType: booking.cardType ?? null,
        cardLast4: booking.cardLast4 ?? null,
        cardExpiry: booking.cardExpiry ?? null,
        inboundPhone: booking.inboundPhone ?? null,
        billingPhone: booking.billingPhone ?? null,
        billingEmails: booking.billingEmails ?? null,

        // Cruise bookings are confirmed by the cruise line, not ticketed by an
        // airline, so the ticketing lifecycle does not apply to them.
        ticketStatus: TicketStatus.NOT_APPLICABLE,
        airlineConfirmation: booking.confirmationReference ?? null,

        mcoStatus: booking.mcoStatus,

        currency: booking.currency,
        baseFareMinor: amounts.baseFareMinor,
        taxesFeesMinor: amounts.taxesFeesMinor,
        totalMinor: amounts.totalMinor,
        supplierCostMinor: amounts.supplierCostMinor,
        grossMcoMinor: amounts.grossMcoMinor,
        netMcoMinor: amounts.netMcoMinor,
        splitCharges: booking.splitCharges,
        financialNotes: booking.financialNotes ?? null,

        travelStartDate: booking.sailDate ?? null,
        travelEndDate: booking.returnDate ?? null,
        followUpAt: booking.followUpAt ?? null,
        ...(booking.bookedAt ? { bookedAt: booking.bookedAt } : {}),

        cruiseDetail: {
          create: {
            cruiseLine: booking.cruiseLine,
            ship: booking.ship ?? null,
            reservationNumber: booking.reservationNumber ?? null,
            reservationText: booking.reservationText ?? null,
            itineraryHtml: sanitiseRichText(booking.itineraryHtml),
            itinerary: booking.itinerary ?? null,
            departurePort: booking.departurePort ?? null,
            arrivalPort: booking.arrivalPort ?? null,
            sailDate: booking.sailDate ?? null,
            returnDate: booking.returnDate ?? null,
            nights: booking.nights ?? null,
            cabinNumber: booking.cabinNumber ?? null,
            cabinCategory: booking.cabinCategory ?? null,
            cabinCount: booking.cabinCount,
            diningPreference: booking.diningPreference ?? null,
            gratuitiesIncluded: booking.gratuitiesIncluded,
            insuranceIncluded: booking.insuranceIncluded,
            assistanceNotes: booking.assistanceNotes ?? null,
          },
        },

        // Guests reuse the Passenger table; ticketNumber stays null because a
        // cruise guest does not hold an air ticket.
        passengers: {
          create: guests.map((guest, index) => ({
            sequence: index + 1,
            title: guest.title ?? null,
            firstName: guest.firstName,
            middleName: guest.middleName ?? null,
            lastName: guest.lastName,
            type: guest.type,
            gender: guest.gender ?? null,
            dateOfBirth: guest.dateOfBirth ?? null,
            passportNumber: guest.passportNumber ?? null,
            passportCountry: guest.passportCountry ?? null,
            passportExpiry: guest.passportExpiry ?? null,
            cabinNumber: guest.cabinNumber ?? booking.cabinNumber ?? null,
            notes: guest.notes ?? null,
          })),
        },

        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: booking.status,
            reason: "Booking created",
            changedById: actorId,
          },
        },

        ...(booking.comment
          ? {
              comments: {
                create: {
                  body: booking.comment,
                  authorId: actorId,
                  followUpAt: booking.followUpAt ?? null,
                },
              },
            }
          : {}),
      },
      select: { id: true, bookingNumber: true },
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        entityType: "Booking",
        entityId: created.id,
        adminUserId: actorId,
        summary: `Created cruise booking ${created.bookingNumber}`,
      },
      tx,
    );

    return created;
  });
}
