"use server";

import { revalidatePath } from "next/cache";

import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { isDatabaseUnavailable, DATABASE_UNAVAILABLE_MESSAGE } from "@/lib/db/errors";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import {
  BookingNotFoundError,
} from "@/server/services/booking-service";
import {
  TicketedTravellerError,
  updateBookingBilling,
  updateBookingOverview,
  updateBookingTravellers,
  updateCruiseDetail,
  type BookingEditResult,
} from "@/server/services/booking-edit-service";

import {
  bookingBillingSchema,
  bookingOverviewSchema,
  cruiseDetailSchema,
  travellerEditSchema,
  travellersEditSchema,
  type TravellerEditInput,
} from "./edit-schemas";

const log = loggerFor("booking-edit");

export interface BookingEditState {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
}

/** Field errors keyed the way the form names its controls. */
function collectFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
  prefix = "",
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of issues) {
    const key = `${prefix}${issue.path.map(String).join(".")}`;
    if (key && errors[key] === undefined) errors[key] = issue.message;
  }

  return errors;
}

/**
 * Turns a thrown error into something the panel can show.
 *
 * Shared by all four editors: they fail in the same three ways — the booking
 * went away, the database did, or something unforeseen — and an operator
 * reading the message should not be able to tell which panel produced it.
 */
function failure(error: unknown, bookingId: string, what: string): BookingEditState {
  if (error instanceof BookingNotFoundError) {
    return { error: "That booking no longer exists." };
  }

  if (error instanceof TicketedTravellerError) {
    return {
      error: `${error.names.join(", ")} holds a ticket, so cannot be removed. Void the ticket first.`,
    };
  }

  if (isDatabaseUnavailable(error)) {
    log.error({ err: error }, `Update ${what} failed: database unreachable`);
    return { error: DATABASE_UNAVAILABLE_MESSAGE };
  }

  log.error({ err: error, bookingId }, `Failed to update ${what}`);
  return { error: `The ${what} could not be saved. Try again.` };
}

/** The same answer whether or not anything actually moved. */
function saved(result: BookingEditResult, what: string): BookingEditState {
  revalidatePath(`/admin/bookings/${result.bookingId}`);

  return {
    success:
      result.changed === 0
        ? "Nothing had changed, so nothing was saved."
        : `${what} updated.`,
  };
}

export async function updateBookingOverviewAction(
  _previous: BookingEditState,
  formData: FormData,
): Promise<BookingEditState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_UPDATE);

  const parsed = bookingOverviewSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    return saved(await updateBookingOverview(parsed.data, user.id), "Overview");
  } catch (error) {
    return failure(error, parsed.data.bookingId, "overview");
  }
}

export async function updateBookingBillingAction(
  _previous: BookingEditState,
  formData: FormData,
): Promise<BookingEditState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_UPDATE);

  const parsed = bookingBillingSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    return saved(
      await updateBookingBilling(parsed.data, user.id),
      "Billing information",
    );
  } catch (error) {
    return failure(error, parsed.data.bookingId, "billing information");
  }
}

export async function updateCruiseDetailAction(
  _previous: BookingEditState,
  formData: FormData,
): Promise<BookingEditState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_UPDATE);

  const parsed = cruiseDetailSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error.issues) };
  }

  try {
    return saved(await updateCruiseDetail(parsed.data, user.id), "Sailing");
  } catch (error) {
    return failure(error, parsed.data.bookingId, "sailing");
  }
}

export async function updateBookingTravellersAction(
  _previous: BookingEditState,
  formData: FormData,
): Promise<BookingEditState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_UPDATE);
  const canEditSensitive = await currentUserCan(
    PERMISSIONS.PASSENGER_VIEW_SENSITIVE,
  );

  const parsed = travellersEditSchema.safeParse({
    bookingId: formData.get("bookingId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  // Rows are grouped by the ordinal in their field names, which the browser
  // renumbers as rows are added and removed.
  const grouped = new Map<number, Record<string, string>>();

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (!key.startsWith("travellers.")) continue;

    const [, rawIndex, ...rest] = key.split(".");
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || rest.length === 0) continue;

    const entry = grouped.get(index) ?? {};
    entry[rest.join(".")] = value;
    grouped.set(index, entry);
  }

  const fieldErrors: Record<string, string> = {};
  const travellers: TravellerEditInput[] = [];

  for (const [index, data] of [...grouped.entries()].sort(([a], [b]) => a - b)) {
    // A row the operator added and left empty is not a traveller. The id
    // alone does not count as content, or an existing row could never be
    // emptied out of the list.
    const hasContent = Object.entries(data).some(
      ([key, value]) => key !== "id" && value.trim() !== "",
    );
    if (!hasContent) continue;

    const result = travellerEditSchema.safeParse(data);

    if (!result.success) {
      Object.assign(
        fieldErrors,
        collectFieldErrors(result.error.issues, `travellers.${index}.`),
      );
      continue;
    }

    travellers.push(result.data);
  }

  if (travellers.length === 0 && Object.keys(fieldErrors).length === 0) {
    fieldErrors["travellers.0.firstName"] = "A booking needs at least one traveller.";
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  try {
    return saved(
      await updateBookingTravellers(
        { bookingId: parsed.data.bookingId, travellers, canEditSensitive },
        user.id,
      ),
      "Travellers",
    );
  } catch (error) {
    return failure(error, parsed.data.bookingId, "travellers");
  }
}
