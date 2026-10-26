import { describe, expect, it } from "vitest";

import { buildBookingWhere } from "@/server/services/booking-service";

/**
 * The two filters added for the booking list.
 *
 * `cardLast4` is the one worth asserting: the booking carries no card detail
 * at all, so it has to reach through to the payments attached to it. Written
 * against the booking itself it would silently match nothing, which reads as
 * "no such booking" rather than "this filter is broken".
 */

describe("buildBookingWhere", () => {
  it("filters by language", () => {
    expect(buildBookingWhere({ language: "es" })).toMatchObject({
      language: "es",
    });
  });

  it("matches the last four digits against the booking's payments", () => {
    const where = buildBookingWhere({ cardLast4: "4242" });

    expect(where.payments).toEqual({ some: { cardLast4: "4242" } });
    // Not on the booking: it holds no card detail, and never a full number.
    expect(where).not.toHaveProperty("cardLast4");
  });

  it("trims the digits, so a pasted value still matches", () => {
    expect(buildBookingWhere({ cardLast4: " 4242 " }).payments).toEqual({
      some: { cardLast4: "4242" },
    });
  });

  it("omits both when they are not supplied", () => {
    const where = buildBookingWhere({});

    expect(where).not.toHaveProperty("language");
    expect(where).not.toHaveProperty("payments");
  });

  it("combines them with the other filters rather than replacing them", () => {
    const where = buildBookingWhere({
      language: "fr",
      cardLast4: "1111",
      agentId: "agent-1",
    });

    expect(where.language).toBe("fr");
    expect(where.payments).toEqual({ some: { cardLast4: "1111" } });
    expect(where.assignedAgentId).toBe("agent-1");
  });
});
