"use client";

import { Info, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";

import { BillingInformation } from "./billing-information";
import { ItinerarySource } from "./itinerary-source";
import {
  ChargeOutcome,
  PassengerType,
  TicketStatus,
} from "@/generated/prisma/enums";

import type { BookingFormState } from "./actions";
import { Repeater } from "./repeater";

export interface BookingFormOptions {
  customers: { id: string; reference: string; firstName: string; lastName: string }[];
  agents: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  mcoSuppliers: { id: string; name: string }[];
  bookingTypes: { id: string; label: string }[];
  tfns: { id: string; number: string; label: string }[];
  currencies: string[];
  defaultCurrency: string;
}

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

export function FlightBookingForm({
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

  const value = (field: string, fallback = ""): string =>
    state.values?.[field] ?? fallback;
  const error = (field: string) => state.fieldErrors?.[field];

  // Row-level errors are keyed `passengers.0.firstName`; surface a summary on
  // the section header so a collapsed section still shows it has a problem.
  const sectionHasError = (prefix: string): boolean =>
    Object.keys(state.fieldErrors ?? {}).some((key) => key.startsWith(prefix));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
        >
          {state.error}
        </p>
      ) : null}

      {/* A — Booking details */}
      <Panel title="Booking details" collapsible={false}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="bookingTypeId" label="Booking type" error={error("bookingTypeId")}>
            {(props) => (
              <Select {...props} name="bookingTypeId" defaultValue={value("bookingTypeId")}>
                <option value="">— Select —</option>
                {options.bookingTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="language" label="Language" error={error("language")}>
            {(props) => (
              <Select {...props} name="language" defaultValue={value("language", "en")}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
              </Select>
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
            error={error("customerId")}
          >
            {(props) => (
              <Select
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
              </Select>
            )}
          </Field>

          <Field id="bookedAt" label="Booking date" hint="Defaults to now." error={error("bookedAt")}>
            {(props) => (
              <Input {...props} name="bookedAt" type="datetime-local" defaultValue={value("bookedAt")} />
            )}
          </Field>

          <Field id="assignedAgentId" label="Assigned agent" error={error("assignedAgentId")}>
            {(props) => (
              <Select {...props} name="assignedAgentId" defaultValue={value("assignedAgentId")}>
                <option value="">— Unassigned —</option>
                {options.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/* Priority is not here: it is derived from the travelling date.
              Nor is the lifecycle status — a new booking is always Pending. */}
          <Field
            id="chargeOutcome"
            label="Charge outcome"
            hint="What happened when the card was charged."
            error={error("chargeOutcome")}
          >
            {(props) => (
              <Select
                {...props}
                name="chargeOutcome"
                defaultValue={value("chargeOutcome", ChargeOutcome.PENDING)}
              >
                {Object.values(ChargeOutcome).map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {humanise(outcome)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Panel>

      {/* B — Flight information */}
      <Panel title="Flight information" collapsible={false}>
        <div className="mb-4 flex items-start gap-2 rounded-md bg-status-info-bg px-3 py-2 text-sm text-status-info">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            Automatic PNR decoding is unavailable — no airline or GDS
            integration is configured. Paste the PNR for reference and enter the
            flight segments below.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="pnrLocator" label="PNR / record locator" error={error("pnrLocator")}>
            {(props) => (
              <Input {...props} name="pnrLocator" defaultValue={value("pnrLocator")} />
            )}
          </Field>

          <Field id="airline" label="Airline" error={error("airline")}>
            {(props) => <Input {...props} name="airline" defaultValue={value("airline")} />}
          </Field>

          <Field id="bookingClass" label="Class of booking" error={error("bookingClass")}>
            {(props) => (
              <Input {...props} name="bookingClass" placeholder="Economy, Business" defaultValue={value("bookingClass")} />
            )}
          </Field>

          <Field id="origin" label="Origin" error={error("origin")}>
            {(props) => (
              <Input {...props} name="origin" maxLength={3} placeholder="JFK" defaultValue={value("origin")} />
            )}
          </Field>

          <Field id="destination" label="Destination" error={error("destination")}>
            {(props) => (
              <Input {...props} name="destination" maxLength={3} placeholder="LHR" defaultValue={value("destination")} />
            )}
          </Field>

          <Field id="supplierId" label="Supplier" error={error("supplierId")}>
            {(props) => (
              <Select {...props} name="supplierId" defaultValue={value("supplierId")}>
                <option value="">— Select —</option>
                {options.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="departureDate" label="Travelling date" error={error("departureDate")}>
            {(props) => (
              <Input {...props} name="departureDate" type="date" defaultValue={value("departureDate")} />
            )}
          </Field>

          <Field id="returnDate" label="Returning date" error={error("returnDate")}>
            {(props) => (
              <Input {...props} name="returnDate" type="date" defaultValue={value("returnDate")} />
            )}
          </Field>

          <Field id="tfnId" label="TFN" error={error("tfnId")}>
            {(props) => (
              <Select {...props} name="tfnId" defaultValue={value("tfnId")}>
                <option value="">— Select —</option>
                {options.tfns.map((tfn) => (
                  <option key={tfn.id} value={tfn.id}>
                    {tfn.label} ({tfn.number})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <ItinerarySource
          textName="pnrText"
          textLabel="PNR text"
          textHint="Stored exactly as pasted, for reference only — it is never parsed."
          textPlaceholder="Please copy and paste PNR here…"
          textError={error("pnrText")}
          htmlName="itineraryHtml"
          defaultText={value("pnrText")}
          defaultHtml={value("itineraryHtml")}
        />

        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">
            Flight segments
            {sectionHasError("segments.") ? (
              <span className="ml-2 text-xs font-normal text-status-danger">
                Check the highlighted fields
              </span>
            ) : null}
          </h3>

          <Repeater name="segments" legend="Segment" addLabel="Add segment" minRows={1}>
            {({ index, field }) => (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field id={field("airline")} label="Airline" error={error(`segments.${index}.airline`)}>
                  {(props) => <Input {...props} name={field("airline")} defaultValue={value(field("airline"))} />}
                </Field>
                <Field id={field("flightNumber")} label="Flight no." error={error(`segments.${index}.flightNumber`)}>
                  {(props) => <Input {...props} name={field("flightNumber")} defaultValue={value(field("flightNumber"))} />}
                </Field>
                <Field id={field("origin")} label="From" error={error(`segments.${index}.origin`)}>
                  {(props) => <Input {...props} name={field("origin")} maxLength={3} defaultValue={value(field("origin"))} />}
                </Field>
                <Field id={field("destination")} label="To" error={error(`segments.${index}.destination`)}>
                  {(props) => <Input {...props} name={field("destination")} maxLength={3} defaultValue={value(field("destination"))} />}
                </Field>
                <Field id={field("departureAt")} label="Departs" error={error(`segments.${index}.departureAt`)}>
                  {(props) => <Input {...props} name={field("departureAt")} type="datetime-local" defaultValue={value(field("departureAt"))} />}
                </Field>
                <Field id={field("arrivalAt")} label="Arrives" error={error(`segments.${index}.arrivalAt`)}>
                  {(props) => <Input {...props} name={field("arrivalAt")} type="datetime-local" defaultValue={value(field("arrivalAt"))} />}
                </Field>
                <Field id={field("bookingClass")} label="Class" error={error(`segments.${index}.bookingClass`)}>
                  {(props) => <Input {...props} name={field("bookingClass")} defaultValue={value(field("bookingClass"))} />}
                </Field>
                <Field id={field("cabin")} label="Cabin" error={error(`segments.${index}.cabin`)}>
                  {(props) => <Input {...props} name={field("cabin")} defaultValue={value(field("cabin"))} />}
                </Field>
              </div>
            )}
          </Repeater>
        </div>
      </Panel>

      {/* C — Passenger information */}
      <Panel
        title="Passenger information"
        description="Passport details are restricted and visible only to authorised roles."
        collapsible={false}
      >
        <Repeater name="passengers" legend="Passenger" addLabel="Add passenger" minRows={1}>
          {({ index, field }) => (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field id={field("firstName")} label="First name" required error={error(`passengers.${index}.firstName`)}>
                {(props) => <Input {...props} name={field("firstName")} defaultValue={value(field("firstName"))} />}
              </Field>
              <Field id={field("middleName")} label="Middle name" error={error(`passengers.${index}.middleName`)}>
                {(props) => <Input {...props} name={field("middleName")} defaultValue={value(field("middleName"))} />}
              </Field>
              <Field id={field("lastName")} label="Last name" required error={error(`passengers.${index}.lastName`)}>
                {(props) => <Input {...props} name={field("lastName")} defaultValue={value(field("lastName"))} />}
              </Field>
              <Field id={field("type")} label="Passenger type" error={error(`passengers.${index}.type`)}>
                {(props) => (
                  <Select {...props} name={field("type")} defaultValue={value(field("type"), PassengerType.ADULT)}>
                    {Object.values(PassengerType).map((type) => (
                      <option key={type} value={type}>
                        {humanise(type)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id={field("gender")} label="Gender" error={error(`passengers.${index}.gender`)}>
                {(props) => (
                  <Select {...props} name={field("gender")} defaultValue={value(field("gender"))}>
                    <option value="">— Select —</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="X">X</option>
                    <option value="Undisclosed">Prefer not to say</option>
                  </Select>
                )}
              </Field>
              <Field id={field("dateOfBirth")} label="Date of birth" error={error(`passengers.${index}.dateOfBirth`)}>
                {(props) => <Input {...props} name={field("dateOfBirth")} type="date" defaultValue={value(field("dateOfBirth"))} />}
              </Field>
              <Field id={field("passportNumber")} label="Passport no." error={error(`passengers.${index}.passportNumber`)}>
                {(props) => <Input {...props} name={field("passportNumber")} defaultValue={value(field("passportNumber"))} />}
              </Field>
              <Field id={field("ticketNumber")} label="Ticket no." error={error(`passengers.${index}.ticketNumber`)}>
                {(props) => <Input {...props} name={field("ticketNumber")} defaultValue={value(field("ticketNumber"))} />}
              </Field>
            </div>
          )}
        </Repeater>
      </Panel>

      {/* D2 — Billing information. The address fields live here rather than
          above, so there is one place a billing detail is entered. */}
      <BillingInformation value={value} error={error} />

      {/* E — Ticketing */}
      <Panel title="Ticketing information" defaultOpen={false}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="ticketStatus" label="Ticket status" error={error("ticketStatus")}>
            {(props) => (
              <Select {...props} name="ticketStatus" defaultValue={value("ticketStatus", TicketStatus.PENDING)}>
                {Object.values(TicketStatus).map((status) => (
                  <option key={status} value={status}>
                    {humanise(status)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="airlineConfirmation" label="Airline confirmation" error={error("airlineConfirmation")}>
            {(props) => <Input {...props} name="airlineConfirmation" defaultValue={value("airlineConfirmation")} />}
          </Field>

          <Field id="ticketingReference" label="Supplier reference" error={error("ticketingReference")}>
            {(props) => <Input {...props} name="ticketingReference" defaultValue={value("ticketingReference")} />}
          </Field>

          <Field id="ticketingNotes" label="Ticketing notes" error={error("ticketingNotes")} className="sm:col-span-2 lg:col-span-3">
            {(props) => <Textarea {...props} name="ticketingNotes" rows={3} defaultValue={value("ticketingNotes")} />}
          </Field>
        </div>
      </Panel>

      {/* F — Accounting. Five figures, per the review sheet. Currency is no
          longer chosen per booking: it rides along as a hidden field carrying
          the operator default, because the service needs it to convert these
          decimal strings to minor units. */}
      <Panel title="Accounting information" defaultOpen={false}>
        <input type="hidden" name="currency" value={options.defaultCurrency} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="baseFare" label="Gross fare" error={error("baseFare")}>
            {(props) => <Input {...props} name="baseFare" inputMode="decimal" placeholder="0.00" defaultValue={value("baseFare")} />}
          </Field>

          <Field id="grossMco" label="MCO" error={error("grossMco")}>
            {(props) => <Input {...props} name="grossMco" inputMode="decimal" placeholder="0.00" defaultValue={value("grossMco")} />}
          </Field>

          <Field id="total" label="Total fare" error={error("total")}>
            {(props) => <Input {...props} name="total" inputMode="decimal" placeholder="0.00" defaultValue={value("total")} />}
          </Field>

          <Field id="mcoSupplierId" label="MCO supplier" error={error("mcoSupplierId")}>
            {(props) => (
              <Select {...props} name="mcoSupplierId" defaultValue={value("mcoSupplierId")}>
                <option value="">— Select —</option>
                {options.mcoSuppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="splitCharges" label="Split charges" error={error("splitCharges")}>
            {(props) => (
              <Select {...props} name="splitCharges" defaultValue={value("splitCharges", "false")}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </Select>
            )}
          </Field>
        </div>
      </Panel>

      {/* H — Notes. Payments (G) are recorded against the saved booking, so
          the booking exists before money is attached to it. */}
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
