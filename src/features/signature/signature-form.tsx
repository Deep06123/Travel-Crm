"use client";

import { useState } from "react";

/**
 * The consent the customer agrees to.
 *
 * Exported and submitted with the signature so the stored evidence is the
 * exact sentence that was on screen. Reading the wording out of the component
 * that displayed it — rather than re-stating it on the server — is what makes
 * that true: there is one copy, so the two cannot drift.
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
  const [consented, setConsented] = useState(false);
  const [phone, setPhone] = useState(contactPhone);
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const signed = status.state === "done";
  const sending = status.state === "sending";

  async function submit() {
    if (!consented) {
      setStatus({
        state: "error",
        message: "Please accept the electronic signature consent.",
      });
      return;
    }

    if (phone.trim() === "") {
      setStatus({
        state: "error",
        message: "Please enter a mobile number we can reach you on.",
      });
      return;
    }

    setStatus({ state: "sending" });

    try {
      const response = await fetch(
        `/api/public/sign/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            signatureName: customerName,
            signedPhone: phone.trim(),
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

      <h2 className="mb-2 mt-6 text-base font-semibold text-[#173b70]">
        Your Contact Number
      </h2>
      <label htmlFor="signedPhone" className="sr-only">
        Mobile number
      </label>
      <input
        id="signedPhone"
        name="signedPhone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        disabled={signed || sending}
        onChange={(event) => setPhone(event.target.value)}
        className="w-full rounded-lg border border-[#b9c5d5] px-3 py-3 text-base disabled:bg-[#f5f7fb]"
        placeholder="e.g. +1 555 0100"
      />
      <p className="mt-2 text-xs leading-relaxed text-[#777]">
        We have filled in the number on your booking. Correct it if we should
        reach you on a different one — the number you confirm here is recorded
        with your signature.
      </p>

      <p className="mt-6 text-xs leading-relaxed text-[#777]">
        Your IP address and approximate location will be recorded by the booking
        server when you submit your confirmation. IP-based location is
        approximate and may be inaccurate.
      </p>

      <label className="my-5 flex items-start gap-2.5 text-[13px] leading-relaxed">
        <input
          type="checkbox"
          className="mt-1"
          checked={consented}
          disabled={signed || sending}
          onChange={(event) => setConsented(event.target.checked)}
        />
        <span>{CONSENT_TEXT}</span>
      </label>

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
