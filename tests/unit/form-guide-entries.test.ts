// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { deriveFormGuideEntry } from "@/components/ui/form-guide";

/**
 * Turning a server error key into something an operator can act on.
 *
 * The derivation reads the rendered form rather than a key→label map, so the
 * markup in these cases mirrors what `Panel`, `Repeater` and `Field` actually
 * produce. If that markup changes, these should fail — that is the point.
 */

describe("deriveFormGuideEntry", () => {
  it("names the panel and the field", () => {
    document.body.innerHTML = `
      <section>
        <header><h2>Booking details</h2></header>
        <div>
          <label for="customerId">Customer<span aria-hidden="true">*</span></label>
          <select id="customerId"></select>
        </div>
      </section>
    `;

    expect(deriveFormGuideEntry("customerId", "Select a customer.")).toEqual({
      key: "customerId",
      message: "Select a customer.",
      where: "Booking details → Customer",
    });
  });

  it("names the repeater row from its legend and the key's ordinal", () => {
    document.body.innerHTML = `
      <section>
        <header><h2>Passenger information</h2></header>
        <fieldset>
          <legend class="sr-only">Passenger</legend>
          <label for="passengers.1.lastName">Last name<span aria-hidden="true">*</span></label>
          <input id="passengers.1.lastName" />
        </fieldset>
      </section>
    `;

    // Row 1 in the key is "Passenger 2" on screen — the ordinal is 0-based.
    expect(
      deriveFormGuideEntry("passengers.1.lastName", "Enter a last name."),
    ).toEqual({
      key: "passengers.1.lastName",
      message: "Enter a last name.",
      where: "Passenger information → Passenger 2 → Last name",
    });
  });

  it("strips the required marker from the label", () => {
    document.body.innerHTML = `
      <section>
        <header><h2>Cruise information</h2></header>
        <label for="cruiseLine">Cruise line<span aria-hidden="true">*</span></label>
        <input id="cruiseLine" />
      </section>
    `;

    expect(deriveFormGuideEntry("cruiseLine", "Enter a cruise line.").where).toBe(
      "Cruise information → Cruise line",
    );
  });

  it("copes with a field that has no label", () => {
    document.body.innerHTML = `
      <section>
        <header><h2>Accounting information</h2></header>
        <input id="baseFare" />
      </section>
    `;

    expect(deriveFormGuideEntry("baseFare", "Enter a valid amount.").where).toBe(
      "Accounting information",
    );
  });

  it("falls back to the key when nothing in the form matches", () => {
    // A server error for a field this form does not render. Showing an
    // awkward label beats dropping the error and explaining nothing.
    document.body.innerHTML = "";

    expect(
      deriveFormGuideEntry("passengers.0.lastName", "Enter a last name."),
    ).toEqual({
      key: "passengers.0.lastName",
      message: "Enter a last name.",
      where: "Passengers 1 → Last name",
    });
  });

  it("falls back for a plain key with no row", () => {
    document.body.innerHTML = "";

    expect(deriveFormGuideEntry("airlineConfirmation", "Required.").where).toBe(
      "Airline confirmation",
    );
  });
});
