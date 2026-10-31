/**
 * Timezones offered by the header clock.
 *
 * A short, curated list rather than the full IANA database: this is a glance
 * at what time it is where the customer or the supplier is, not a scheduling
 * control, and a two-hundred-entry select would make the common case slower
 * rather than faster. The Americas lead because that is where the agency and
 * most of its sailings are.
 *
 * These names are what `Intl.DateTimeFormat` takes for `timeZone`, so they are
 * resolved by the browser and need no data of their own.
 *
 * Nothing here affects how dates are stored or rendered elsewhere — booking
 * dates, payment timestamps and report buckets all still follow
 * `BUSINESS_TIMEZONE`; see `src/lib/format.ts`.
 */

export type TimeZoneOption = {
  /** IANA zone name, passed straight to `Intl.DateTimeFormat`. */
  value: string;
  label: string;
};

export const DEFAULT_TIME_ZONE = "America/New_York";

/** Where the chosen zone is remembered, per browser. */
export const TIME_ZONE_STORAGE_KEY = "travelcrm.headerTimeZone";

export const TIME_ZONE_GROUPS: { region: string; zones: TimeZoneOption[] }[] = [
  {
    region: "Americas",
    zones: [
      { value: "America/New_York", label: "New York (Eastern)" },
      { value: "America/Chicago", label: "Chicago (Central)" },
      { value: "America/Denver", label: "Denver (Mountain)" },
      { value: "America/Phoenix", label: "Phoenix (no DST)" },
      { value: "America/Los_Angeles", label: "Los Angeles (Pacific)" },
      { value: "America/Anchorage", label: "Anchorage (Alaska)" },
      { value: "Pacific/Honolulu", label: "Honolulu (Hawaii)" },
      { value: "America/Toronto", label: "Toronto" },
      { value: "America/Vancouver", label: "Vancouver" },
      { value: "America/Mexico_City", label: "Mexico City" },
      { value: "America/Bogota", label: "Bogotá" },
      { value: "America/Sao_Paulo", label: "São Paulo" },
      { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
    ],
  },
  {
    region: "Europe & Africa",
    zones: [
      { value: "Europe/London", label: "London" },
      { value: "Europe/Dublin", label: "Dublin" },
      { value: "Europe/Lisbon", label: "Lisbon" },
      { value: "Europe/Madrid", label: "Madrid" },
      { value: "Europe/Paris", label: "Paris" },
      { value: "Europe/Amsterdam", label: "Amsterdam" },
      { value: "Europe/Berlin", label: "Berlin" },
      { value: "Europe/Rome", label: "Rome" },
      { value: "Europe/Athens", label: "Athens" },
      { value: "Europe/Istanbul", label: "Istanbul" },
      { value: "Europe/Moscow", label: "Moscow" },
      { value: "Africa/Casablanca", label: "Casablanca" },
      { value: "Africa/Lagos", label: "Lagos" },
      { value: "Africa/Cairo", label: "Cairo" },
      { value: "Africa/Johannesburg", label: "Johannesburg" },
    ],
  },
  {
    region: "Asia & Pacific",
    zones: [
      { value: "Asia/Dubai", label: "Dubai" },
      { value: "Asia/Karachi", label: "Karachi" },
      { value: "Asia/Kolkata", label: "Kolkata" },
      { value: "Asia/Dhaka", label: "Dhaka" },
      { value: "Asia/Bangkok", label: "Bangkok" },
      { value: "Asia/Singapore", label: "Singapore" },
      { value: "Asia/Hong_Kong", label: "Hong Kong" },
      { value: "Asia/Shanghai", label: "Shanghai" },
      { value: "Asia/Tokyo", label: "Tokyo" },
      { value: "Asia/Seoul", label: "Seoul" },
      { value: "Australia/Perth", label: "Perth" },
      { value: "Australia/Sydney", label: "Sydney" },
      { value: "Pacific/Auckland", label: "Auckland" },
    ],
  },
  {
    region: "Other",
    zones: [{ value: "UTC", label: "UTC" }],
  },
];

const KNOWN = new Set(
  TIME_ZONE_GROUPS.flatMap((group) => group.zones.map((zone) => zone.value)),
);

/** True for a zone the picker offers — guards whatever was left in storage. */
export function isKnownTimeZone(value: string | null): value is string {
  return value !== null && KNOWN.has(value);
}
