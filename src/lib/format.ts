import { getEnv } from "@/lib/env";

/**
 * Display formatting.
 *
 * Dates render in the configured business timezone rather than the server's,
 * so a booking taken at 23:30 in New York does not appear on the following day
 * because the host happens to run UTC. Reports bucket on the same timezone.
 */

let cachedTimeZone: string | undefined;

function businessTimeZone(): string {
  if (cachedTimeZone) return cachedTimeZone;

  try {
    cachedTimeZone = getEnv().BUSINESS_TIMEZONE;
  } catch {
    // Client components have no access to server configuration.
    cachedTimeZone = "UTC";
  }

  return cachedTimeZone;
}

/** e.g. "15 Oct 2026". */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: businessTimeZone(),
  }).format(date);
}

/** e.g. "15 Oct 2026, 14:56". 24-hour, matching the reference CRM. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: businessTimeZone(),
  }).format(date);
}

/** Value for an `<input type="date">`, in the business timezone. */
export function toDateInputValue(
  value: Date | string | null | undefined,
): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  // en-CA gives ISO-ordered parts, which is exactly the input's format.
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: businessTimeZone(),
  }).format(date);
}

/** "3 days overdue" / "in 2 days" / "today". */
export function formatRelativeDays(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);

  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

/** Full name from its parts, skipping missing ones. */
export function fullName(
  parts: {
    firstName?: string | null;
    middleName?: string | null;
    lastName?: string | null;
  },
): string {
  return [parts.firstName, parts.middleName, parts.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}
