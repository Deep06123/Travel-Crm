import { describe, expect, it } from "vitest";

import { retainedFormValues } from "@/lib/forms";

/**
 * What a rejected form is handed back.
 *
 * The case worth pinning down is React's own submission fields. They are not
 * form data, but they arrive in the same `FormData`, and sweeping the lot into
 * the returned state put the action's internal reference ids into client state
 * and into every logged action argument.
 */

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe("retainedFormValues", () => {
  it("keeps what the operator typed", () => {
    const values = retainedFormValues(
      form({ customerId: "cus_1", pnrLocator: "ABC123", total: "1029.97" }),
    );

    expect(values).toEqual({
      customerId: "cus_1",
      pnrLocator: "ABC123",
      total: "1029.97",
    });
  });

  it("drops React's own submission fields", () => {
    const values = retainedFormValues(
      form({
        customerId: "cus_1",
        "$ACTION_ID_6099557bd6d00d416777e48e429c63fe": "",
        $ACTION_KEY: "k51da1b412007c405190b599da5809d0e",
        "$ACTION_1:0": '{"id":"6099557b","bound":"$@1"}',
        "$ACTION_1:1": "[{}]",
      }),
    );

    expect(values).toEqual({ customerId: "cus_1" });
  });

  it("keeps a field that merely starts with a dollar sign", () => {
    // The filter is for React's `$ACTION…` names, not for every `$`.
    expect(retainedFormValues(form({ $rate: "1.27" }))).toEqual({
      $rate: "1.27",
    });
  });

  it("drops the fields the caller names", () => {
    const values = retainedFormValues(
      form({ email: "a@example.invalid", confirmedDuplicate: "on" }),
      { omit: ["confirmedDuplicate"] },
    );

    expect(values).toEqual({ email: "a@example.invalid" });
  });

  it("drops files, which no input can be repopulated from", () => {
    const data = form({ category: "PASSPORT" });
    data.append("file", new File(["scan"], "passport.pdf"));

    expect(retainedFormValues(data)).toEqual({ category: "PASSPORT" });
  });

  it("returns an empty object for a submission of nothing but plumbing", () => {
    expect(retainedFormValues(form({ $ACTION_KEY: "k1" }))).toEqual({});
  });
});
