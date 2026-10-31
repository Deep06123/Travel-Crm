import type { Metadata } from "next";

import { SignatureForm } from "@/features/signature/signature-form";
import { formatMoney } from "@/lib/financial/money";
import { findSignatureByToken } from "@/server/services/booking-signature-service";

export const metadata: Metadata = {
  title: "Confirm your booking",
  robots: { index: false, follow: false },
};

/**
 * Nothing here may be cached or prerendered: the page is rendered for exactly
 * one token, it mutates the row's VIEWED state, and a cached copy would show
 * one customer's booking to the next person who followed a link.
 */
export const dynamic = "force-dynamic";

/** A link that no longer works, worded for the person holding it. */
const REASONS = {
  unknown: {
    title: "This link is not valid",
    body: "Check that you opened the most recent email we sent you. If you have been sent more than one, only the latest one works.",
  },
  expired: {
    title: "This link has expired",
    body: "For security, a confirmation link stops working after a while. Contact us and we will send you a new one.",
  },
  revoked: {
    title: "This link has been replaced",
    body: "We sent you a newer confirmation email. Please open the most recent one instead.",
  },
  signed: {
    title: "This booking is already confirmed",
    body: "Thank you — we have your signature on file and nothing further is needed. Your tickets will follow by email.",
  },
} as const;

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-[650px] px-4 py-16">
      <div className="rounded-xl bg-white p-8 shadow-[0_5px_25px_#00000012]">
        <h1 className="mb-3 text-xl font-semibold text-[#173b70]">{title}</h1>
        <p className="text-sm leading-relaxed text-[#555]">{body}</p>
      </div>
    </main>
  );
}

/**
 * The page a customer signs from.
 *
 * Reachable by anyone holding the token, so the token *is* the authorization.
 * Two rules follow from that and both are load-bearing:
 *
 * Only this booking's own details are shown, and only the ones a customer
 * already knows — their name, their email, the reference and the total. No
 * passenger passport data, no supplier cost, no internal notes.
 *
 * A link that does not resolve says why in general terms and shows nothing
 * else. A wrong or expired token must not be able to confirm that a booking
 * exists, let alone whose it is.
 */
export default async function SignBookingPage({
  params,
}: PageProps<"/sign/[token]">) {
  const { token } = await params;
  const lookup = await findSignatureByToken(decodeURIComponent(token));

  if (!lookup.ok) {
    const reason = REASONS[lookup.reason];
    return <Notice title={reason.title} body={reason.body} />;
  }

  const { booking } = lookup;

  return (
    <main className="mx-auto max-w-[650px] px-4 py-8">
      <div className="rounded-xl bg-white p-6 shadow-[0_5px_25px_#00000012] sm:p-8">
        <h1 className="mb-2 text-2xl font-semibold text-[#173b70]">
          Booking Confirmation &amp; E-Signature
        </h1>
        <p className="mb-5 text-sm text-[#555]">
          Please review your booking details and confirm your electronic
          signature.
        </p>

        <section className="mb-5 rounded-lg bg-[#f5f7fb] p-4">
          <h2 className="mb-3 text-base font-semibold text-[#173b70]">
            Booking Details
          </h2>
          <dl className="space-y-2 text-sm">
            <Row label="Booking ID" value={booking.bookingNumber} />
            <Row label="Customer Name" value={booking.customerName} />
            <Row label="Email" value={booking.customerEmail ?? "—"} />
            <Row
              label="Service"
              value={
                booking.product === "CRUISE"
                  ? "Cruise Booking Confirmation"
                  : "Flight Booking Confirmation"
              }
            />
            <Row
              label="Total"
              value={formatMoney(booking.totalMinor, booking.currency)}
            />
          </dl>
        </section>

        <SignatureForm
          token={token}
          customerName={booking.customerName}
          contactPhone={booking.contactPhone ?? ""}
        />
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="font-semibold text-[#444]">{label}</dt>
      <dd className="break-words text-right text-[#252525]">{value}</dd>
    </div>
  );
}
