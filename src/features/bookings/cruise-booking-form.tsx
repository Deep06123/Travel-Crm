"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormGuide } from "@/components/ui/form-guide";
import { StickySelect } from "@/components/ui/sticky-select";
import { Panel } from "@/components/ui/panel";

import { BillingInformation, useCardEntry } from "./billing-information";
import { ItinerarySource } from "./itinerary-source";
import { ChargeOutcome } from "@/generated/prisma/enums";

import type { BookingFormState } from "./actions";
import type { BookingFormOptions } from "./flight-booking-form";
import { Repeater } from "./repeater";

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Saving…" : "Create booking"}
    </Button>
  );
}

/**
 * Cruise booking form.
 *
 * Shares the customer, accounting and follow-up sections with the flight form
 * but carries cruise fields in place of airline ones. There is deliberately no
 * PNR, ticket status or flight segment here — the plan requires flight-specific
 * fields to stay out of cruise records.
 */
export function CruiseBookingForm({
  action,
  options,
  preselectedCustomerId,
}: {
  action: (
    state: BookingFormState,
    formData: FormData,
  ) => Promise<BookingFormState>;
  options: BookingFormOptions;
  preselectedCustomerId?: string | undefined;
}) {
  const [state, formAction] = useActionState<BookingFormState, FormData>(action, {});

  // As in the flight form: the card is checked here, because the number and
  // CVV are never submitted and so can only be checked before submission.
  const card = useCardEntry();

  const value = (field: string, fallback = ""): string =>
    state.values?.[field] ?? fallback;
  const error = (field: string) => state.fieldErrors?.[field];
  const sectionHasError = (prefix: string): boolean =>
    Object.keys(state.fieldErrors ?? {}).some((key) => key.startsWith(prefix));

  /** Blocks the action outright while the card is wrong. */
  const guard = (event: FormEvent<HTMLFormElement>) => {
    if (!card.validate()) event.preventDefault();
  };

  return (
    <form
      action={formAction}
      onSubmit={guard}
      noValidate
      className="flex flex-col gap-4"
    >
      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
        >
          {state.error}
        </p>
      ) : null}
      <FormGuide fieldErrors={state.fieldErrors} />

      <Panel title="Booking details" collapsible={false}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="bookingTypeId" label="Booking type" error={error("bookingTypeId")}>
            {(props) => (
              <StickySelect {...props} name="bookingTypeId" defaultValue={value("bookingTypeId")}>
                <option value="">— Select —</option>
                {options.bookingTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field id="language" label="Language" error={error("language")}>
            {(props) => (
              <StickySelect {...props} name="language" defaultValue={value("language", "en")}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
              </StickySelect>
            )}
          </Field>


          {/* Per-booking email override. Left blank, the template decides —
              which keeps an automatic confirmation reading the same whoever
              happened to trigger it. */}
          <Field
            id="customEmailSubject"
            label="Subject"
            hint="Leave blank to use the standard subject."
            error={error("customEmailSubject")}
          >
            {(props) => (
              <Input
                {...props}
                name="customEmailSubject"
                defaultValue={value("customEmailSubject")}
                placeholder="Subject"
              />
            )}
          </Field>

          {/* The customer lives here now; there is no separate customer panel. */}
          <Field
            id="customerId"
            label="Customer"
            required
            hint="Required. Create the customer first if they are not listed."
            error={error("customerId")}
          >
            {(props) => (
              <StickySelect
                {...props}
                name="customerId"
                required
                defaultValue={value("customerId", preselectedCustomerId ?? "")}
              >
                <option value="">— Select a customer —</option>
                {options.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.reference} — {customer.firstName} {customer.lastName}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field id="bookedAt" label="Booking date" hint="Defaults to now." error={error("bookedAt")}>
            {(props) => <Input {...props} name="bookedAt" type="date" defaultValue={value("bookedAt")} />}
          </Field>

          <Field id="assignedAgentId" label="Assigned agent" error={error("assignedAgentId")}>
            {(props) => (
              <StickySelect {...props} name="assignedAgentId" defaultValue={value("assignedAgentId")}>
                <option value="">— Unassigned —</option>
                {options.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          {/* Priority is not here: it is derived from the departure date.
              Nor is the lifecycle status — a new booking is always Pending. */}
          <Field
            id="chargeOutcome"
            label="Charge outcome"
            hint="What happened when the card was charged."
            error={error("chargeOutcome")}
          >
            {(props) => (
              <StickySelect
                {...props}
                name="chargeOutcome"
                defaultValue={value("chargeOutcome", ChargeOutcome.PENDING)}
              >
                {Object.values(ChargeOutcome).map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {humanise(outcome)}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>
        </div>
      </Panel>

      <Panel title="Cruise information" collapsible={false}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="cruiseLine" label="Cruise line" required error={error("cruiseLine")}>
            {(props) => (
              <Input {...props} name="cruiseLine" required placeholder="Royal Caribbean" defaultValue={value("cruiseLine")} />
            )}
          </Field>

          <Field id="ship" label="Ship" error={error("ship")}>
            {(props) => <Input {...props} name="ship" placeholder="Wonder of the Seas" defaultValue={value("ship")} />}
          </Field>

          <Field id="reservationNumber" label="Reservation no." error={error("reservationNumber")}>
            {(props) => <Input {...props} name="reservationNumber" defaultValue={value("reservationNumber")} />}
          </Field>

          <Field id="tfnId" label="TFN" error={error("tfnId")}>
            {(props) => (
              <StickySelect {...props} name="tfnId" defaultValue={value("tfnId")}>
                <option value="">— Select —</option>
                {options.tfns.map((tfn) => (
                  <option key={tfn.id} value={tfn.id}>
                    {tfn.label} ({tfn.number})
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field id="nights" label="Nights" error={error("nights")}>
            {(props) => <Input {...props} name="nights" type="number" min={0} placeholder="7" defaultValue={value("nights")} />}
          </Field>

          <Field
            id="sailingName"
            label="Sailing name"
            hint="As the cruise line prints it."
            error={error("sailingName")}
            className="sm:col-span-2"
          >
            {(props) => (
              <Input
                {...props}
                name="sailingName"
                placeholder="10 Night Western Caribbean from Galveston Cruise"
                defaultValue={value("sailingName")}
              />
            )}
          </Field>

          <Field id="sailDate" label="Departure date" hint="The sailing date." error={error("sailDate")}>
            {(props) => <Input {...props} name="sailDate" type="date" defaultValue={value("sailDate")} />}
          </Field>

          <Field id="returnDate" label="Return date" hint="Must not be before the sailing date." error={error("returnDate")}>
            {(props) => <Input {...props} name="returnDate" type="date" defaultValue={value("returnDate")} />}
          </Field>

          {/* Moved up from the old customer panel: this is reservation
              data, not a customer detail. */}
          <Field id="confirmationReference" label="Cruise line confirmation" error={error("confirmationReference")}>
            {(props) => <Input {...props} name="confirmationReference" defaultValue={value("confirmationReference")} />}
          </Field>

          {/* Request against the reservation itself — a name change, a cabin
              move. Special assistance is a separate field, under the cabin
              panel, because it describes the guest rather than the booking. */}
          <Field
            id="specialRequest"
            label="Special request"
            hint="Name change, cabin move, and the like."
            error={error("specialRequest")}
          >
            {(props) => (
              <Input
                {...props}
                name="specialRequest"
                placeholder="Name change"
                defaultValue={value("specialRequest")}
              />
            )}
          </Field>

          {/* The one-line summary, kept separate from the itinerary proper:
              it is what the Sailing panel prints back on the detail page. */}
          <Field
            id="itinerary"
            label="Ports of call"
            hint="A one-line summary, in order."
            error={error("itinerary")}
            className="sm:col-span-2 lg:col-span-3"
          >
            {(props) => (
              <Textarea {...props} name="itinerary" rows={2} placeholder="Ports of call, in order" defaultValue={value("itinerary")} />
            )}
          </Field>
        </div>

        {/* The same pair the flight form offers: paste the cruise line's own
            confirmation, or compose the itinerary by hand. Both are kept —
            they are different evidence, and neither is parsed. */}
        <ItinerarySource
          textName="reservationText"
          textLabel="Reservation text"
          textHint="Stored exactly as pasted, for reference only — it is never parsed."
          textPlaceholder="Please copy and paste the cruise confirmation here…"
          textError={error("reservationText")}
          htmlName="itineraryHtml"
          defaultText={value("reservationText")}
          defaultHtml={value("itineraryHtml")}
          actionLabel="Decode reservation using API"
          actionNotice="No cruise-line integration is configured. What you pasted has been kept exactly as typed — fill in the sailing details above by hand."
        />
      </Panel>

      <Panel title="Cabin and dining" collapsible={false}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="deckNumber" label="Deck" error={error("deckNumber")}>
            {(props) => <Input {...props} name="deckNumber" placeholder="Deck 08" defaultValue={value("deckNumber")} />}
          </Field>

          <Field id="cabinNumber" label="Cabin / room no." error={error("cabinNumber")}>
            {(props) => <Input {...props} name="cabinNumber" defaultValue={value("cabinNumber")} />}
          </Field>

          <Field id="cabinCategory" label="Cabin category" error={error("cabinCategory")}>
            {(props) => (
              <Input {...props} name="cabinCategory" placeholder="Balcony, Interior, Suite" defaultValue={value("cabinCategory")} />
            )}
          </Field>

          <Field
            id="cabinCount"
            label="Number of cabins"
            hint="Assign guests to specific cabins below when more than one."
            error={error("cabinCount")}
          >
            {(props) => (
              <Input {...props} name="cabinCount" type="number" min={1} defaultValue={value("cabinCount", "1")} />
            )}
          </Field>

          <Field id="diningPreference" label="Dining preference" error={error("diningPreference")}>
            {(props) => (
              <Input {...props} name="diningPreference" placeholder="Early, Late, Anytime" defaultValue={value("diningPreference")} />
            )}
          </Field>

          <Field id="gratuitiesIncluded" label="Gratuities included" error={error("gratuitiesIncluded")}>
            {(props) => (
              <StickySelect {...props} name="gratuitiesIncluded" defaultValue={value("gratuitiesIncluded", "false")}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </StickySelect>
            )}
          </Field>

          <Field id="insuranceIncluded" label="Insurance included" error={error("insuranceIncluded")}>
            {(props) => (
              <StickySelect {...props} name="insuranceIncluded" defaultValue={value("insuranceIncluded", "false")}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </StickySelect>
            )}
          </Field>
        </div>
      </Panel>

      <Panel
        title="Guests"
        description="Passport details are restricted and visible only to authorised roles."
        collapsible={false}
      >
        {sectionHasError("guests.") ? (
          <p className="mb-3 text-xs text-status-danger">Check the highlighted fields.</p>
        ) : null}

        <Repeater name="guests" legend="Guest" addLabel="Add guest" minRows={1}>
          {({ index, field }) => (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                id={field("firstName")}
                label="First name"
                required
                hint={index === 0 ? "Exactly as printed in the passport." : undefined}
                error={error(`guests.${index}.firstName`)}
              >
                {(props) => <Input {...props} name={field("firstName")} defaultValue={value(field("firstName"))} />}
              </Field>
              <Field
                id={field("lastName")}
                label="Last name"
                required
                hint={index === 0 ? "Exactly as printed in the passport." : undefined}
                error={error(`guests.${index}.lastName`)}
              >
                {(props) => <Input {...props} name={field("lastName")} defaultValue={value(field("lastName"))} />}
              </Field>
              <Field id={field("gender")} label="Gender" error={error(`guests.${index}.gender`)}>
                {(props) => (
                  <StickySelect {...props} name={field("gender")} defaultValue={value(field("gender"))}>
                    <option value="">— Select —</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="X">X</option>
                    <option value="Undisclosed">Prefer not to say</option>
                  </StickySelect>
                )}
              </Field>
              <Field id={field("type")} label="Guest type" error={error(`guests.${index}.type`)}>
                {(props) => (
                  <StickySelect {...props} name={field("type")} defaultValue={value(field("type"), "ADULT")}>
                    <option value="ADULT">Adult</option>
                    <option value="CHILD">Child</option>
                    <option value="INFANT">Infant</option>
                    <option value="SENIOR">Senior</option>
                  </StickySelect>
                )}
              </Field>
              <Field id={field("dateOfBirth")} label="Date of birth" error={error(`guests.${index}.dateOfBirth`)}>
                {(props) => <Input {...props} name={field("dateOfBirth")} type="date" defaultValue={value(field("dateOfBirth"))} />}
              </Field>
              <Field id={field("passportNumber")} label="Passport no." error={error(`guests.${index}.passportNumber`)}>
                {(props) => <Input {...props} name={field("passportNumber")} defaultValue={value(field("passportNumber"))} />}
              </Field>
              <Field id={field("passportCountry")} label="Passport country" error={error(`guests.${index}.passportCountry`)}>
                {(props) => <Input {...props} name={field("passportCountry")} defaultValue={value(field("passportCountry"))} />}
              </Field>
              {/* Only filled in on a name change, so the authorisation can
                  show the old name beside the new one. */}
              <Field
                id={field("previousFirstName")}
                label="Previous first name"
                hint="Name changes only."
                error={error(`guests.${index}.previousFirstName`)}
              >
                {(props) => (
                  <Input {...props} name={field("previousFirstName")} defaultValue={value(field("previousFirstName"))} />
                )}
              </Field>
              <Field
                id={field("previousLastName")}
                label="Previous last name"
                hint="Name changes only."
                error={error(`guests.${index}.previousLastName`)}
              >
                {(props) => (
                  <Input {...props} name={field("previousLastName")} defaultValue={value(field("previousLastName"))} />
                )}
              </Field>
              <Field
                id={field("cabinNumber")}
                label="Cabin"
                hint="Leave blank to use the booking's cabin."
                error={error(`guests.${index}.cabinNumber`)}
              >
                {(props) => <Input {...props} name={field("cabinNumber")} defaultValue={value(field("cabinNumber"))} />}
              </Field>
            </div>
          )}
        </Repeater>
      </Panel>

      {/* Billing information. The address fields live here rather than above,
          so there is one place a billing detail is entered. */}
      <BillingInformation value={value} error={error} card={card} />

      {/* Five figures, per the review sheet. Currency is no longer chosen
          per booking: it rides along as a hidden field carrying the operator
          default, because the service needs it to convert these decimal
          strings to minor units. */}
      <Panel title="Accounting information" defaultOpen={false}>
        <input type="hidden" name="currency" value={options.defaultCurrency} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="baseFare" label="Cruise fare" hint="Digits and a decimal point." error={error("baseFare")}>
            {(props) => <Input {...props} name="baseFare" inputMode="decimal" placeholder="1800.00" defaultValue={value("baseFare")} />}
          </Field>

          <Field id="grossMco" label="MCO" hint="Digits and a decimal point." error={error("grossMco")}>
            {(props) => <Input {...props} name="grossMco" inputMode="decimal" placeholder="1800.00" defaultValue={value("grossMco")} />}
          </Field>

          <Field id="total" label="Total fare" hint="Digits and a decimal point." error={error("total")}>
            {(props) => <Input {...props} name="total" inputMode="decimal" placeholder="1800.00" defaultValue={value("total")} />}
          </Field>

          <Field id="mcoSupplierId" label="MCO supplier" error={error("mcoSupplierId")}>
            {(props) => (
              <StickySelect {...props} name="mcoSupplierId" defaultValue={value("mcoSupplierId")}>
                <option value="">— Select —</option>
                {options.mcoSuppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field id="splitCharges" label="Split charges" error={error("splitCharges")}>
            {(props) => (
              <StickySelect {...props} name="splitCharges" defaultValue={value("splitCharges", "false")}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </StickySelect>
            )}
          </Field>
        </div>
      </Panel>

      <Panel title="Notes" defaultOpen={false}>
        <Field id="comment" label="Notes" error={error("comment")}>
          {(props) => <Textarea {...props} name="comment" rows={3} defaultValue={value("comment")} />}
        </Field>
      </Panel>

      <div className="flex items-center gap-2 pb-8">
        <SubmitButton />
        <Link href="/admin/bookings" className={buttonVariants({ variant: "secondary" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
