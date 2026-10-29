"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The "what still needs filling in" box.
 *
 * The booking forms run to roughly eighty fields across six panels, three of
 * which start collapsed. A rejected submission used to show red text beside
 * the offending field and nothing else, so a problem inside a collapsed panel
 * was invisible and one below the fold had to be hunted for. This names every
 * problem, says which section it is in, and jumps to it.
 *
 * Nothing here is a source of truth. The per-field errors and the panel
 * markers stay exactly as they were; this is an index to them, shown for a few
 * seconds and then out of the way.
 */

export interface FormGuideEntry {
  key: string;
  message: string;
  /** "Passenger information → Passenger 1 → Last name" */
  where: string;
}

/** How long the box stays before taking itself away. */
const DISMISS_AFTER_MS = 7_000;

function humaniseKeyPart(part: string | undefined): string {
  const spaced = (part ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  const words = spaced.split(" ").filter(Boolean);

  return words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : word.toLowerCase(),
    )
    .join(" ");
}

/**
 * Last-resort description, built from the key alone.
 *
 * Reached only when no control carries the key as its id — a server error for
 * a field the form does not render. Showing an awkward label beats dropping
 * the error, which would leave a rejected submission with no explanation.
 */
function prettifyKey(key: string): string {
  const [first, index, ...rest] = key.split(".");

  if (index !== undefined && /^\d+$/.test(index)) {
    const tail = rest.map(humaniseKeyPart).join(" → ") || humaniseKeyPart(first);
    return `${humaniseKeyPart(first)} ${Number(index) + 1} → ${tail}`;
  }

  return humaniseKeyPart(first);
}

/**
 * Describes one rejected field by reading the rendered form.
 *
 * Both booking forms pass the same string as a field's `id` and as its error
 * key, and `Field` renders `<label for={id}>`, so the label, the panel title
 * and the repeater row can all be read back from the DOM. That is deliberate:
 * a hand-written key→label map would be one more thing to keep in step with
 * eighty fields, and it would drift.
 */
export function deriveFormGuideEntry(
  key: string,
  message: string,
): FormGuideEntry {
  const control =
    typeof document === "undefined" ? null : document.getElementById(key);

  if (!control) {
    return { key, message, where: prettifyKey(key) };
  }

  // Matched on the `htmlFor` property rather than a `label[for="…"]`
  // selector. Field ids carry dots (`passengers.0.lastName`), which a
  // selector would need escaped, and `CSS.escape` is not present in every
  // environment this runs in. Comparing the property sidesteps both.
  //
  // `Label` renders the required marker as an aria-hidden "*" inside the
  // label, so it comes back in textContent and has to come off.
  const labelText = Array.from(document.getElementsByTagName("label"))
    .find((label) => label.htmlFor === key)
    ?.textContent?.trim()
    .replace(/\s*\*$/, "")
    .trim();

  const sectionText = control
    .closest("section")
    ?.querySelector("header h2")
    ?.textContent?.trim();

  // A repeater field is `passengers.0.lastName`. The ordinal comes from the
  // key; the noun comes from the fieldset's legend, so "Passenger", "Flight"
  // and "Guest" are never spelled out twice.
  const rowMatch = /^([A-Za-z]+)\.(\d+)\./.exec(key);
  const rowText = rowMatch
    ? `${
        control.closest("fieldset")?.querySelector("legend")?.textContent?.trim() ||
        humaniseKeyPart(rowMatch[1])
      } ${Number(rowMatch[2]) + 1}`
    : undefined;

  const parts = [sectionText, rowText, labelText].filter(
    (part): part is string => Boolean(part),
  );

  return {
    key,
    message,
    where: parts.length > 0 ? parts.join(" → ") : prettifyKey(key),
  };
}

export function deriveFormGuideEntries(
  fieldErrors: Record<string, string>,
): FormGuideEntry[] {
  return Object.entries(fieldErrors).map(([key, message]) =>
    deriveFormGuideEntry(key, message),
  );
}

