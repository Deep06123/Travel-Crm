import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loggerFor } from "@/lib/logging/logger";
import { recordSignature } from "@/server/services/booking-signature-service";

const log = loggerFor("public-sign");

/** A signature is a write against one token; nothing here may be cached. */
export const dynamic = "force-dynamic";

/**
 * Accepts a customer's e-signature.
 *
 * Deliberately unauthenticated, and the only unauthenticated write in the
 * application. The authority is the token in the path — 256 bits of CSPRNG
 * output, stored only as its SHA-256, single-use, and expiring — so there is
 * no session to check and nothing a signed-in administrator could add.
 *
 * The token is in the path rather than the body, unlike the reference page
 * this was built from. A token in the body can disagree with the page that
 * rendered it, which makes "which booking did they actually see" unanswerable
 * at exactly the moment the evidence is needed.
 *
 * Everything in the body is a claim. The IP address, the user agent and the
 * signing time are taken from the request and the server clock, because those
 * are the three facts the evidence rests on and a client must not be able to
 * choose them.
 *
 * Failures are reported in general terms. A response that distinguished
 * "unknown token" from "already signed" would let anyone with a URL probe for
 * live links.
 */
const payloadSchema = z.object({
  signatureName: z.string().trim().min(1).max(200),
  signedPhone: z.string().trim().min(1).max(40),
  consentText: z.string().trim().min(1).max(2_000),
  device: z.string().trim().max(100).optional(),
  operatingSystem: z.string().trim().max(100).optional(),
  browser: z.string().trim().max(100).optional(),
  screenSize: z.string().trim().max(50).optional(),
  clientTimezone: z.string().trim().max(100).optional(),
});

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Worded for the customer reading it, and the same for every failure mode. */
const REFUSED =
  "This confirmation link is no longer valid. Please open the most recent email we sent you, or contact us for a new link.";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/public/sign/[token]">,
): Promise<Response> {
  const { token } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "We could not read your confirmation." },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = payloadSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Your confirmation was incomplete. Please try again." },
      { status: 400, headers: NO_STORE },
    );
  }

  const headerList = await headers();
  // The first entry is the client; the rest are the proxies it passed through.
  const ipAddress =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip") ||
    null;

  try {
    const outcome = await recordSignature({
      token: decodeURIComponent(token),
      claims: parsed.data,
      ipAddress,
      userAgent: headerList.get("user-agent"),
    });

    if (!outcome.ok) {
      log.info({ reason: outcome.reason }, "Signature refused");
      // 409: the request was well formed, the link's state does not allow it.
      return Response.json(
        { error: REFUSED },
        { status: 409, headers: NO_STORE },
      );
    }

    // So the agent watching the booking sees the signature without a hard
    // refresh. The customer is on a different page entirely.
    revalidatePath(`/admin/bookings/${outcome.bookingId}`);

    return Response.json({ ok: true }, { status: 200, headers: NO_STORE });
  } catch (error) {
    // The detail goes to the log. This response is readable by anyone holding
    // a URL, and a driver error names internals.
    log.error({ err: error }, "Signature could not be recorded");

    return Response.json(
      { error: "We could not record your confirmation. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
