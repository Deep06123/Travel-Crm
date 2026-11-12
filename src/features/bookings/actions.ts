"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/dal";
import {
  InvalidTransitionError,
  LIST_EDITABLE_STATUSES,
  MissingEvidenceError,
  ReasonRequiredError,
} from "@/lib/bookings/status";
import { loggerFor } from "@/lib/logging/logger";
import { retainedFormValues } from "@/lib/forms";
import { PERMISSIONS } from "@/lib/permissions";
import { isDatabaseUnavailable, DATABASE_UNAVAILABLE_MESSAGE } from "@/lib/db/errors";
import {
  BookingNotDeletableError,
  BookingNotFoundError,
  createCruiseBooking,
  createFlightBooking,
  deleteBooking,
  getBookingCurrency,
  updateBookingFinancials,
  updateTicketingDetails,
} from "@/server/services/booking-service";
import { transitionBooking } from "@/server/services/booking-status-service";

import {
  collectFieldErrors,
  extractGroup,
  parseChargeSplits,
} from "./charge-split-input";
import {
  attachBookingDocuments,
  selectedDocuments,
  validateBookingDocuments,
} from "./document-attachments";
import {
  BOOKING_DOCUMENTS_FIELD,
  DOCUMENTS_FAILED_PARAM,
} from "./document-attachments.constants";

import {
  cruiseBookingSchema,
  cruiseGuestSchema,
  type CruiseGuestInput,
} from "./cruise-schemas";
import {
  bookingDeleteSchema,
  bookingFinancialsSchema,
  ticketingDetailsSchema,
  flightBookingSchema,
  flightSegmentSchema,
  moneyFieldToMinor,
  passengerSchema,
  statusChangeSchema,
  type FlightSegmentInput,
  type PassengerInput,
} from "./schemas";

const log = loggerFor("booking-actions");

export interface BookingFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

function formValues(formData: FormData): Record<string, string> {
  return retainedFormValues(formData);
}

export async function createFlightBookingAction(
  _previous: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_CREATE);

  const base = Object.fromEntries(
    [...formData.entries()].filter(
      ([key]) => !key.includes(".") && typeof formData.get(key) === "string",
    ),
  );

  const parsed = flightBookingSchema.safeParse(base);
  const baseFieldErrors = parsed.success ? {} : collectFieldErrors(parsed.error.issues);

  // --- Passengers ---------------------------------------------------------
  const passengerGroups = extractGroup(formData, "passengers");
  const passengers: PassengerInput[] = [];
  const fieldErrors: Record<string, string> = { ...baseFieldErrors };

  for (const group of passengerGroups) {
    // Skip a row the operator added and left entirely blank.
    const hasContent = Object.values(group.data).some(
      (value) => value.trim() !== "",
    );
    if (!hasContent) continue;

    const result = passengerSchema.safeParse(group.data);

    if (!result.success) {
      Object.assign(
        fieldErrors,
        collectFieldErrors(result.error.issues, `passengers.${group.index}.`),
      );
      continue;
    }

    passengers.push(result.data);
  }

  if (
    passengers.length === 0 &&
    !Object.keys(fieldErrors).some((key) => key.startsWith("passengers."))
  ) {
    fieldErrors["passengers.0.firstName"] = "Add at least one passenger.";
  }

  // --- Segments -----------------------------------------------------------
  const segmentGroups = extractGroup(formData, "segments");
  const segments: FlightSegmentInput[] = [];

  for (const group of segmentGroups) {
    const hasContent = Object.values(group.data).some(
      (value) => value.trim() !== "",
    );
    if (!hasContent) continue;

    const result = flightSegmentSchema.safeParse(group.data);

    if (!result.success) {
      Object.assign(
        fieldErrors,
        collectFieldErrors(result.error.issues, `segments.${group.index}.`),
      );
      continue;
    }

    segments.push(result.data);
  }

  if (!parsed.success) {
    return { fieldErrors, values: formValues(formData) };
  }

  const booking = parsed.data;

  // --- Money ---------------------------------------------------------------
  // Converted against the chosen currency, which fixes the number of minor
  // units: 1.234 is valid in KWD and invalid in USD.
  const moneyFields = [
    ["baseFare", booking.baseFare],
    ["taxesFees", booking.taxesFees],
    ["total", booking.total],
    ["supplierCost", booking.supplierCost],
    ["grossMco", booking.grossMco],
    ["netMco", booking.netMco],
  ] as const;

  const amounts: Record<string, number> = {};

  for (const [field, raw] of moneyFields) {
    const result = moneyFieldToMinor(raw, booking.currency, field);
    if (!result.ok) {
      fieldErrors[result.field] = result.message;
      continue;
    }
    amounts[field] = result.minor;
  }

  // Checked before the booking is written: once it exists there is no form to
  // send the operator back to, so a rejectable file has to be caught here.
  const documents = selectedDocuments(formData);
  const documentProblem = await validateBookingDocuments(documents);

  if (documentProblem) {
    fieldErrors[BOOKING_DOCUMENTS_FIELD] = documentProblem;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: formValues(formData) };
  }

  let created: { id: string; bookingNumber: string };

  try {
    created = await createFlightBooking(
      {
        booking,
        amounts: {
          baseFareMinor: amounts["baseFare"] ?? 0,
          taxesFeesMinor: amounts["taxesFees"] ?? 0,
          totalMinor: amounts["total"] ?? 0,
          supplierCostMinor: amounts["supplierCost"] ?? 0,
          grossMcoMinor: amounts["grossMco"] ?? 0,
          netMcoMinor: amounts["netMco"] ?? 0,
        },
        passengers,
        segments,
      },
      user.id,
    );
  } catch (error) {
    log.error({ err: error }, "Failed to create flight booking");
    return {
      error: "The booking could not be saved. Try again.",
      values: formValues(formData),
    };
  }

  // After the booking, because a document has to hang off one. A file that
  // fails here cannot un-create the booking, so the count travels to the
  // booking page rather than being swallowed.
  const failed = await attachBookingDocuments(
    formData,
    documents,
    created.id,
    user.id,
  );

  revalidatePath("/admin/bookings");
  redirect(
    failed > 0
      ? `/admin/bookings/${created.id}?${DOCUMENTS_FAILED_PARAM}=${failed}`
      : `/admin/bookings/${created.id}`,
  );
}

