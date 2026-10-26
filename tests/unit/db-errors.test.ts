import { describe, expect, it } from "vitest";

import { isDatabaseUnavailable } from "@/lib/db/errors";

/**
 * Classifying infrastructure failure.
 *
 * The distinction matters: an outage must surface as "temporarily unavailable"
 * while a genuine bug must keep throwing, so it is not silently swallowed and
 * mistaken for a transient blip.
 */

/** Shaped like the error Prisma throws when MySQL is unreachable. */
function prismaError(code: string, message = "Prisma failure"): Error {
  return Object.assign(new Error(message), { code });
}

describe("isDatabaseUnavailable", () => {
  it("recognises the unreachable-server code", () => {
    expect(isDatabaseUnavailable(prismaError("P1001"))).toBe(true);
  });

  it("recognises connection timeouts and pool exhaustion", () => {
    expect(isDatabaseUnavailable(prismaError("P1002"))).toBe(true);
    expect(isDatabaseUnavailable(prismaError("P1008"))).toBe(true);
    expect(isDatabaseUnavailable(prismaError("P1017"))).toBe(true);
    expect(isDatabaseUnavailable(prismaError("P2024"))).toBe(true);
  });

  it("recognises raw driver-level refusal", () => {
    expect(isDatabaseUnavailable(prismaError("ECONNREFUSED"))).toBe(true);
    expect(isDatabaseUnavailable(prismaError("ETIMEDOUT"))).toBe(true);
    expect(isDatabaseUnavailable(prismaError("ENOTFOUND"))).toBe(true);
  });

  it("recognises the message Prisma 7 produced during the outage", () => {
    // The exact wording seen in the dev log when prisma dev was not running.
    expect(
      isDatabaseUnavailable(
        new Error("Can't reach database server at 127.0.0.1:51214"),
      ),
    ).toBe(true);

    expect(
      isDatabaseUnavailable(new Error("DriverAdapterError: DatabaseNotReachable")),
    ).toBe(true);
  });

  it("does not treat a constraint violation as an outage", () => {
    // P2002 is a unique-constraint breach — a real, actionable error that must
    // keep propagating rather than being reported as a blip.
    expect(isDatabaseUnavailable(prismaError("P2002"))).toBe(false);
    expect(isDatabaseUnavailable(prismaError("P2003"))).toBe(false);
    expect(isDatabaseUnavailable(prismaError("P2025"))).toBe(false);
  });

  it("does not treat an ordinary bug as an outage", () => {
    expect(isDatabaseUnavailable(new TypeError("x is not a function"))).toBe(false);
    expect(isDatabaseUnavailable(new Error("Something went wrong"))).toBe(false);
  });

  it("handles non-error values without throwing", () => {
    expect(isDatabaseUnavailable(null)).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
    expect(isDatabaseUnavailable("P1001")).toBe(false);
    expect(isDatabaseUnavailable(42)).toBe(false);
    expect(isDatabaseUnavailable({})).toBe(false);
  });
});
