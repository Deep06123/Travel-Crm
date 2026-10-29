/**
 * Form submission helpers shared by the server actions.
 */

/**
 * React's own fields in a server-action submission.
 *
 * A `<form action={fn}>` carries more than the operator typed: React appends
 * its own entries — `$ACTION_ID_…`, `$ACTION_KEY`, `$ACTION_1:0` and friends —
 * to tell the server which action to run and how its arguments were encoded.
 */
const REACT_INTERNAL_PREFIX = "$ACTION";

/**
 * The submitted values worth handing back to a rejected form.
 *
 * A rejected action returns these so the browser can re-render the form with
 * what the operator typed still in it. Three kinds of entry are left out:
 *
 *   * React's own plumbing, which is not form data at all. Echoing it put the
 *     action's internal reference ids into client state and into every logged
 *     action argument, where they were pure noise.
 *   * `File` entries, which have no string form to put back in an input — a
 *     browser will not let a file field be populated from script anyway.
 *   * Anything the caller names in `omit`: a field that must be re-decided
 *     rather than remembered, such as a duplicate-override checkbox.
 */
export function retainedFormValues(
  formData: FormData,
  options: { omit?: readonly string[] } = {},
): Record<string, string> {
  const omit = new Set(options.omit ?? []);
  const values: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (key.startsWith(REACT_INTERNAL_PREFIX)) continue;
    if (omit.has(key)) continue;

    values[key] = value;
  }

  return values;
}
