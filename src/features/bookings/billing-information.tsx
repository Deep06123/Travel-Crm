"use client";

import { ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Field, Input, Textarea } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";
import { Panel } from "@/components/ui/panel";
import { CardType } from "@/generated/prisma/enums";

import {
  type CardEntry,
  type CardErrors,
  type CardField,
  cvvLengthsFor,
  detectCardBrand,
  digitsOf,
  validateCardEntry,
} from "./card-validation";

/**
 * Billing information taken from the customer at booking time.
 *
 * The card number and CVV are collected so the agent can key them into the
 * terminal while the customer is on the line, and are then discarded. They are
 * deliberately rendered WITHOUT a `name` attribute: an unnamed control is not
 * serialised into `FormData`, so neither value reaches the server action, the
 * database or the audit log — the guarantee is structural rather than a
 * promise to delete something later.
 *
 * `cardLast4` is derived here, in the browser, from a number the server never
 * sees. That is the only part of the card worth keeping: enough to recognise
 * the card on a follow-up call, useless to anyone who steals the database.
 *
 * Storing a CVV after authorization is prohibited outright by PCI-DSS 3.3.1,
 * and a stored PAN would drag the whole application into SAQ-D scope.
 *
 * Because of that, the card itself can only be checked here — Luhn, brand,
 * length, CVV and expiry all need the number. `useCardEntry` owns those
 * fields and the form will not submit while any of them is wrong; see
 * `card-validation.ts`. The four fields that do travel are re-checked on the
 * server, which refuses to create a booking without them.
 */

const CARD_TYPE_LABELS: Record<CardType, string> = {
  AMERICAN_EXPRESS: "American Express",
  VISA: "Visa",
  MASTERCARD: "Mastercard",
  DISCOVER: "Discover",
  DINERS_CLUB: "Diners Club",
  JCB: "JCB",
  OTHER: "Other",
};

const EMPTY_ENTRY: CardEntry = {
  cardHolderName: "",
  cardType: "",
  cardNumber: "",
  cardExpiry: "",
  cvv: "",
};

export interface CardEntryControl {
  entry: CardEntry;
  set: (field: CardField, value: string) => void;
  touch: (field: CardField) => void;
  /** Only the errors the operator has been shown — touched, or post-submit. */
  visibleErrors: CardErrors;
  /** Every error, whether shown yet or not. Keyed for the form guide. */
  errors: CardErrors;
  last4: string;
  /** True when the card may be submitted. Reveals the errors when it is not. */
  validate: () => boolean;
}

/**
 * The card fields, held in the browser and nowhere else.
 *
 * The form owns this rather than the panel, because the form is what has to
 * refuse to submit. Keeping all five fields in React state also means a
 * server rejection on some unrelated field re-renders with the holder, type
 * and expiry still in place — while the number and CVV, which live in the
 * same state, are gone only when the component itself unmounts.
 */
