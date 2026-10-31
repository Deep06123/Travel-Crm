import { z } from "zod";

import {
  CardType,
  ChargeOutcome,
  PassengerType,
} from "@/generated/prisma/enums";

import { yesNo } from "./schemas";

/**
 * Correcting a booking after it was taken.
 *
 * The create forms were the only place most of these fields could be set, so
 * anything missed at the time — or typed wrongly — was stuck that way. These
 * schemas back the per-panel editors on the booking page.
 *
 * Deliberately more forgiving than the create schemas in one respect: a field
 * left blank is accepted and clears the stored value. Correcting a record
 * includes removing something that should never have been there, and a
 * validator that only ever accepts additions cannot express that.
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

/** A date-only field: "" clears it, anything else must be a real date. */
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

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Enter a valid email address.",
  )
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/** An optional whole number: "" clears it. */
const optionalCount = (max: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .refine(
      (value) => value === undefined || /^\d+$/.test(value),
      "Enter a whole number.",
    )
    .transform((value) => (value === undefined ? undefined : Number(value)))
    .refine(
      (value) => value === undefined || value <= max,
      `That is more than ${max}.`,
    );

// --- Overview ---------------------------------------------------------------

export const bookingOverviewSchema = z.object({
  bookingId: requiredText(40, "Missing booking."),
  bookingTypeId: optionalText(40),
  chargeOutcome: z.enum(ChargeOutcome),
  source: optionalText(100),
  language: optionalText(10),
  assignedAgentId: optionalText(40),
  supplierId: optionalText(40),
  bookedAt: optionalDate,
  contactName: optionalText(200),
  contactEmail: optionalEmail,
  contactPhone: optionalText(40),
});

export type BookingOverviewInput = z.infer<typeof bookingOverviewSchema>;

// --- Billing information ----------------------------------------------------

/**
 * The card as it is held on the booking: a holder, a brand, four digits and an
 * expiry. There is no `cardNumber` or `cvv` here for the same reason there is
 * none on the create form — the server has never been allowed to see either,
 * and a field here would be the thing that starts accepting them.
 *
 * Unlike the create form, an expiry in the past is accepted. This edits a
 * record of what was charged, possibly months ago; refusing the card that was
 * actually used because time has passed would make the true answer unwritable.
 */
export const bookingBillingSchema = z.object({
  bookingId: requiredText(40, "Missing booking."),
  cardHolderName: optionalText(200),
  cardType: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        (Object.values(CardType) as string[]).includes(value),
      "Select the card type.",
    ),
  cardLast4: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .refine(
      (value) => value === undefined || /^\d{4}$/.test(value),
      "Enter the last four digits only.",
    ),
  cardExpiry: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .refine(
      (value) => value === undefined || /^(0[1-9]|1[0-2])\d{2}$/.test(value),
      "Enter the expiry as MMYY, e.g. 0428.",
    ),
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
  billingAddressLine1: optionalText(500),
  billingCity: optionalText(100),
  billingState: optionalText(100),
  billingPostalCode: optionalText(20),
  billingCountry: optionalText(100),
});

export type BookingBillingInput = z.infer<typeof bookingBillingSchema>;

// --- Sailing ----------------------------------------------------------------

export const cruiseDetailSchema = z
  .object({
    bookingId: requiredText(40, "Missing booking."),
    cruiseLine: requiredText(120, "Enter a cruise line."),
    ship: optionalText(120),
    reservationNumber: optionalText(60),
    sailingName: optionalText(200),
    specialRequest: optionalText(500),
    departurePort: optionalText(120),
    arrivalPort: optionalText(120),
    sailDate: optionalDate,
    returnDate: optionalDate,
    nights: optionalCount(400),
    deckNumber: optionalText(40),
    cabinNumber: optionalText(20),
    cabinCategory: optionalText(60),
    cabinCount: optionalCount(50),
    diningPreference: optionalText(60),
    gratuitiesIncluded: yesNo,
    insuranceIncluded: yesNo,
    assistanceNotes: optionalText(2_000),
    itineraryHtml: optionalText(50_000),
  })
  .refine(
    (data) =>
      data.returnDate === undefined ||
      data.sailDate === undefined ||
      data.returnDate >= data.sailDate,
    { message: "The return date cannot be before sailing.", path: ["returnDate"] },
  );

export type CruiseDetailInput = z.infer<typeof cruiseDetailSchema>;

// --- Guests and passengers --------------------------------------------------

/**
 * One traveller on a saved booking.
 *
 * `id` carries an existing row through so an edit stays an edit: without it a
 * correction would delete the traveller and create a replacement, losing the
 * row that a ticket number and any document already point at.
 */
export const travellerEditSchema = z.object({
  id: optionalText(40),
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
  cabinNumber: optionalText(20),
  notes: optionalText(1_000),
});

export type TravellerEditInput = z.infer<typeof travellerEditSchema>;

export const travellersEditSchema = z.object({
  bookingId: requiredText(40, "Missing booking."),
});
