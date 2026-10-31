import "server-only";

import {
  AuditAction,
  BookingProduct,
  BookingStatus,
  FollowUpStatus,
  type BookingPriority,
  type McoStatus,
  TicketStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { derivePriority } from "@/lib/bookings/priority";
import { businessDayBounds } from "@/lib/format";
import { sanitiseRichText } from "@/lib/html/sanitise";
import { prisma } from "@/lib/db/prisma";
import { nextBookingNumber, nextCustomerReference } from "@/lib/db/references";
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
        // Status and priority are not the agent's to choose: a new booking
        // always starts Pending, and priority follows the travel date.
        status: BookingStatus.PENDING,
        priority: derivePriority(booking.departureDate, new Date()),
        chargeOutcome: booking.chargeOutcome,
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
            toStatus: BookingStatus.PENDING,
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
    // Both bounds are the operator's calendar days in the business timezone,
    // inclusive. `bookedAt` is an instant, and the filter value is a date-only
    // string parsed as midnight UTC, so the two have to be reconciled: adding
    // 24 hours to midnight UTC closed the day at 19:59 in New York, and a
    // booking taken that evening was missing from a filter for its own day.
    where.bookedAt = {
      ...(filters.from ? { gte: businessDayBounds(filters.from).start } : {}),
      ...(filters.to ? { lte: businessDayBounds(filters.to).end } : {}),
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
      chargeOutcome: true,
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
      chargeSplits: {
        select: {
          id: true,
          sequence: true,
          title: true,
          amountMinor: true,
        },
        orderBy: { sequence: "asc" as const },
      },
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

/** One line of a split total, already converted against the currency. */
export interface ChargeSplitDraft {
  title: string;
  amountMinor: number;
}

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
  /** How the total is divided, when `booking.splitCharges` says it is. */
  splits?: ChargeSplitDraft[];
}

/**
 * Settles which customer a cruise booking belongs to.
 *
 * The cruise form has no customer picker: a cruise is sold to the people
 * sailing, so the first guest is the customer. An existing record is reused
 * when the booking's contact email or phone identifies one — matching on the
 * name alone is deliberately not enough, as it is elsewhere in the app.
 */
async function resolveCruiseCustomerId(
  tx: Prisma.TransactionClient,
  booking: CruiseBookingInput,
  guests: CruiseGuestInput[],
  actorId: string,
): Promise<string> {
  if (booking.customerId) return booking.customerId;

  const lead = guests[0];
  if (!lead) {
    throw new Error("A cruise booking needs at least one guest to own it.");
  }

  const email = booking.contactEmail ?? null;
  const phone = booking.contactPhone ?? null;

  const identifiers: Prisma.CustomerWhereInput[] = [];
  if (email) identifiers.push({ email });
  if (phone) identifiers.push({ phone });

  if (identifiers.length > 0) {
    const existing = await tx.customer.findFirst({
      where: { OR: identifiers },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (existing) return existing.id;
  }

  const reference = await nextCustomerReference(tx);

  const customer = await tx.customer.create({
    data: {
      reference,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email,
      phone,
      billingAddressLine1: booking.billingAddressLine1 ?? null,
      billingCity: booking.billingCity ?? null,
      billingState: booking.billingState ?? null,
      billingPostalCode: booking.billingPostalCode ?? null,
      billingCountry: booking.billingCountry ?? null,
      preferredLanguage: booking.language ?? null,
    },
    select: { id: true },
  });

  await recordAudit(
    {
      action: AuditAction.CREATE,
      entityType: "Customer",
      entityId: customer.id,
      adminUserId: actorId,
      summary: `Created customer ${reference} from a cruise booking`,
    },
    tx,
  );

  return customer.id;
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
  { booking, amounts, guests, splits = [] }: CreateCruiseBookingInput,
  actorId: string,
): Promise<{ id: string; bookingNumber: string }> {
  return prisma.$transaction(async (tx) => {
    const bookingNumber = await nextBookingNumber(tx);
    const customerId = await resolveCruiseCustomerId(tx, booking, guests, actorId);

    const created = await tx.booking.create({
      data: {
        bookingNumber,
        product: BookingProduct.CRUISE,
        // As above: Pending, with priority following the sail date.
        status: BookingStatus.PENDING,
        priority: derivePriority(booking.sailDate, new Date()),
        chargeOutcome: booking.chargeOutcome,
        bookingTypeId: booking.bookingTypeId ?? null,
        customerId,
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
            sailingName: booking.sailingName ?? null,
            specialRequest: booking.specialRequest ?? null,
            deckNumber: booking.deckNumber ?? null,
            cabinNumber: booking.cabinNumber ?? null,
            cabinCategory: booking.cabinCategory ?? null,
            cabinCount: booking.cabinCount,
            diningPreference: booking.diningPreference ?? null,
            gratuitiesIncluded: booking.gratuitiesIncluded,
            insuranceIncluded: booking.insuranceIncluded,
            assistanceNotes: booking.assistanceNotes ?? null,
          },
        },

        // Only written when the booking claims to be split: a row here would
        // otherwise describe a division the booking says does not exist.
        ...(booking.splitCharges && splits.length > 0
          ? {
              chargeSplits: {
                create: splits.map((split, index) => ({
                  sequence: index + 1,
                  title: split.title,
                  amountMinor: split.amountMinor,
                })),
              },
            }
          : {}),

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
            toStatus: BookingStatus.PENDING,
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

/**
 * Raised when the booking is in no condition to be deleted.
 *
 * Separate from a fault: these are the rules refusing, and the message is
 * written to be shown to the operator as-is.
 */
export class BookingNotDeletableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BookingNotDeletableError";
  }
}

/**
 * Raised when an edit names a booking that is not there.
 *
 * Carries the id rather than a sentence: the id is for the log, and the action
 * that catches this is what phrases it for the operator.
 */
export class BookingNotFoundError extends Error {
  constructor(public readonly bookingId: string) {
    super(`Booking ${bookingId} does not exist.`);
    this.name = "BookingNotFoundError";
  }
}

export interface DeleteBookingInput {
  bookingId: string;
  actorId: string;
  /** Why the booking should never have existed. Recorded in the audit log. */
  reason: string;
  /**
   * The booking number as the operator typed it back.
   *
   * Checked here and not only in the form: the deliberate-act guard is worth
   * nothing if a mis-aimed request can skip it.
   */
  confirmation: string;
}

export interface DeleteBookingResult {
  bookingId: string;
  bookingNumber: string;
}

/**
 * Erases a booking that was created in error.
 *
 * Deletion is not cancellation. A booking that happened and then fell through
 * is CANCELLED and keeps its history; this is for the record that should never
 * have been written at all — the wrong customer, a duplicate, a test.
 *
 * Which is why it refuses the moment the booking has acquired anything real:
 * money, paperwork, a case, or an issued ticket. Those rows are the business's
 * own account of itself and several are `onDelete: Restrict` in the schema
 * besides — the checks below exist so the operator gets a sentence explaining
 * what is holding the record in place rather than a foreign-key error.
 *
 * What goes with it are the parts that only describe the booking: its flight
 * or cruise detail, segments, passengers, comments, follow-ups and status
 * history, all `onDelete: Cascade`. Call records, messages and notifications
 * survive with a null booking, because they record something that genuinely
 * happened to a person.
 */
export async function deleteBooking({
  bookingId,
  actorId,
  reason,
  confirmation,
}: DeleteBookingInput): Promise<DeleteBookingResult> {
  return prisma.$transaction(async (tx) => {
    // Read inside the transaction so a payment recorded a moment ago cannot
    // slip between the checks and the delete.
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingNumber: true,
        product: true,
        status: true,
        ticketStatus: true,
        customerId: true,
        currency: true,
        totalMinor: true,
        _count: {
          select: {
            payments: true,
            refunds: true,
            chargebacks: true,
            adjustments: true,
            serviceCases: true,
            documents: true,
          },
        },
      },
    });

    if (!booking) {
      throw new Error(`Booking ${bookingId} does not exist.`);
    }

    if (
      confirmation.trim().toUpperCase() !== booking.bookingNumber.toUpperCase()
    ) {
      throw new BookingNotDeletableError(
        `Type ${booking.bookingNumber} exactly to confirm the deletion.`,
      );
    }

    if (booking.ticketStatus === TicketStatus.ISSUED) {
      throw new BookingNotDeletableError(
        "A ticket has been issued against this booking. Void the ticket with the airline and cancel the booking instead of deleting it.",
      );
    }

    const financial: [string, number][] = [
      ["payment", booking._count.payments],
      ["refund", booking._count.refunds],
      ["chargeback", booking._count.chargebacks],
      ["financial adjustment", booking._count.adjustments],
      ["service case", booking._count.serviceCases],
    ];

    const blocking = financial.filter(([, count]) => count > 0);

    if (blocking.length > 0) {
      const named = blocking
        .map(([label, count]) => `${count} ${label}${count === 1 ? "" : "s"}`)
        .join(", ");

      throw new BookingNotDeletableError(
        `This booking has ${named} recorded against it, which must be kept. Cancel the booking instead of deleting it.`,
      );
    }

    if (booking._count.documents > 0) {
      throw new BookingNotDeletableError(
        `This booking has ${booking._count.documents} document(s) attached. Remove them first, then delete the booking.`,
      );
    }

    // Written before the delete, and with `tx`, so the entry and the deletion
    // stand or fall together. `AuditLog.entityId` is a plain string with no
    // foreign key, so this outlives the row it describes — which is the point:
    // the log is the only remaining trace that the booking ever existed.
    await recordAudit(
      {
        action: AuditAction.DELETE,
        entityType: "Booking",
        entityId: booking.id,
        adminUserId: actorId,
        summary: `Deleted booking ${booking.bookingNumber}: ${reason}`,
        changes: {
          bookingNumber: { before: booking.bookingNumber, after: null },
          status: { before: booking.status, after: null },
          product: { before: booking.product, after: null },
          customerId: { before: booking.customerId, after: null },
          total: {
            before: `${booking.totalMinor} ${booking.currency}`,
            after: null,
          },
        },
      },
      tx,
    );

    await tx.booking.delete({ where: { id: booking.id } });

    return { bookingId: booking.id, bookingNumber: booking.bookingNumber };
  });
}

// --- Editing an existing booking -------------------------------------------

/**
 * The currency a booking is denominated in, or null if it is gone.
 *
 * Money arrives from a form as text and cannot be parsed without it: the
 * number of minor units in a major one is 2 in USD, 0 in JPY and 3 in KWD.
 */
export async function getBookingCurrency(
  bookingId: string,
): Promise<{ currency: string } | null> {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: { currency: true },
  });
}