export function useCardEntry(
  initial: Partial<CardEntry> = {},
): CardEntryControl {
  const [entry, setEntry] = useState<CardEntry>({ ...EMPTY_ENTRY, ...initial });
  const [touched, setTouched] = useState<Partial<Record<CardField, boolean>>>(
    {},
  );
  const [submitted, setSubmitted] = useState(false);

  /**
   * The field being typed into right now, if any.
   *
   * `touched` alone was not enough. Once a field had been left once — or once
   * a submit had been attempted — every keystroke re-validated it, so retyping
   * a card number showed "that number is not valid" on all fifteen keystrokes
   * before the last one. A number in progress is not a wrong number, and being
   * told it is while still typing reads as the form rejecting a good card.
   *
   * Set on change rather than on focus, deliberately: a failed submit moves
   * focus to the offending field, and suppressing on focus would hide the very
   * message the operator was just sent there to read.
   */
  const [editing, setEditing] = useState<CardField | null>(null);

  const set = useCallback((field: CardField, value: string) => {
    setEntry((current) => ({ ...current, [field]: value }));
    setEditing(field);
  }, []);

  const touch = useCallback((field: CardField) => {
    setTouched((current) => ({ ...current, [field]: true }));
    // Left the field, so whatever is in it is now an answer rather than a
    // work in progress, and is judged as one.
    setEditing((current) => (current === field ? null : current));
  }, []);

  const errors = useMemo(() => validateCardEntry(entry), [entry]);

  // Nothing is red until the operator has left the field or tried to submit:
  // a half-typed card number is not a mistake yet.
  const visibleErrors = useMemo(() => {
    if (submitted) {
      if (editing === null) return errors;
      const shown: CardErrors = { ...errors };
      delete shown[editing];
      return shown;
    }

    const shown: CardErrors = {};
    for (const [field, message] of Object.entries(errors) as [
      CardField,
      string,
    ][]) {
      if (touched[field] && editing !== field) shown[field] = message;
    }
    return shown;
  }, [errors, submitted, touched, editing]);

  const validate = useCallback(() => {
    setSubmitted(true);
    // Submitting ends the editing grace period: the operator has declared the
    // field finished, so a field still mid-edit must show its error now.
    setEditing(null);

    // Recomputed rather than read from `errors`: `validate` runs inside the
    // submit handler, where the memo may be a render behind a last keystroke.
    const found = validateCardEntry(entry);
    const first = Object.keys(found)[0];

    if (first === undefined) return true;

    const control = document.getElementById(first);
    if (control instanceof HTMLElement) {
      control.scrollIntoView({ block: "center", behavior: "smooth" });
      control.focus({ preventScroll: true });
    }

    return false;
  }, [entry]);

  const digits = digitsOf(entry.cardNumber);
  const last4 = digits.length >= 4 ? digits.slice(-4) : "";

  return { entry, set, touch, visibleErrors, errors, last4, validate };
}

