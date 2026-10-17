import { z } from "zod";

import { CustomerStatus } from "@/generated/prisma/enums";

/**
 * Customer validation.
 *
 * Shared by the server actions and the forms, so the browser and the server
 * agree on what is valid. The server always re-validates — client-side checks
 * are a convenience and can be bypassed.
 */

/** Trims, then turns an empty string into undefined. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

export const customerInputSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name.").max(100),
  lastName: z.string().trim().min(1, "Enter a last name.").max(100),

  email: z
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

  phone: optionalText(40),
  status: z.enum(CustomerStatus).default(CustomerStatus.ACTIVE),

  billingAddressLine1: optionalText(200),
  billingAddressLine2: optionalText(200),
  billingCity: optionalText(100),
  billingState: optionalText(100),
  billingPostalCode: optionalText(20),
  billingCountry: optionalText(100),

  preferredLanguage: optionalText(10),
  notes: optionalText(5_000),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

/**
 * Creation additionally requires a way to reach the customer.
 *
 * A record with neither email nor phone cannot be matched against future
 * enquiries and becomes a duplicate waiting to happen.
 */
export const createCustomerSchema = customerInputSchema
  .extend({
    /**
     * Set when the operator has seen the duplicate warning and chosen to
     * proceed anyway. Without it, a likely duplicate is refused.
     */
    confirmedDuplicate: z.coerce.boolean().default(false),
  })
  .refine((data) => Boolean(data.email ?? data.phone), {
    message: "Enter an email address or a phone number.",
    path: ["email"],
  });

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = customerInputSchema.refine(
  (data) => Boolean(data.email ?? data.phone),
  {
    message: "Enter an email address or a phone number.",
    path: ["email"],
  },
);

export const CUSTOMER_SORT_FIELDS = [
  "createdAt",
  "lastName",
  "reference",
] as const;

export const customerSearchSchema = z.object({
  q: optionalText(200),
  status: z.enum(CustomerStatus).optional(),
  sort: optionalText(50),
});

export type CustomerSearchInput = z.infer<typeof customerSearchSchema>;
