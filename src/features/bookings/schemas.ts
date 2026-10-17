import { z } from "zod";

import {
  BookingPriority,
  BookingStatus,
  McoStatus,
  PassengerType,
  TicketStatus,
} from "@/generated/prisma/enums";
import { parseAmountToMinor } from "@/lib/financial/money";

/**
 * Flight booking validation.
 *
 * Section letters refer to the plan's breakdown of the create-booking form.
 * Money arrives from the browser as a decimal string and is converted to
 * integer minor units here, at the boundary — nothing downstream ever handles
 * a float amount.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max);

/** IATA airport code. Stored uppercase so searches match regardless of entry. */
const airportCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter airport code, e.g. JFK.");

const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.");

/**
 * Parses a decimal money string into minor units against the chosen currency.
 *
 * Returned as a factory because the exponent depends on the currency, which is
 * only known once the rest of the form has been parsed.
 */
export function moneyFieldToMinor(
  value: string | undefined,
  currency: string,
  field: string,
): { ok: true; minor: number } | { ok: false; field: string; message: string } {
  const text = (value ?? "").trim();
  if (text === "") return { ok: true, minor: 0 };

  const minor = parseAmountToMinor(text, currency);

  if (minor === null) {
    return {
      ok: false,
      field,
      message: `Enter a valid amount in ${currency}.`,
    };
  }

  if (minor < 0) {
    return { ok: false, field, message: "Amount cannot be negative." };
  }

  return { ok: true, minor };
}

/** An optional date input: "" becomes undefined rather than Invalid Date. */
const optionalDate = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional()
  .refine(
    (value) => value === undefined || !Number.isNaN(Date.parse(value)),
    "Enter a valid date.",
  )
  .transform((value) => (value === undefined ? undefined : new Date(value)));

/** Same handling for `datetime-local` inputs. */
const optionalDateTime = optionalDate;

// --- C. Passengers ----------------------------------------------------------

export const passengerSchema = z.object({
  title: optionalText(10),
  firstName: requiredText(100, "Enter a first name."),
  middleName: optionalText(100),
  lastName: requiredText(100, "Enter a last name."),
  type: z.enum(PassengerType).default(PassengerType.ADULT),
  gender: optionalText(20),
  dateOfBirth: optionalDate,
  passportNumber: optionalText(50),
  passportCountry: optionalText(100),
  passportExpiry: optionalDate,
  frequentFlyerNumber: optionalText(50),
  ticketNumber: optionalText(50),
  notes: optionalText(1_000),
});

export type PassengerInput = z.infer<typeof passengerSchema>;

// --- B. Flight segments -----------------------------------------------------

export const flightSegmentSchema = z
  .object({
    airline: requiredText(100, "Enter an airline."),
    flightNumber: requiredText(20, "Enter a flight number."),
    origin: airportCode,
    destination: airportCode,
    departureAt: z
      .string()
      .trim()
      .min(1, "Enter a departure time.")
      .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date and time.")
      .transform((value) => new Date(value)),
    arrivalAt: z
      .string()
      .trim()
      .min(1, "Enter an arrival time.")
      .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date and time.")
      .transform((value) => new Date(value)),
    bookingClass: optionalText(20),
    cabin: optionalText(40),
    operatingCarrier: optionalText(100),
  })
  .refine((segment) => segment.arrivalAt > segment.departureAt, {
    message: "Arrival must be after departure.",
    path: ["arrivalAt"],
  })
  .refine((segment) => segment.origin !== segment.destination, {
    message: "Origin and destination must differ.",
    path: ["destination"],
  });

export type FlightSegmentInput = z.infer<typeof flightSegmentSchema>;

// --- Whole form -------------------------------------------------------------

export const flightBookingSchema = z
  .object({
    // A. Booking details
    bookingTypeId: optionalText(40),
    language: optionalText(10),
    source: optionalText(100),
    priority: z.enum(BookingPriority).default(BookingPriority.NORMAL),
    status: z
      .enum(BookingStatus)
      // A new booking may only start as a draft or pending. Reaching Confirmed
      // or Ticketed requires evidence and goes through the transition service.
      .refine(
        (value) => value === BookingStatus.DRAFT || value === BookingStatus.PENDING,
        "A new booking starts as Draft or Pending.",
      )
      .default(BookingStatus.PENDING),
    assignedAgentId: optionalText(40),
    bookedAt: optionalDateTime,

    // B. Flight information
    pnrText: optionalText(10_000),
    pnrLocator: optionalText(20),
    airline: optionalText(100),
    bookingClass: optionalText(40),
    origin: optionalText(3),
    destination: optionalText(3),
    departureDate: optionalDate,
    returnDate: optionalDate,
    supplierId: optionalText(40),
    tfnId: optionalText(40),
    ticketStatus: z.enum(TicketStatus).default(TicketStatus.PENDING),
    ticketingReference: optionalText(100),

    // D. Customer and billing
    customerId: requiredText(40, "Select a customer."),
    contactName: optionalText(200),
    contactEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(255)
      .refine(
        (value) => value === "" || z.email().safeParse(value).success,
        "Enter a valid email address.",
      )
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
    contactPhone: optionalText(40),
    billingAddressLine1: optionalText(200),
    billingAddressLine2: optionalText(200),
    billingCity: optionalText(100),
    billingState: optionalText(100),
    billingPostalCode: optionalText(20),
    billingCountry: optionalText(100),

    // E. Ticketing
    airlineConfirmation: optionalText(100),
    ticketingNotes: optionalText(5_000),

    // F. Accounting — decimal strings, converted after the currency is known.
    currency: currencyCode.default("USD"),
    baseFare: optionalText(30),
    taxesFees: optionalText(30),
    total: optionalText(30),
    supplierCost: optionalText(30),
    grossMco: optionalText(30),
    netMco: optionalText(30),
    mcoSupplierId: optionalText(40),
    mcoStatus: z.enum(McoStatus).default(McoStatus.NOT_APPLICABLE),
    splitCharges: z.coerce.boolean().default(false),
    financialNotes: optionalText(5_000),

    // H. Comments and follow-up
    comment: optionalText(5_000),
    followUpAt: optionalDate,
  })
  .refine(
    (data) =>
      data.returnDate === undefined ||
      data.departureDate === undefined ||
      data.returnDate >= data.departureDate,
    { message: "The return date cannot be before departure.", path: ["returnDate"] },
  );

export type FlightBookingInput = z.infer<typeof flightBookingSchema>;

// --- List filters -----------------------------------------------------------

export const BOOKING_SORT_FIELDS = [
  "bookedAt",
  "bookingNumber",
  "totalMinor",
  "updatedAt",
] as const;

export const bookingSearchSchema = z.object({
  q: optionalText(200),
  status: z.enum(BookingStatus).optional(),
  ticketStatus: z.enum(TicketStatus).optional(),
  mcoStatus: z.enum(McoStatus).optional(),
  priority: z.enum(BookingPriority).optional(),
  agentId: optionalText(40),
  supplierId: optionalText(40),
  bookingTypeId: optionalText(40),
  currency: optionalText(3),
  from: optionalDate,
  to: optionalDate,
  sort: optionalText(50),
});

export type BookingSearchInput = z.infer<typeof bookingSearchSchema>;

// --- Status change ----------------------------------------------------------

export const statusChangeSchema = z.object({
  bookingId: requiredText(40, "Missing booking."),
  toStatus: z.enum(BookingStatus),
  reason: optionalText(1_000),
});
