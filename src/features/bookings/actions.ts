"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/dal";
import {
  InvalidTransitionError,
  MissingEvidenceError,
  ReasonRequiredError,
} from "@/lib/bookings/status";
import { loggerFor } from "@/lib/logging/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { createFlightBooking } from "@/server/services/booking-service";
import { transitionBooking } from "@/server/services/booking-status-service";

import {
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

function collectFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
  prefix = "",
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of issues) {
    const field = `${prefix}${issue.path.join(".")}`;
    if (!fieldErrors[field]) fieldErrors[field] = issue.message;
  }

  return fieldErrors;
}

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }

  return values;
}

/**
 * Extracts repeated form groups such as `passengers.0.firstName`.
 *
 * Indices are collected from the submitted keys rather than assumed
 * contiguous, so removing the middle row of a repeater does not silently drop
 * every row after it.
 */
function extractGroup(
  formData: FormData,
  prefix: string,
): { index: number; data: Record<string, string> }[] {
  const byIndex = new Map<number, Record<string, string>>();

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (!key.startsWith(`${prefix}.`)) continue;

    const [, rawIndex, ...rest] = key.split(".");
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || rest.length === 0) continue;

    const entry = byIndex.get(index) ?? {};
    entry[rest.join(".")] = value;
    byIndex.set(index, entry);
  }

  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, data]) => ({ index, data }));
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

  if (!parsed.success) {
    return {
      fieldErrors: collectFieldErrors(parsed.error.issues),
      values: formValues(formData),
    };
  }

  const booking = parsed.data;

  // --- Passengers ---------------------------------------------------------
  const passengerGroups = extractGroup(formData, "passengers");
  const passengers: PassengerInput[] = [];
  const fieldErrors: Record<string, string> = {};

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

  if (passengers.length === 0) {
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

  revalidatePath("/admin/bookings");
  redirect(`/admin/bookings/${created.id}`);
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