export function BillingInformation({
  value,
  error,
  card,
}: {
  value: (field: string, fallback?: string) => string;
  error: (field: string) => string | undefined;
  card: CardEntryControl;
}) {
  const { entry, set, touch, visibleErrors, last4 } = card;

  // A server-side error on one of the four fields that do travel still has to
  // show; the client message wins when both are present, because it is about
  // what is in the box right now.
  const fieldError = (field: CardField) => visibleErrors[field] ?? error(field);

  const brand = detectCardBrand(digitsOf(entry.cardNumber));
  const cvvLengths = brand?.cvvLengths ?? cvvLengthsFor(entry.cardType);

  return (
    <Panel title="Billing information" collapsible={false}>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left column — the card */}
        <div className="flex flex-col gap-4">
          <Field
            id="cardHolderName"
            label="Card holder name"
            required
            hint="As printed on the card."
            error={fieldError("cardHolderName")}
          >
            {(props) => (
              <Input
                {...props}
                name="cardHolderName"
                placeholder="Name"
                autoComplete="off"
                value={entry.cardHolderName}
                onChange={(event) => set("cardHolderName", event.target.value)}
                onBlur={() => touch("cardHolderName")}
              />
            )}
          </Field>

          <Field
            id="cardType"
            label="Card type"
            required
            hint={brand ? `Detected from the number: ${brand.label}.` : undefined}
            error={fieldError("cardType")}
          >
            {(props) => (
              <StickySelect
                {...props}
                name="cardType"
                // `StickySelect` owns the DOM value so it survives the reset
                // React performs after an action; the hook is re-seeded from
                // it through `defaultValue` and kept in step by `onChange`.
                defaultValue={entry.cardType}
                onChange={(event) => set("cardType", event.target.value)}
                onBlur={() => touch("cardType")}
              >
                <option value="">— Select —</option>
                {Object.values(CardType).map((type) => (
                  <option key={type} value={type}>
                    {CARD_TYPE_LABELS[type]}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field
            id="cardNumber"
            label="Credit card no."
            required
            hint={
              last4
                ? `Not saved. Only ···· ${last4} is kept on the booking.`
                : "Not saved — key it into the terminal, then it is discarded."
            }
            error={fieldError("cardNumber")}
          >
            {(props) => (
              <Input
                {...props}
                // No `name`: this value must never enter FormData.
                placeholder="Credit Card No"
                inputMode="numeric"
                autoComplete="off"
                maxLength={23}
                value={entry.cardNumber}
                onChange={(event) => set("cardNumber", event.target.value)}
                onBlur={() => touch("cardNumber")}
              />
            )}
          </Field>

          {/* The one piece of the card that is kept, carried separately so the
              number itself has no reason to be submitted. */}
          <input type="hidden" name="cardLast4" value={last4} />

          <Field
            id="cardExpiry"
            label="Expiration date"
            required
            hint="Four digits, MMYY."
            error={fieldError("cardExpiry")}
          >
            {(props) => (
              <Input
                {...props}
                name="cardExpiry"
                placeholder="0428"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                value={entry.cardExpiry}
                onChange={(event) => set("cardExpiry", event.target.value)}
                onBlur={() => touch("cardExpiry")}
              />
            )}
          </Field>

          <Field
            id="cvv"
            label="CVV"
            required
            hint={`Not saved, ever. ${cvvLengths.join(" or ")} digits.`}
            error={fieldError("cvv")}
          >
            {(props) => (
              <Input
                {...props}
                // No `name`: see the note at the top of this file.
                placeholder="CVV"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                value={entry.cvv}
                onChange={(event) => set("cvv", event.target.value)}
                onBlur={() => touch("cvv")}
              />
            )}
          </Field>

          <Field
            id="inboundPhone"
            label="Inbound no."
            hint="The number the customer called in on."
            error={error("inboundPhone")}
          >
            {(props) => (
              <Input
                {...props}
                name="inboundPhone"
                type="tel"
                placeholder="Contact Phone"
                defaultValue={value("inboundPhone")}
              />
            )}
          </Field>

          <Field
            id="billingPhone"
            label="Billing no."
            error={error("billingPhone")}
          >
            {(props) => (
              <Input
                {...props}
                name="billingPhone"
                type="tel"
                placeholder="Billing Phone No"
                defaultValue={value("billingPhone")}
              />
            )}
          </Field>
        </div>

        {/* Right column — where the paperwork goes */}
        <div className="flex flex-col gap-4">
          <Field
            id="billingEmails"
            label="Email ID"
            hint="Separate several addresses with commas."
            error={error("billingEmails")}
          >
            {(props) => (
              <Input
                {...props}
                name="billingEmails"
                placeholder="Comma separated email ID"
                defaultValue={value("billingEmails")}
              />
            )}
          </Field>

          <Field
            id="billingAddressLine1"
            label="Billing address"
            error={error("billingAddressLine1")}
          >
            {(props) => (
              <Textarea
                {...props}
                name="billingAddressLine1"
                rows={3}
                placeholder="Please enter full billing address…"
                defaultValue={value("billingAddressLine1")}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="billingPostalCode"
              label="Zip code"
              error={error("billingPostalCode")}
            >
              {(props) => (
                <Input
                  {...props}
                  name="billingPostalCode"
                  placeholder="Zip Code"
                  defaultValue={value("billingPostalCode")}
                />
              )}
            </Field>

            <Field
              id="billingCountry"
              label="Country"
              error={error("billingCountry")}
            >
              {(props) => (
                <Input
                  {...props}
                  name="billingCountry"
                  defaultValue={value("billingCountry")}
                />
              )}
            </Field>

            <Field id="billingCity" label="City" error={error("billingCity")}>
              {(props) => (
                <Input
                  {...props}
                  name="billingCity"
                  defaultValue={value("billingCity")}
                />
              )}
            </Field>

            <Field id="billingState" label="State" error={error("billingState")}>
              {(props) => (
                <Input
                  {...props}
                  name="billingState"
                  defaultValue={value("billingState")}
                />
              )}
            </Field>
          </div>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-md bg-surface-muted p-3 text-xs text-ink-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          The card is checked in this browser — number, brand, CVV and expiry —
          and the booking cannot be created until it passes. The card number
          and CVV are not submitted, stored or written to the audit log. Only
          the last four digits, the card type and the expiry are kept on the
          booking.
        </span>
      </p>
    </Panel>
  );
}