/**
 * Corrects a booking's money fields after it was created.
 *
 * These are set on the create form and were unreachable afterwards, which left
 * two dead ends an operator could not get out of: an MCO that cannot be
 * submitted because the booking carries no gross MCO amount, and a figure
 * typed wrongly that could only be corrected by deleting the booking and
 * entering it again.
 *
 * Every change is audited with its before and after. Raising the total after a
 * ticket has been issued is deliberately *allowed* — a supplier re-invoicing a
 * booking is ordinary, and refusing it would send people back to deleting and
 * recreating, which loses the history. What matters is that the change is
 * attributable, which the audit entry makes it.
 */
export async function updateBookingFinancials(input: {
  bookingId: string;
  actorId: string;
  amounts: {
    baseFareMinor: number;
    taxesFeesMinor: number;
    totalMinor: number;
    supplierCostMinor: number;
    grossMcoMinor: number;
    netMcoMinor: number;
  };
  /** Whether the total is collected across more than one card. */
  splitCharges: boolean;
  /** The division, replacing whatever was stored. Empty clears it. */
  splits?: ChargeSplitDraft[];
}): Promise<{ bookingId: string; bookingNumber: string }> {
  const { bookingId, actorId, amounts, splitCharges, splits = [] } = input;

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingNumber: true,
        currency: true,
        baseFareMinor: true,
        taxesFeesMinor: true,
        totalMinor: true,
        supplierCostMinor: true,
        grossMcoMinor: true,
        netMcoMinor: true,
        splitCharges: true,
        chargeSplits: {
          select: { title: true, amountMinor: true },
          orderBy: { sequence: "asc" as const },
        },
      },
    });

    if (!booking) throw new BookingNotFoundError(bookingId);

    const fields = [
      ["baseFare", booking.baseFareMinor, amounts.baseFareMinor],
      ["taxesFees", booking.taxesFeesMinor, amounts.taxesFeesMinor],
      ["total", booking.totalMinor, amounts.totalMinor],
      ["supplierCost", booking.supplierCostMinor, amounts.supplierCostMinor],
      ["grossMco", booking.grossMcoMinor, amounts.grossMcoMinor],
      ["netMco", booking.netMcoMinor, amounts.netMcoMinor],
    ] as const;

    const changes: Record<string, { before: string; after: string }> = {};
    for (const [name, before, after] of fields) {
      if (before === after) continue;
      changes[name] = {
        before: `${before} ${booking.currency}`,
        after: `${after} ${booking.currency}`,
      };
    }

    // Not an amount, but it travels with them: it says how the total is
    // collected, and the audit entry should read the same way.
    if (booking.splitCharges !== splitCharges) {
      changes["splitCharges"] = {
        before: booking.splitCharges ? "Yes" : "No",
        after: splitCharges ? "Yes" : "No",
      };
    }

    // The division is replaced wholesale rather than diffed row by row: these
    // rows have no identity worth preserving — "the 900.00 deposit" is the
    // whole of what one is — and a replace cannot leave a half-applied split.
    const wanted = splitCharges ? splits : [];
    const describe = (
      rows: readonly { title: string; amountMinor: number }[],
    ) =>
      rows.length === 0
        ? "none"
        : rows
            .map((row) => `${row.title}: ${row.amountMinor} ${booking.currency}`)
            .join("; ");

    const splitsBefore = describe(booking.chargeSplits);
    const splitsAfter = describe(wanted);
    const splitsChanged = splitsBefore !== splitsAfter;

    if (splitsChanged) {
      changes["chargeSplits"] = { before: splitsBefore, after: splitsAfter };
    }

    // Nothing moved: no write, and no audit entry claiming one happened.
    if (Object.keys(changes).length === 0) {
      return { bookingId: booking.id, bookingNumber: booking.bookingNumber };
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        baseFareMinor: amounts.baseFareMinor,
        taxesFeesMinor: amounts.taxesFeesMinor,
        totalMinor: amounts.totalMinor,
        supplierCostMinor: amounts.supplierCostMinor,
        grossMcoMinor: amounts.grossMcoMinor,
        netMcoMinor: amounts.netMcoMinor,
        splitCharges,
        ...(splitsChanged
          ? {
              chargeSplits: {
                deleteMany: {},
                create: wanted.map((split, index) => ({
                  sequence: index + 1,
                  title: split.title,
                  amountMinor: split.amountMinor,
                })),
              },
            }
          : {}),
      },
    });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: booking.id,
        adminUserId: actorId,
        summary: `Updated financials on booking ${booking.bookingNumber}`,
        changes,
      },
      tx,
    );

    return { bookingId: booking.id, bookingNumber: booking.bookingNumber };
  });
}

