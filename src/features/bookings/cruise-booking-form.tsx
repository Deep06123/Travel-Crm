"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import {
  BookingPriority,
  BookingStatus,
  McoStatus,
} from "@/generated/prisma/enums";

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

  const value = (field: string, fallback = ""): string =>
    state.values?.[field] ?? fallback;
  const error = (field: string) => state.fieldErrors?.[field];
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

          <Field id="bookedAt" label="Booking date" hint="Defaults to now." error={error("bookedAt")}>
            {(props) => <Input {...props} name="bookedAt" type="date" defaultValue={value("bookedAt")} />}
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

          <Field id="source" label="Booking source" error={error("source")}>
            {(props) => <Input {...props} name="source" placeholder="Phone, web, partner" defaultValue={value("source")} />}
          </Field>

          <Field id="priority" label="Priority" error={error("priority")}>
            {(props) => (
              <Select {...props} name="priority" defaultValue={value("priority", BookingPriority.NORMAL)}>
                {Object.values(BookingPriority).map((level) => (
                  <option key={level} value={level}>
                    {humanise(level)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            id="status"
            label="Initial status"
            hint="Confirmed is reached later, once the cruise line confirms."
            error={error("status")}
          >
            {(props) => (
              <Select {...props} name="status" defaultValue={value("status", BookingStatus.PENDING)}>
                <option value={BookingStatus.DRAFT}>Draft</option>
                <option value={BookingStatus.PENDING}>Pending</option>
              </Select>
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
            {(props) => <Input {...props} name="ship" defaultValue={value("ship")} />}
          </Field>

          <Field id="reservationNumber" label="Reservation no." error={error("reservationNumber")}>
            {(props) => <Input {...props} name="reservationNumber" defaultValue={value("reservationNumber")} />}
          </Field>

          <Field id="departurePort" label="Departure port" error={error("departurePort")}>
            {(props) => <Input {...props} name="departurePort" defaultValue={value("departurePort")} />}
          </Field>

          <Field id="arrivalPort" label="Arrival port" error={error("arrivalPort")}>
            {(props) => <Input {...props} name="arrivalPort" defaultValue={value("arrivalPort")} />}
          </Field>

          <Field id="nights" label="Nights" error={error("nights")}>
            {(props) => <Input {...props} name="nights" type="number" min={0} defaultValue={value("nights")} />}
          </Field>

          <Field id="sailDate" label="Sail date" error={error("sailDate")}>
            {(props) => <Input {...props} name="sailDate" type="date" defaultValue={value("sailDate")} />}
          </Field>

          <Field id="returnDate" label="Return date" error={error("returnDate")}>
            {(props) => <Input {...props} name="returnDate" type="date" defaultValue={value("returnDate")} />}
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

          <Field id="itinerary" label="Itinerary" error={error("itinerary")} className="sm:col-span-2 lg:col-span-3">
            {(props) => (
              <Textarea {...props} name="itinerary" rows={2} placeholder="Ports of call, in order" defaultValue={value("itinerary")} />
            )}
          </Field>
        </div>
      </Panel>

      <Panel title="Cabin and dining" collapsible={false}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <Select {...props} name="gratuitiesIncluded" defaultValue={value("gratuitiesIncluded", "false")}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </Select>
            )}
          </Field>

          <Field id="insuranceIncluded" label="Insurance included" error={error("insuranceIncluded")}>
            {(props) => (
              <Select {...props} name="insuranceIncluded" defaultValue={value("insuranceIncluded", "false")}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </Select>
            )}
          </Field>

          <Field id="assistanceNotes" label="Special assistance" error={error("assistanceNotes")} className="sm:col-span-2 lg:col-span-3">
            {(props) => <Textarea {...props} name="assistanceNotes" rows={2} defaultValue={value("assistanceNotes")} />}
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
              <Field id={field("firstName")} label="First name" required error={error(`guests.${index}.firstName`)}>
                {(props) => <Input {...props} name={field("firstName")} defaultValue={value(field("firstName"))} />}
              </Field>
              <Field id={field("lastName")} label="Last name" required error={error(`guests.${index}.lastName`)}>
                {(props) => <Input {...props} name={field("lastName")} defaultValue={value(field("lastName"))} />}
              </Field>
              <Field id={field("type")} label="Guest type" error={error(`guests.${index}.type`)}>
                {(props) => (
                  <Select {...props} name={field("type")} defaultValue={value(field("type"), "ADULT")}>
                    <option value="ADULT">Adult</option>
                    <option value="CHILD">Child</option>
                    <option value="INFANT">Infant</option>
                    <option value="SENIOR">Senior</option>
                  </Select>
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

      <Panel title="Customer and billing" collapsible={false}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            id="customerId"
            label="Customer"
            required
            error={error("customerId")}
            className="sm:col-span-2"
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

          <Field id="confirmationReference" label="Cruise line confirmation" error={error("confirmationReference")}>
            {(props) => <Input {...props} name="confirmationReference" defaultValue={value("confirmationReference")} />}
          </Field>

          <Field id="contactName" label="Contact name" error={error("contactName")}>
            {(props) => <Input {...props} name="contactName" defaultValue={value("contactName")} />}
          </Field>

          <Field id="contactEmail" label="Email" error={error("contactEmail")}>
            {(props) => <Input {...props} name="contactEmail" type="email" defaultValue={value("contactEmail")} />}
          </Field>

          <Field id="contactPhone" label="Phone" error={error("contactPhone")}>
            {(props) => <Input {...props} name="contactPhone" type="tel" defaultValue={value("contactPhone")} />}
          </Field>

          <Field id="billingAddressLine1" label="Billing address" error={error("billingAddressLine1")} className="sm:col-span-2">
            {(props) => <Input {...props} name="billingAddressLine1" defaultValue={value("billingAddressLine1")} />}
          </Field>

          <Field id="billingCity" label="City" error={error("billingCity")}>
            {(props) => <Input {...props} name="billingCity" defaultValue={value("billingCity")} />}
          </Field>

          <Field id="billingPostalCode" label="Postal code" error={error("billingPostalCode")}>
            {(props) => <Input {...props} name="billingPostalCode" defaultValue={value("billingPostalCode")} />}
          </Field>

          <Field id="billingCountry" label="Country" error={error("billingCountry")}>
            {(props) => <Input {...props} name="billingCountry" defaultValue={value("billingCountry")} />}
          </Field>
        </div>

        <p className="mt-3 text-xs text-ink-muted">
          Card numbers, CVV and expiry dates are not collected. Payments are
          recorded against a provider transaction reference.
        </p>
      </Panel>

      <Panel title="Accounting information" defaultOpen={false}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="currency" label="Currency" required error={error("currency")}>
            {(props) => (
              <Select {...props} name="currency" defaultValue={value("currency", options.defaultCurrency)}>
                {options.currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="baseFare" label="Cruise fare" error={error("baseFare")}>
            {(props) => <Input {...props} name="baseFare" inputMode="decimal" placeholder="0.00" defaultValue={value("baseFare")} />}
          </Field>

          <Field id="taxesFees" label="Taxes and port fees" error={error("taxesFees")}>
            {(props) => <Input {...props} name="taxesFees" inputMode="decimal" placeholder="0.00" defaultValue={value("taxesFees")} />}
          </Field>

          <Field id="total" label="Total booking amount" error={error("total")}>
            {(props) => <Input {...props} name="total" inputMode="decimal" placeholder="0.00" defaultValue={value("total")} />}
          </Field>

          <Field id="supplierCost" label="Supplier cost" error={error("supplierCost")}>
            {(props) => <Input {...props} name="supplierCost" inputMode="decimal" placeholder="0.00" defaultValue={value("supplierCost")} />}
          </Field>

          <Field id="grossMco" label="Gross MCO" error={error("grossMco")}>
            {(props) => <Input {...props} name="grossMco" inputMode="decimal" placeholder="0.00" defaultValue={value("grossMco")} />}
          </Field>

          <Field id="netMco" label="Net MCO" error={error("netMco")}>
            {(props) => <Input {...props} name="netMco" inputMode="decimal" placeholder="0.00" defaultValue={value("netMco")} />}
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

          <Field id="mcoStatus" label="MCO status" error={error("mcoStatus")}>
            {(props) => (
              <Select {...props} name="mcoStatus" defaultValue={value("mcoStatus", McoStatus.NOT_APPLICABLE)}>
                {Object.values(McoStatus).map((status) => (
                  <option key={status} value={status}>
                    {humanise(status)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="financialNotes" label="Financial notes" error={error("financialNotes")} className="sm:col-span-2 lg:col-span-3">
            {(props) => <Textarea {...props} name="financialNotes" rows={3} defaultValue={value("financialNotes")} />}
          </Field>
        </div>
      </Panel>

      <Panel title="Comments and follow-up" defaultOpen={false}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="comment" label="Internal note" error={error("comment")} className="sm:col-span-2">
            {(props) => <Textarea {...props} name="comment" rows={3} defaultValue={value("comment")} />}
          </Field>

          <Field id="followUpAt" label="Follow-up date" error={error("followUpAt")}>
            {(props) => <Input {...props} name="followUpAt" type="date" defaultValue={value("followUpAt")} />}
          </Field>
        </div>
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
