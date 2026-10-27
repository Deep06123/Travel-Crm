import { z } from "zod";

import {
  BookingPriority,
  BookingStatus,
  CardType,
  ChargeOutcome,
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

/**
 * Billing information shared by the flight and cruise forms.
 *
 * There is no `cardNumber` or `cvv` here, and there must never be one. The
 * form does not submit them (see `billing-information.tsx`), so a field added
 * here would be the thing that starts accepting them.
 */
export const billingInformationFields = {
  cardHolderName: optionalText(200),
  cardType: z
    .union([z.enum(CardType), z.literal("")])
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  /** Derived in the browser from a number the server never receives. */
  cardLast4: z
    .string()
    .trim()
    .regex(/^(\d{4})?$/, "Enter the last four digits.")
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  cardExpiry: z
    .string()
    .trim()
    .regex(/^((0[1-9]|1[0-2])\d{2})?$/, "Enter the expiry as MMYY, e.g. 0428.")
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  inboundPhone: optionalText(40),
  billingPhone: optionalText(40),
  billingEmails: z
    .string()
    .trim()
    .max(500)
    .refine(
      (value) =>
        value === "" ||
        value
          .split(",")
          .every((part) => z.email().safeParse(part.trim()).success),
      "One of those email addresses is not valid.",
    )
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
} as const;

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
    // Neither priority nor status is submitted any more. Priority is derived
    // from how close travel is, and a new booking always starts Pending —
    // reaching Confirmed or Ticketed requires evidence and goes through the
    // transition service. Both are set in the booking service.
    chargeOutcome: z.enum(ChargeOutcome).default(ChargeOutcome.PENDING),
    assignedAgentId: optionalText(40),
    bookedAt: optionalDateTime,
    // Left blank, the template decides. See Booking.customEmailSubject.
    customEmailSubject: optionalText(200),
    emailTopHeading: optionalText(200),

    // B. Flight information
    pnrText: optionalText(10_000),
    // Markup from the rich-text editor. Larger than the raw-text limit because
    // tags are verbose; sanitised on the server before it is stored.
    itineraryHtml: optionalText(50_000),
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
    // Now a free-text block in the billing panel rather than a single line.
    billingAddressLine1: optionalText(500),
    billingAddressLine2: optionalText(200),
    billingCity: optionalText(100),
    billingState: optionalText(100),
    billingPostalCode: optionalText(20),
    billingCountry: optionalText(100),
    ...billingInformationFields,

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
  language: optionalText(10),
  // Four digits exactly. Anything else cannot match a stored value, and
  // accepting it would return everything rather than nothing.
  cardLast4: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .refine(
      (value) => value === undefined || /^\d{4}$/.test(value),
      "Enter the last four digits.",
    ),
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