export interface StatusChangeState {
  error?: string;
  success?: string;
}

export async function changeBookingStatusAction(
  _previous: StatusChangeState,
  formData: FormData,
): Promise<StatusChangeState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_CHANGE_STATUS);

  const parsed = statusChangeSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const result = await transitionBooking({
      bookingId: parsed.data.bookingId,
      toStatus: parsed.data.toStatus,
      actorId: user.id,
      reason: parsed.data.reason,
    });

    revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
    revalidatePath("/admin/bookings");

    return {
      success: `Status changed from ${result.fromStatus} to ${result.toStatus}.`,
    };
  } catch (error) {
    // These three carry a message written for the operator, so they are shown
    // as-is. Anything else is logged and reported generically.
    if (
      error instanceof InvalidTransitionError ||
      error instanceof MissingEvidenceError ||
      error instanceof ReasonRequiredError
    ) {
      return { error: error.message };
    }

    log.error(
      { err: error, bookingId: parsed.data.bookingId },
      "Failed to change booking status",
    );
    return { error: "The status could not be changed. Try again." };
  }
}

const listStatusSchema = z.object({
  bookingId: z.string().trim().min(1),
  // The same set the list draws its menu from, so the door the action opens
  // and the door the UI offers cannot drift apart.
  toStatus: z.enum(LIST_EDITABLE_STATUSES),
});

export interface ListStatusState {
  error?: string;
}

/**
 * Moves a booking between Pending and Confirmed from the list.
 *
 * A narrower door than `changeBookingStatusAction`, not a looser one. It
 * accepts only the two statuses the list offers, which are precisely the two
 * that need no written reason — cancelling and sending back for review do, and
 * a one-click control in a table row is the wrong place to be asked for one.
 * Those stay on the booking page where there is room to explain.
 *
 * Everything else is unchanged: the same permission, the same
 * `transitionBooking`, the same transition matrix and evidence checks. So
 * Confirmed does not move back to Pending here, and a booking without an
 * airline confirmation reference and a passenger cannot be confirmed — the
 * refusal comes back as the service wrote it, and the operator is told why
 * rather than watching a badge silently not change.
 */
export async function setListBookingStatusAction(
  _previous: ListStatusState,
  formData: FormData,
): Promise<ListStatusState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_CHANGE_STATUS);

  const parsed = listStatusSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { error: "That status cannot be set from the list." };
  }

  try {
    await transitionBooking({
      bookingId: parsed.data.bookingId,
      toStatus: parsed.data.toStatus,
      actorId: user.id,
    });
  } catch (error) {
    if (
      error instanceof InvalidTransitionError ||
      error instanceof MissingEvidenceError ||
      error instanceof ReasonRequiredError
    ) {
      return { error: error.message };
    }

    if (isDatabaseUnavailable(error)) {
      log.error({ err: error }, "List status change failed: database unreachable");
      return { error: DATABASE_UNAVAILABLE_MESSAGE };
    }

    log.error(
      { err: error, bookingId: parsed.data.bookingId },
      "Failed to change booking status from the list",
    );
    return { error: "The status could not be changed. Try again." };
  }

  // Both, as the booking page renders the same status: leaving its cache alone
  // would show the old badge to anyone who opened the booking next.
  revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
  revalidatePath("/admin/bookings");

  return {};
}