/**
 * Records the airline confirmation and supplier reference after creation.
 *
 * The airline confirmation is what the ticketing gate checks, and it could
 * only be set on the create form. An operator who did not have it to hand at
 * the time — the usual case, since it comes back from the airline afterwards —
 * was left with a panel insisting they "record the airline or supplier
 * confirmation reference" and nowhere to record it.
 */
export async function updateTicketingDetails(input: {
  bookingId: string;
  actorId: string;
  airlineConfirmation: string | null;
  ticketingReference: string | null;
}): Promise<{ bookingId: string; bookingNumber: string }> {
  const { bookingId, actorId, airlineConfirmation, ticketingReference } = input;

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingNumber: true,
        airlineConfirmation: true,
        ticketingReference: true,
      },
    });

    if (!booking) throw new BookingNotFoundError(bookingId);

    const changes: Record<string, { before: string | null; after: string | null }> = {};
    if (booking.airlineConfirmation !== airlineConfirmation) {
      changes["airlineConfirmation"] = {
        before: booking.airlineConfirmation,
        after: airlineConfirmation,
      };
    }
    if (booking.ticketingReference !== ticketingReference) {
      changes["supplierReference"] = {
        before: booking.ticketingReference,
        after: ticketingReference,
      };
    }

    if (Object.keys(changes).length === 0) {
      return { bookingId: booking.id, bookingNumber: booking.bookingNumber };
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: { airlineConfirmation, ticketingReference },
    });

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        entityType: "Booking",
        entityId: booking.id,
        adminUserId: actorId,
        // The confirmation is the evidence a ticket is issued against, so a
        // change to it is worth reading in the log without opening the entry.
        summary: `Updated ticketing references on booking ${booking.bookingNumber}`,
        changes,
      },
      tx,
    );

    return { bookingId: booking.id, bookingNumber: booking.bookingNumber };
  });
}
