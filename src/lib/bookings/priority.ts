import { BookingPriority } from "@/generated/prisma/enums";

/**
 * Booking priority rules.
 *
 * Priority is no longer something an agent picks. It answers one question —
 * how soon does this booking travel — so that the high-priority queue orders
 * itself by what is closest to departure rather than by whoever remembered to
 * set a dropdown.
 *
 * Pure logic, free of database access and of the current time, so the
 * thresholds can be unit-tested exhaustively; the caller supplies `now`. The
 * booking service applies it on write.
 */

/** Days until travel at or below which a booking takes each priority. */
const THRESHOLD_DAYS: readonly { within: number; priority: BookingPriority }[] = [
  { within: 7, priority: BookingPriority.URGENT },
  { within: 30, priority: BookingPriority.HIGH },
  { within: 90, priority: BookingPriority.NORMAL },
];

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/**
 * Priority for a booking travelling on `travelStartDate`.
 *
 * A booking with no travel date recorded gets `NORMAL`: nothing is known about
 * how urgent it is, and sorting it to either extreme would be a guess. Travel
 * already in the past is `URGENT` on the same reasoning as travel tomorrow —
 * if it still needs attention, it needs it now.
 */
export function derivePriority(
  travelStartDate: Date | null | undefined,
  now: Date,
): BookingPriority {
  if (!travelStartDate) return BookingPriority.NORMAL;

  const days = Math.floor(
    (travelStartDate.getTime() - now.getTime()) / MS_PER_DAY,
  );

  for (const { within, priority } of THRESHOLD_DAYS) {
    if (days <= within) return priority;
  }

  return BookingPriority.LOW;
}
