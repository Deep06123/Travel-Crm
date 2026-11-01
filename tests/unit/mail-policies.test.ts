import { describe, expect, it } from "vitest";

import {
  defaultPolicyLines,
  policySectionHeading,
  renderPolicySections,
} from "@/lib/mail/policies";

/**
 * The terms at the foot of every customer email, and the operator's power to
 * rewrite them.
 *
 * Worth testing directly: these are the sentences a customer is held to over a
 * change fee months later, and the failure mode that matters is an edit the
 * business made in Settings not reaching the email.
 */

const BASE = {
  document: "authorization" as const,
  isCruise: false,
  supportPhone: null,
};

describe("renderPolicySections", () => {
  it("prints the built-in wording when nothing is overridden", () => {
    const html = renderPolicySections({ ...BASE, overrides: {} });

    expect(html).toContain("Booking Policy");
    expect(html).toContain("Name changes are not permitted under any circumstances.");
  });

  it("replaces an overridden section and leaves the others alone", () => {
    const html = renderPolicySections({
      ...BASE,
      overrides: { changeRules: ["Changes cost a flat $75."] },
    });

    expect(html).toContain("Changes cost a flat $75.");
    expect(html).not.toContain("Name changes are not permitted under any circumstances.");
    // Untouched sections keep their defaults rather than disappearing with it.
    expect(html).toContain(
      "Cards will be charged only after we receive your authorization from the cardholder.",
    );
  });

  it("escapes the operator's wording", () => {
    const html = renderPolicySections({
      ...BASE,
      overrides: { changeRules: ['Fees apply <script>alert("x")</script>'] },
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops a section the operator deliberately emptied", () => {
    const html = renderPolicySections({
      ...BASE,
      overrides: { changeRules: [] },
    });

    expect(html).not.toContain("Change Rules");
    expect(html).toContain("Booking Policy");
  });

  it("titles the travel rules by product", () => {
    expect(policySectionHeading("travelRules", true)).toBe(
      "Cruise Rules and Restrictions",
    );
    expect(policySectionHeading("travelRules", false)).toBe(
      "Flight Rules and Restrictions",
    );

    expect(
      renderPolicySections({ ...BASE, isCruise: true, overrides: {} }),
    ).toContain("Cruise Rules and Restrictions");
  });

  it("keeps the overridden wording identical in both messages", () => {
    const overrides = { bookingPolicy: ["Your card is charged on authorization."] };

    const authorization = renderPolicySections({ ...BASE, overrides });
    const eticket = renderPolicySections({
      ...BASE,
      document: "eticket",
      overrides,
    });

    // The tense-switching the defaults do is lost once a section is rewritten,
    // which is the trade-off the settings page warns about. Asserted so the
    // behaviour is deliberate rather than discovered in a customer's inbox.
    expect(authorization).toContain("Your card is charged on authorization.");
    expect(eticket).toContain("Your card is charged on authorization.");
  });

  it("still varies the default booking policy by message", () => {
    const authorization = defaultPolicyLines("bookingPolicy", "authorization");
    const eticket = defaultPolicyLines("bookingPolicy", "eticket");

    expect(authorization).not.toEqual(eticket);
    expect(authorization[0]).toContain("will be charged");
    expect(eticket[0]).toContain("was charged");
  });
});