export async function createCruiseBookingAction(
  _previous: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_CREATE);

  const base = Object.fromEntries(
    [...formData.entries()].filter(
      ([key]) => !key.includes(".") && typeof formData.get(key) === "string",
    ),
  );

  const parsed = cruiseBookingSchema.safeParse(base);
  const baseFieldErrors = parsed.success ? {} : collectFieldErrors(parsed.error.issues);
  const fieldErrors: Record<string, string> = { ...baseFieldErrors };

  // --- Guests ---------------------------------------------------------------
  const guests: CruiseGuestInput[] = [];

  for (const group of extractGroup(formData, "guests")) {
    const hasContent = Object.values(group.data).some((value) => value.trim() !== "");
    if (!hasContent) continue;

    const result = cruiseGuestSchema.safeParse(group.data);

    if (!result.success) {
      Object.assign(
        fieldErrors,
        collectFieldErrors(result.error.issues, `guests.${group.index}.`),
      );
      continue;
    }

    guests.push(result.data);
  }

  if (
    guests.length === 0 &&
    !Object.keys(fieldErrors).some((key) => key.startsWith("guests."))
  ) {
    fieldErrors["guests.0.firstName"] = "Add at least one guest.";
  }

  if (!parsed.success) {
    return { fieldErrors, values: formValues(formData) };
  }

  const booking = parsed.data;

  // --- Money ---------------------------------------------------------------
  const moneyFields = [
    ["baseFare", booking.baseFare],
    ["taxesFees", booking.taxesFees],
    ["total", booking.total],
    ["supplierCost", booking.supplierCost],
    ["grossMco", booking.grossMco],
    ["netMco", booking.netMco],
  ] as const;

  const amounts: Record<string, number> = {};

  for (const [field, raw] of moneyFields) {
    const result = moneyFieldToMinor(raw, booking.currency, field);
    if (!result.ok) {
      fieldErrors[result.field] = result.message;
      continue;
    }
    amounts[field] = result.minor;
  }

  // Needs the amounts, so it runs after them and before the error gate below.
  const splits = parseChargeSplits(
    formData,
    {
      currency: booking.currency,
      splitCharges: booking.splitCharges,
      totalMinor: amounts["total"] ?? 0,
      hasTotal: (booking.total ?? "").trim() !== "",
    },
    fieldErrors,
  );

  // Checked before the booking is written: once it exists there is no form to
  // send the operator back to, so a rejectable file has to be caught here.
  const documents = selectedDocuments(formData);
  const documentProblem = await validateBookingDocuments(documents);

  if (documentProblem) {
    fieldErrors[BOOKING_DOCUMENTS_FIELD] = documentProblem;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: formValues(formData) };
  }

  let created: { id: string; bookingNumber: string };

  try {
    created = await createCruiseBooking(
      {
        booking,
        splits,
        amounts: {
          baseFareMinor: amounts["baseFare"] ?? 0,
          taxesFeesMinor: amounts["taxesFees"] ?? 0,
          totalMinor: amounts["total"] ?? 0,
          supplierCostMinor: amounts["supplierCost"] ?? 0,
          grossMcoMinor: amounts["grossMco"] ?? 0,
          netMcoMinor: amounts["netMco"] ?? 0,
        },
        guests,
      },
      user.id,
    );
  } catch (error) {
    log.error({ err: error }, "Failed to create cruise booking");
    return {
      error: "The booking could not be saved. Try again.",
      values: formValues(formData),
    };
  }

  // After the booking, because a document has to hang off one. A file that
  // fails here cannot un-create the booking, so the count travels to the
  // booking page rather than being swallowed.
  const failed = await attachBookingDocuments(
    formData,
    documents,
    created.id,
    user.id,
  );

  revalidatePath("/admin/bookings");
  redirect(
    failed > 0
      ? `/admin/bookings/${created.id}?${DOCUMENTS_FAILED_PARAM}=${failed}`
      : `/admin/bookings/${created.id}`,
  );
}

export interface BookingDeleteState {
  error?: string;
}

/**
 * Deletes a booking that was created in error.
 *
 * There is no success state: on success the page the form lives on no longer
 * has a booking to show, so the action redirects to the list. Only failures
 * come back to the form.
 */
