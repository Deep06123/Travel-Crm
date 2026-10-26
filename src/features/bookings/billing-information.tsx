"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { CardType } from "@/generated/prisma/enums";

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

/** Digits only, so spacing and dashes typed off a card do not break `slice`. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

export function BillingInformation({
  value,
  error,
}: {
  value: (field: string, fallback?: string) => string;
  error: (field: string) => string | undefined;
}) {
  // Held in component state, never in a named input. Re-rendering the form
  // after a failed submit drops them, which is the correct behaviour: the
  // agent re-reads the card rather than the browser holding it indefinitely.
  const [cardNumber, setCardNumber] = useState("");
  const [cvv, setCvv] = useState("");

  const digits = digitsOf(cardNumber);
  const last4 = digits.length >= 4 ? digits.slice(-4) : "";

  return (
    <Panel title="Billing information" collapsible={false}>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left column — the card */}
        <div className="flex flex-col gap-4">
          <Field
            id="cardHolderName"
            label="Card holder name"
            error={error("cardHolderName")}
          >
            {(props) => (
              <Input
                {...props}
                name="cardHolderName"
                placeholder="Name"
                autoComplete="off"
                defaultValue={value("cardHolderName")}
              />
            )}
          </Field>

          <Field id="cardType" label="Card type" error={error("cardType")}>
            {(props) => (
              <Select
                {...props}
                name="cardType"
                defaultValue={value("cardType")}
              >
                <option value="">— Select —</option>
                {Object.values(CardType).map((type) => (
                  <option key={type} value={type}>
                    {CARD_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            id="cardNumber"
            label="Credit card no."
            hint={
              last4
                ? `Not saved. Only ···· ${last4} is kept on the booking.`
                : "Not saved — key it into the terminal, then it is discarded."
            }
          >
            {(props) => (
              <Input
                {...props}
                // No `name`: this value must never enter FormData.
                placeholder="Credit Card No"
                inputMode="numeric"
                autoComplete="off"
                value={cardNumber}
                onChange={(event) => setCardNumber(event.target.value)}
              />
            )}
          </Field>

          {/* The one piece of the card that is kept, carried separately so the
              number itself has no reason to be submitted. */}
          <input type="hidden" name="cardLast4" value={last4} />

          <Field
            id="cardExpiry"
            label="Expiration date"
            error={error("cardExpiry")}
          >
            {(props) => (
              <Input
                {...props}
                name="cardExpiry"
                placeholder="MMYY"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                defaultValue={value("cardExpiry")}
              />
            )}
          </Field>

          <Field id="cvv" label="CVV" hint="Not saved, ever.">
            {(props) => (
              <Input
                {...props}
                // No `name`: see the note at the top of this file.
                placeholder="CVV"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                value={cvv}
                onChange={(event) => setCvv(event.target.value)}
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
            hint="Separate multiple addresses with commas."
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
          The card number and CVV stay in this browser — they are not submitted,
          stored or written to the audit log. Only the last four digits, the
          card type and the expiry are kept on the booking.
        </span>
      </p>
    </Panel>
  );
}
