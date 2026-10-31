import { z } from "zod";

import { ChargeOutcome, McoStatus } from "@/generated/prisma/enums";

import { billingInformationFields, yesNo } from "./schemas";

/**
 * Cruise booking validation.
 *
 * Shares the customer, billing, accounting and follow-up shape with the flight
 * form, but carries cruise-specific fields instead of airline ones. Flight
 * columns are deliberately absent — a cruise record should not hold a PNR or a
 * ticket status, and the plan is explicit that the two must not bleed together.
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

const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.");

/** A cruise guest. Mirrors Passenger, without air-travel fields. */
export const cruiseGuestSchema = z.object({
  title: optionalText(10),
  firstName: requiredText(100, "Enter a first name."),
  middleName: optionalText(100),
  lastName: requiredText(100, "Enter a last name."),
  type: z.enum(["ADULT", "CHILD", "INFANT", "SENIOR"]).default("ADULT"),
  gender: optionalText(20),
  dateOfBirth: optionalDate,
  passportNumber: optionalText(50),
  passportCountry: optionalText(100),
  passportExpiry: optionalDate,
  /** Which cabin this guest occupies, when the booking holds more than one. */
  cabinNumber: optionalText(20),
  notes: optionalText(1_000),
});

export type CruiseGuestInput = z.infer<typeof cruiseGuestSchema>;

export const cruiseBookingSchema = z
  .object({
    // Booking details
    bookingTypeId: optionalText(40),
    language: optionalText(10),
    source: optionalText(100),
    // See the flight schema: priority is derived and status always starts
    // Pending, so neither is submitted.
    chargeOutcome: z.enum(ChargeOutcome).default(ChargeOutcome.PENDING),
    assignedAgentId: optionalText(40),
    bookedAt: optionalDate,
    // Left blank, the template decides. See Booking.customEmailSubject.
    customEmailSubject: optionalText(200),
    emailTopHeading: optionalText(200),

    // Cruise details
    cruiseLine: requiredText(120, "Enter a cruise line."),
    ship: optionalText(120),
    reservationNumber: optionalText(60),
    // The confirmation pasted verbatim, as a flight booking takes a PNR.
    reservationText: optionalText(10_000),
    // Markup from the rich-text editor. Larger than the raw-text limit because
    // tags are verbose; sanitised on the server before it is stored.
    itineraryHtml: optionalText(50_000),
    tfnId: optionalText(40),
    itinerary: optionalText(500),
    departurePort: optionalText(120),
    arrivalPort: optionalText(120),
    sailDate: optionalDate,
    returnDate: optionalDate,
    nights: z.coerce.number().int().min(0).max(400).optional(),
    // The sailing as the cruise line names it. `nights` stays the number so
    // sorting and the Nights column keep working.
    sailingName: optionalText(200),
    specialRequest: optionalText(500),

    deckNumber: optionalText(40),
    cabinNumber: optionalText(20),
    cabinCategory: optionalText(60),
    cabinCount: z.coerce.number().int().min(1).max(50).default(1),
    diningPreference: optionalText(60),
    gratuitiesIncluded: yesNo,
    insuranceIncluded: yesNo,
    assistanceNotes: optionalText(2_000),

    supplierId: optionalText(40),

    // Customer and billing
    // Optional: the cruise form has no customer picker. Left empty, the
    // customer is created from the first guest when the booking is saved.
    customerId: optionalText(40),
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
    billingCity: optionalText(100),
    billingState: optionalText(100),
    billingPostalCode: optionalText(20),
    billingCountry: optionalText(100),
    ...billingInformationFields,

    // Confirmation
    confirmationReference: optionalText(100),

    // Accounting
    currency: currencyCode.default("USD"),
    baseFare: optionalText(30),
    taxesFees: optionalText(30),
    total: optionalText(30),
    supplierCost: optionalText(30),
    grossMco: optionalText(30),
    netMco: optionalText(30),
    mcoSupplierId: optionalText(40),
    mcoStatus: z.enum(McoStatus).default(McoStatus.NOT_APPLICABLE),
    splitCharges: yesNo,
    financialNotes: optionalText(5_000),

    // Comments and follow-up
    comment: optionalText(5_000),
    followUpAt: optionalDate,
  })
  .refine(
    (data) =>
      data.returnDate === undefined ||
      data.sailDate === undefined ||
      data.returnDate >= data.sailDate,
    { message: "The return date cannot be before sailing.", path: ["returnDate"] },
  );

export type CruiseBookingInput = z.infer<typeof cruiseBookingSchema>;