/**
 * Brings a field into view, opening whatever is hiding it.
 *
 * A collapsed `Panel` keeps its children mounted but `hidden`, and a hidden
 * element cannot take focus — so every collapsed ancestor is opened first,
 * through its own toggle button, and the focus is left until React has
 * committed those state changes.
 */
function revealField(key: string): void {
  const control = document.getElementById(key);
  if (!control) return;

  // Only the panel's own header toggle, walking outwards. Querying the whole
  // section would also match a collapsed panel nested somewhere beside the
  // field, and open sections the operator never asked about.
  let section = control.closest("section");
  while (section) {
    const toggle = section.querySelector(
      ':scope > header button[aria-expanded="false"]',
    );
    if (toggle instanceof HTMLElement) toggle.click();
    section = section.parentElement?.closest("section") ?? null;
  }

  // After the commit: the panel is still `hidden` at this point in the click
  // handler, and focusing a hidden element silently does nothing.
  requestAnimationFrame(() => {
    control.scrollIntoView({ block: "center", behavior: "smooth" });
    (control as HTMLElement).focus({ preventScroll: true });
  });
}

export function FormGuide({
  fieldErrors,
}: {
  fieldErrors?: Record<string, string> | undefined;
}) {
  const entries = useMemo(
    () =>
      fieldErrors && Object.keys(fieldErrors).length > 0
        ? deriveFormGuideEntries(fieldErrors)
        : [],
    [fieldErrors],
  );

  const [dismissed, setDismissed] = useState(false);

  // Re-arm on each rejection, including an identical one: `useActionState`
  // hands back a fresh object every submission, so identity is the signal.
  // Adjusted during render rather than in an effect, so the box never paints
  // one frame in its dismissed state before coming back.
  const [seen, setSeen] = useState(fieldErrors);
  if (seen !== fieldErrors) {
    setSeen(fieldErrors);
    setDismissed(false);
  }

  const timer = useRef<number | null>(null);

  const stopTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const startTimer = () => {
    stopTimer();
    timer.current = window.setTimeout(
      () => setDismissed(true),
      DISMISS_AFTER_MS,
    );
  };

  useEffect(() => {
    if (entries.length === 0 || dismissed) return;

    const id = window.setTimeout(() => setDismissed(true), DISMISS_AFTER_MS);
    timer.current = id;

    return () => {
      window.clearTimeout(id);
      if (timer.current === id) timer.current = null;
    };
  }, [entries, dismissed]);

  if (entries.length === 0 || dismissed) return null;

  const count = entries.length;
  const heading = `${count} field${count === 1 ? "" : "s"} need${
    count === 1 ? "s" : ""
  } attention`;

  return (
    <section
      aria-label="Fields that need attention"
      // Not a live region: it holds buttons, and interactive content inside
      // one is announced badly. The count is announced separately below.
      className="fixed right-4 bottom-4 z-50 flex max-h-[60vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-line bg-white shadow-lg"
      onMouseEnter={stopTimer}
      onMouseLeave={startTimer}
      onFocusCapture={stopTimer}
      onBlurCapture={startTimer}
    >
      <p className="sr-only" role="status">
        {heading}
      </p>

      <div className="flex items-center justify-between gap-3 border-b border-line bg-status-danger-bg px-4 py-2.5 text-status-danger">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="rounded p-1 leading-none hover:bg-white/60"
        >
          ×
        </button>
      </div>

      <ul className="flex flex-col gap-1.5 overflow-y-auto p-2">
        {entries.map((entry) => (
          <li key={entry.key}>
            {/* `type="button"`: a bare button inside the form would submit it. */}
            <button
              type="button"
              onClick={() => revealField(entry.key)}
              className="w-full rounded-md border border-line px-3 py-2 text-left hover:bg-surface-muted"
            >
              <span className="block text-sm font-medium text-ink">
                {entry.where}
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                {entry.message}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