export async function deleteBookingAction(
  _previous: BookingDeleteState,
  formData: FormData,
): Promise<BookingDeleteState> {
  // Its own capability, not `booking.update`. Editing a booking and erasing
  // one are not the same trust.
  const user = await requirePermission(PERMISSIONS.BOOKING_DELETE);

  const parsed = bookingDeleteSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await deleteBooking({
      bookingId: parsed.data.bookingId,
      actorId: user.id,
      reason: parsed.data.reason,
      confirmation: parsed.data.confirmation,
    });
  } catch (error) {
    // A refusal the operator can act on, shown as written.
    if (error instanceof BookingNotDeletableError) {
      return { error: error.message };
    }

    if (isDatabaseUnavailable(error)) {
      log.error({ err: error }, "Delete booking failed: database unreachable");
      return { error: DATABASE_UNAVAILABLE_MESSAGE };
    }

    log.error(
      { err: error, bookingId: parsed.data.bookingId },
      "Failed to delete booking",
    );
    return { error: "The booking could not be deleted. Try again." };
  }

  // Outside the try: `redirect` works by throwing, and catching it here would
  // report the deletion as a failure.
  revalidatePath("/admin/bookings");
  redirect("/admin/bookings");
}

export interface BookingFinancialsState {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
  /** What was submitted, so a rejected edit comes back as it was typed. */
  values?: Record<string, string>;
}

/**
 * Corrects the money on an existing booking.
 *
 * `booking.update` rather than a new capability: this is editing booking
 * details, which that permission already describes, and inventing a second one
 * for the same act would leave two things to keep in step.
 */
export async function updateBookingFinancialsAction(
  _previous: BookingFinancialsState,
  formData: FormData,
): Promise<BookingFinancialsState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_UPDATE);

  const parsed = bookingFinancialsSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const booking = await getBookingCurrency(parsed.data.bookingId);
  if (!booking) return { error: "That booking no longer exists." };

  // Parsed against the booking's own currency: 1.234 is valid in KWD and not
  // in USD, so the precision check cannot be made without it.
  const moneyFields = [
    ["baseFare", parsed.data.baseFare],
    ["taxesFees", parsed.data.taxesFees],
    ["total", parsed.data.total],
    ["supplierCost", parsed.data.supplierCost],
    ["grossMco", parsed.data.grossMco],
    ["netMco", parsed.data.netMco],
  ] as const;

  const fieldErrors: Record<string, string> = {};
  const amounts: Record<string, number> = {};

  for (const [field, raw] of moneyFields) {
    const result = moneyFieldToMinor(raw, booking.currency, field);
    if (!result.ok) {
      fieldErrors[result.field] = result.message;
      continue;
    }
    amounts[field] = result.minor;
  }

  const splits = parseChargeSplits(
    formData,
    {
      currency: booking.currency,
      splitCharges: parsed.data.splitCharges,
      totalMinor: amounts["total"] ?? 0,
      hasTotal: (parsed.data.total ?? "").trim() !== "",
    },
    fieldErrors,
  );

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: formValues(formData) };
  }

  try {
    await updateBookingFinancials({
      bookingId: parsed.data.bookingId,
      actorId: user.id,
      amounts: {
        baseFareMinor: amounts["baseFare"] ?? 0,
        taxesFeesMinor: amounts["taxesFees"] ?? 0,
        totalMinor: amounts["total"] ?? 0,
        supplierCostMinor: amounts["supplierCost"] ?? 0,
        grossMcoMinor: amounts["grossMco"] ?? 0,
        netMcoMinor: amounts["netMco"] ?? 0,
      },
      splitCharges: parsed.data.splitCharges,
      splits,
    });
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return { error: "That booking no longer exists." };
    }

    if (isDatabaseUnavailable(error)) {
      log.error({ err: error }, "Update financials failed: database unreachable");
      return { error: DATABASE_UNAVAILABLE_MESSAGE };
    }

    log.error(
      { err: error, bookingId: parsed.data.bookingId },
      "Failed to update booking financials",
    );
    return { error: "The amounts could not be saved. Try again." };
  }

  revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
  return { success: "Amounts updated." };
}

export interface TicketingDetailsState {
  error?: string;
  success?: string;
}

/** Records the airline confirmation and supplier reference after creation. */
export async function updateTicketingDetailsAction(
  _previous: TicketingDetailsState,
  formData: FormData,
): Promise<TicketingDetailsState> {
  const user = await requirePermission(PERMISSIONS.BOOKING_UPDATE);

  const parsed = ticketingDetailsSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await updateTicketingDetails({
      bookingId: parsed.data.bookingId,
      actorId: user.id,
      airlineConfirmation: parsed.data.airlineConfirmation ?? null,
      ticketingReference: parsed.data.ticketingReference ?? null,
    });
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return { error: "That booking no longer exists." };
    }

    if (isDatabaseUnavailable(error)) {
      log.error({ err: error }, "Update ticketing refs failed: database unreachable");
      return { error: DATABASE_UNAVAILABLE_MESSAGE };
    }

    log.error(
      { err: error, bookingId: parsed.data.bookingId },
      "Failed to update ticketing references",
    );
    return { error: "The references could not be saved. Try again." };
  }

  revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
  return { success: "References updated." };
}
