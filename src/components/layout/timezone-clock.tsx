"use client";

import { Clock } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  DEFAULT_TIME_ZONE,
  TIME_ZONE_GROUPS,
  TIME_ZONE_STORAGE_KEY,
  isKnownTimeZone,
} from "@/lib/geo/timezones";

/**
 * `localStorage` as an external store, so the select reads from it rather than
 * mirroring it in component state.
 *
 * `useSyncExternalStore` is what makes the hydration safe: React takes the
 * server snapshot for the first render, matching the markup the server sent,
 * then re-reads from the browser. Copying the stored zone into state inside an
 * effect would do the same thing a render later, and with a cascading render.
 *
 * The `storage` event only fires in *other* tabs, so a change here has to tell
 * this tab's subscribers itself.
 */
const subscribers = new Set<() => void>();

function subscribe(onStoreChange: () => void) {
  subscribers.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);

  return () => {
    subscribers.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/** Returns a plain string, so repeat reads compare equal and never re-loop. */
function readZone(): string {
  const stored = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY);
  return isKnownTimeZone(stored) ? stored : DEFAULT_TIME_ZONE;
}

function writeZone(zone: string) {
  window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, zone);
  for (const notify of subscribers) notify();
}

/**
 * The current time in a zone the operator picks, in the middle of the header.
 *
 * Agents take calls from customers and suppliers in other zones all day; this
 * answers "is it a reasonable hour to ring them back" without leaving the
 * page. It is a readout only — the booking dates, payment timestamps and
 * report buckets on the page below are unaffected and still render in
 * `BUSINESS_TIMEZONE` (see `src/lib/format.ts`).
 *
 * The choice lives in `localStorage` rather than a cookie or the database: it
 * is a per-browser convenience with nothing to audit, and keeping it off the
 * request means no server render depends on it.
 *
 * Both the zone and the time are therefore unknown during the server render,
 * and reading either one while rendering would be a hydration mismatch — the
 * server has no `localStorage` and its clock ticks past between the two
 * renders regardless. So the first paint is deliberately the default zone with
 * no time, and both are filled in from an effect once mounted.
 */
export function TimeZoneClock() {
  const zone = useSyncExternalStore(subscribe, readZone, () => DEFAULT_TIME_ZONE);
  const [time, setTime] = useState("");

  useEffect(() => {
    // Scheduled on the minute rather than polled every second. The display only
    // changes once a minute, so a per-second timer did fifty-nine wakeups that
    // could not change anything — on every page, for as long as the tab was
    // open. Each tick re-aims at the next boundary, which also absorbs a
    // machine that slept or a timer the browser throttled.
    let timer = 0;

    const schedule = () => {
      setTime(formatTime(zone));
      const now = new Date();
      const untilNextMinute =
        60_000 - (now.getSeconds() * 1_000 + now.getMilliseconds());
      timer = window.setTimeout(schedule, untilNextMinute + 50);
    };

    schedule();

    // A background tab's timers are throttled, so the clock is also re-read
    // when the tab comes back rather than waiting out a stale interval.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      schedule();
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [zone]);

  return (
    <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 md:flex">
      <Clock className="size-4 shrink-0 text-ink-subtle" aria-hidden />

      <label htmlFor="headerTimeZone" className="sr-only">
        Timezone
      </label>
      <select
        id="headerTimeZone"
        className="max-w-[12rem] cursor-pointer truncate rounded-md border border-transparent bg-transparent py-1 pr-1 text-sm text-ink-muted hover:border-line-strong hover:text-ink focus:border-navy-500"
        value={zone}
        onChange={(event) => writeZone(event.target.value)}
      >
        {TIME_ZONE_GROUPS.map((group) => (
          <optgroup key={group.region} label={group.region}>
            {group.zones.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Reserve the width before the first tick so the select does not shift. */}
      <span className="min-w-[5.5rem] text-sm font-medium tabular-nums text-ink">
        {time}
      </span>
    </div>
  );
}

/** e.g. "14:56 EDT". 24-hour, matching the rest of the application. */
function formatTime(timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
    timeZone,
  }).format(new Date());
}
