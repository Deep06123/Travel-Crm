"use client";

import { useState } from "react";

/**
 * The consent recorded against the signature.
 *
 * No longer displayed on the page — the contact number, the security table and
 * this sentence were all taken off it — but still submitted and stored, so the
 * signed record and the confirmation PDF carry the wording the authorization
 * rests on. Note that it is now recorded rather than agreed to on screen: the
 * customer's act of consent is pressing "Sign & Confirm Booking".
 */
export const CONSENT_TEXT =
  "I confirm that I have reviewed the booking details, authorize the electronic " +
  "signature displayed above, and agree to the recording of my confirmation time, " +
  "IP address, device and approximate location for booking security.";

/**
 * What the browser can say about itself.
 *
 * Deliberately coarse. `navigator.userAgent` is a self-report that any client
 * can rewrite, and modern browsers round or freeze most of it anyway — this is
 * corroboration for the address the server observed, not a device identity.
 * Read during render rather than in an effect, which is safe because the
 * component only mounts in the browser.
 */
function describeClient() {
  if (typeof navigator === "undefined") {
    return {
      device: "",
      operatingSystem: "",
      browser: "",
      screenSize: "",
      clientTimezone: "",
    };
  }

  const ua = navigator.userAgent;

  // Ordered so the narrower match wins: every Chrome user agent also contains
  // "Safari", and Edge's contains both.
  const device = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android device"
        : /Windows/i.test(ua)
          ? "Windows PC"
          : /Macintosh/i.test(ua)
            ? "Mac computer"
            : /Linux/i.test(ua)
              ? "Linux device"
              : "Unknown device";

  const browser = /Edg\//.test(ua)
    ? "Microsoft Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Google Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Unknown browser";

  return {
    device,
    browser,
    operatingSystem:
      (navigator as { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ??
      navigator.platform ??
      "Unknown",
    screenSize: `${screen.width} x ${screen.height}`,
    clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

interface Props {
  token: string;
  /** Rendered as the signature and submitted as the name authorized. */
  customerName: string;
  /** Prefilled from the booking; the customer may correct it before signing. */
  contactPhone: string;
}

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "done" }
  | { state: "error"; message: string };

/**
 * Collects the customer's consent and submits it.
 *
 * A plain `fetch` rather than a server action: the page is public, the token
 * lives in the URL, and an API route keeps the whole exchange in one place
 * that can be called and tested without a React runtime. The server records
 * the IP, user agent and signing time itself — everything posted from here is
 * treated as a claim.
 */
export function SignatureForm({ token, customerName, contactPhone }: Props) {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const signed = status.state === "done";
  const sending = status.state === "sending";

  async function submit() {
    setStatus({ state: "sending" });

    try {
      const response = await fetch(
        `/api/public/sign/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            signatureName: customerName,
            // No longer asked for on the page: the number on the booking is
            // what is recorded, and it may be blank.
            signedPhone: contactPhone.trim(),
            consentText: CONSENT_TEXT,
            ...describeClient(),
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        setStatus({
          state: "error",
          message:
            body?.error ??
            "We could not record your confirmation. Please try again.",
        });
        return;
      }

      setStatus({ state: "done" });
    } catch {
      setStatus({
        state: "error",
        message:
          "We could not reach the server. Check your connection and try again.",
      });
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-base font-semibold text-[#173b70]">
        Automatically Generated Signature
      </h2>
      <div className="rounded-lg border-2 border-dashed border-[#b9c5d5] bg-white px-6 py-6 text-center">
        <div
          className="break-words text-4xl text-[#173b70]"
          style={{ fontFamily: '"Brush Script MT", cursive' }}
        >
          {customerName}
        </div>
        <hr className="my-3 border-[#e5e8ef]" />
        <small className="text-[#777]">Electronic Signature</small>
      </div>

      <div className="my-5" />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={signed || sending}
        className="w-full rounded-lg bg-[#1769e0] px-4 py-4 text-base font-bold text-white disabled:opacity-60"
      >
        {signed
          ? "Booking Confirmed"
          : sending
            ? "Submitting…"
            : "Sign & Confirm Booking"}
      </button>

      {status.state === "error" ? (
        <p role="alert" className="mt-4 font-semibold text-[#b91c1c]">
          {status.message}
        </p>
      ) : null}

      {signed ? (
        <p role="status" className="mt-4 font-semibold text-[#15803d]">
          Your booking has been successfully signed and confirmed.
        </p>
      ) : null}
    </div>
  );
}
