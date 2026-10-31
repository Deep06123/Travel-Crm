"use client";

import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StickySelect } from "@/components/ui/sticky-select";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  CardType,
  ChargeOutcome,
  PassengerType,
} from "@/generated/prisma/enums";

import {
  updateBookingBillingAction,
  updateBookingOverviewAction,
  updateBookingTravellersAction,
  updateCruiseDetailAction,
  type BookingEditState,
} from "./edit-actions";

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Saving…" : label}
    </Button>
  );
}

export interface EditOption {
  id: string;
  name: string;
}

/**
 * A panel that can be corrected, with the control in its heading.
 *
 * The panel reads exactly as it always did; the Edit button sits in the
 * header bar beside the collapse control, and the fields appear underneath
 * the values they change. What is on screen above does not disappear while
 * the correction is made, which matters when the correction is to one field
 * out of twenty and the rest are the reference for getting it right.
 *
 * `canEdit` renders the plain panel rather than nothing, so a role without
 * `booking.update` sees the booking exactly as before — one panel, no button.
 */
function EditablePanel({
  title,
  description,
  defaultOpen = true,
  collapsible = true,
  canEdit,
  bookingId,
  action,
  submitLabel,
  children,
  fields,
}: {
  title: string;
  description?: string | undefined;
  defaultOpen?: boolean;
  collapsible?: boolean;
  canEdit: boolean;
  bookingId: string;
  action: (
    state: BookingEditState,
    formData: FormData,
  ) => Promise<BookingEditState>;
  submitLabel: string;
  /** What the panel reads as when it is not being edited. */
  children: ReactNode;
  fields: (error: (field: string) => string | undefined) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState<BookingEditState, FormData>(
    action,
    {},
  );

  const error = (field: string) => state.fieldErrors?.[field];

  if (!canEdit) {
    return (
      <Panel
        title={title}
        description={description}
        defaultOpen={defaultOpen}
        collapsible={collapsible}
      >
        {children}
      </Panel>
    );
  }

  return (
    <Panel
      // Remounted when editing starts so a panel that was collapsed opens
      // with its own fields, rather than putting them behind a closed
      // section the operator has to think to expand. The action state lives
      // outside this, so the message from the last save survives.
      key={editing ? "editing" : "idle"}
      title={title}
      description={description}
      defaultOpen={editing ? true : defaultOpen}
      collapsible={collapsible}
      actions={
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          aria-expanded={editing}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-navy-100 hover:bg-navy-600 hover:text-white"
        >
          {editing ? <X className="size-4" /> : <Pencil className="size-4" />}
          {editing ? "Close" : "Edit"}
          <span className="sr-only">
            {editing ? `Stop editing ${title}` : `Edit ${title}`}
          </span>
        </button>
      }
    >
      {state.error ? (
        <p
          role="alert"
          className="mb-3 rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
        >
          {state.error}
        </p>
      ) : null}

      {state.success ? (
        <p
          role="status"
          className="mb-3 rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success"
        >
          {state.success}
        </p>
      ) : null}

      {children}

      {editing ? (
        <form action={formAction} className="mt-4 border-t border-line pt-4">
          <input type="hidden" name="bookingId" value={bookingId} />

          {fields(error)}

          <div className="mt-3 flex items-center gap-3">
            <SubmitButton label={submitLabel} />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <p className="text-xs text-ink-subtle">
              A field left blank is cleared. Every change is written to the
              audit log.
            </p>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}

const GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

// --- Overview ---------------------------------------------------------------

export interface OverviewValues {
  bookingTypeId: string;
  chargeOutcome: string;
  source: string;
  language: string;
  assignedAgentId: string;
  supplierId: string;
  /** "YYYY-MM-DD" for the date input. */
  bookedAt: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

export function OverviewPanel({
  bookingId,
  canEdit,
  values,
  bookingTypes,
  agents,
  suppliers,
  children,
}: {
  bookingId: string;
  canEdit: boolean;
  values: OverviewValues;
  bookingTypes: EditOption[];
  agents: EditOption[];
  suppliers: EditOption[];
  children: ReactNode;
}) {
  return (
    <EditablePanel
      title="Overview"
      collapsible={false}
      canEdit={canEdit}
      bookingId={bookingId}
      action={updateBookingOverviewAction}
      submitLabel="Save overview"
      fields={(error) => (
        <div className={GRID}>
          <Field id="edit-bookingTypeId" label="Booking type" error={error("bookingTypeId")}>
            {(props) => (
              <StickySelect {...props} name="bookingTypeId" defaultValue={values.bookingTypeId}>
                <option value="">— None —</option>
                {bookingTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field id="edit-chargeOutcome" label="Charge outcome" error={error("chargeOutcome")}>
            {(props) => (
              <StickySelect {...props} name="chargeOutcome" defaultValue={values.chargeOutcome}>
                {Object.values(ChargeOutcome).map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {humanise(outcome)}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field id="edit-source" label="Source" error={error("source")}>
            {(props) => <Input {...props} name="source" defaultValue={values.source} />}
          </Field>

          <Field id="edit-language" label="Language" error={error("language")}>
            {(props) => (
              <StickySelect {...props} name="language" defaultValue={values.language}>
                <option value="">— None —</option>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
              </StickySelect>
            )}
          </Field>

          <Field
            id="edit-bookedAt"
            label="Booked"
            hint="Left blank, the booking date is kept as it is."
            error={error("bookedAt")}
          >
            {(props) => (
              <Input {...props} name="bookedAt" type="date" defaultValue={values.bookedAt} />
            )}
          </Field>

          <Field id="edit-assignedAgentId" label="Assigned agent" error={error("assignedAgentId")}>
            {(props) => (
              <StickySelect {...props} name="assignedAgentId" defaultValue={values.assignedAgentId}>
                <option value="">— Unassigned —</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field id="edit-supplierId" label="Supplier" error={error("supplierId")}>
            {(props) => (
              <StickySelect {...props} name="supplierId" defaultValue={values.supplierId}>
                <option value="">— None —</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </StickySelect>
            )}
          </Field>

          <Field id="edit-contactName" label="Contact" error={error("contactName")}>
            {(props) => <Input {...props} name="contactName" defaultValue={values.contactName} />}
          </Field>

          <Field id="edit-contactEmail" label="Email" error={error("contactEmail")}>
            {(props) => (
              <Input {...props} name="contactEmail" type="email" defaultValue={values.contactEmail} />
            )}
          </Field>

          <Field id="edit-contactPhone" label="Phone" error={error("contactPhone")}>
            {(props) => <Input {...props} name="contactPhone" defaultValue={values.contactPhone} />}
          </Field>
        </div>
      )}
    >
      {children}
    </EditablePanel>
  );
}

// --- Billing information ----------------------------------------------------

export interface BillingValues {
  cardHolderName: string;
  cardType: string;
  cardLast4: string;
  cardExpiry: string;
  inboundPhone: string;
  billingPhone: string;
  billingEmails: string;
  billingAddressLine1: string;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
  billingCountry: string;
}

export function BillingPanel({
  bookingId,
  canEdit,
  values,
  children,
}: {
  bookingId: string;
  canEdit: boolean;
  values: BillingValues;
  children: ReactNode;
}) {
  return (
    <EditablePanel
      title="Billing information"
      defaultOpen={false}
      canEdit={canEdit}
      bookingId={bookingId}
      action={updateBookingBillingAction}
      submitLabel="Save billing information"
      fields={(error) => (
        <>
          <div className={GRID}>
            <Field id="edit-cardHolderName" label="Card holder" error={error("cardHolderName")}>
              {(props) => (
                <Input {...props} name="cardHolderName" defaultValue={values.cardHolderName} />
              )}
            </Field>

            <Field id="edit-cardType" label="Card type" error={error("cardType")}>
              {(props) => (
                <StickySelect {...props} name="cardType" defaultValue={values.cardType}>
                  <option value="">— None —</option>
                  {Object.values(CardType).map((type) => (
                    <option key={type} value={type}>
                      {humanise(type)}
                    </option>
                  ))}
                </StickySelect>
              )}
            </Field>

            <Field
              id="edit-cardLast4"
              label="Last 4"
              hint="The last four digits only — the full number is never stored."
              error={error("cardLast4")}
            >
              {(props) => (
                <Input
                  {...props}
                  name="cardLast4"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  defaultValue={values.cardLast4}
                />
              )}
            </Field>

            <Field
              id="edit-cardExpiry"
              label="Expires"
              hint="MMYY, e.g. 0428."
              error={error("cardExpiry")}
            >
              {(props) => (
                <Input
                  {...props}
                  name="cardExpiry"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  defaultValue={values.cardExpiry}
                />
              )}
            </Field>

            <Field id="edit-inboundPhone" label="Inbound no." error={error("inboundPhone")}>
              {(props) => (
                <Input {...props} name="inboundPhone" defaultValue={values.inboundPhone} />
              )}
            </Field>

            <Field id="edit-billingPhone" label="Billing no." error={error("billingPhone")}>
              {(props) => (
                <Input {...props} name="billingPhone" defaultValue={values.billingPhone} />
              )}
            </Field>

            <Field
              id="edit-billingEmails"
              label="Email IDs"
              hint="Separate several with commas."
              error={error("billingEmails")}
              className="sm:col-span-2"
            >
              {(props) => (
                <Input {...props} name="billingEmails" defaultValue={values.billingEmails} />
              )}
            </Field>

            <Field
              id="edit-billingAddressLine1"
              label="Billing address"
              error={error("billingAddressLine1")}
              className="sm:col-span-2 lg:col-span-3"
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="billingAddressLine1"
                  rows={2}
                  defaultValue={values.billingAddressLine1}
                />
              )}
            </Field>

            <Field id="edit-billingCity" label="City" error={error("billingCity")}>
              {(props) => <Input {...props} name="billingCity" defaultValue={values.billingCity} />}
            </Field>

            <Field id="edit-billingState" label="State" error={error("billingState")}>
              {(props) => (
                <Input {...props} name="billingState" defaultValue={values.billingState} />
              )}
            </Field>

            <Field id="edit-billingPostalCode" label="Zip code" error={error("billingPostalCode")}>
              {(props) => (
                <Input {...props} name="billingPostalCode" defaultValue={values.billingPostalCode} />
              )}
            </Field>

            <Field id="edit-billingCountry" label="Country" error={error("billingCountry")}>
              {(props) => (
                <Input {...props} name="billingCountry" defaultValue={values.billingCountry} />
              )}
            </Field>
          </div>

          <p className="mt-3 text-xs text-ink-subtle">
            There is no card number or CVV here, and there never will be:
            neither is submitted to the server, stored or written to the audit
            log anywhere in this application.
          </p>
        </>
      )}
    >
      {children}
    </EditablePanel>
  );
}

// --- Sailing ----------------------------------------------------------------

export interface SailingValues {
  cruiseLine: string;
  ship: string;
  reservationNumber: string;
  sailingName: string;
  specialRequest: string;
  departurePort: string;
  arrivalPort: string;
  sailDate: string;
  returnDate: string;
  nights: string;
  deckNumber: string;
  cabinNumber: string;
  cabinCategory: string;
  cabinCount: string;
  diningPreference: string;
  gratuitiesIncluded: boolean;
  insuranceIncluded: boolean;
  assistanceNotes: string;
  itineraryHtml: string;
}

export function SailingPanel({
  bookingId,
  canEdit,
  values,
  children,
}: {
  bookingId: string;
  canEdit: boolean;
  values: SailingValues;
  children: ReactNode;
}) {
  return (
    <EditablePanel
      title="Sailing"
      collapsible={false}
      canEdit={canEdit}
      bookingId={bookingId}
      action={updateCruiseDetailAction}
      submitLabel="Save sailing"
      fields={(error) => (
        <>
          <div className={GRID}>
            <Field id="edit-cruiseLine" label="Cruise line" required error={error("cruiseLine")}>
              {(props) => (
                <Input {...props} name="cruiseLine" defaultValue={values.cruiseLine} />
              )}
            </Field>

            <Field id="edit-ship" label="Ship" error={error("ship")}>
              {(props) => <Input {...props} name="ship" defaultValue={values.ship} />}
            </Field>

            <Field
              id="edit-reservationNumber"
              label="Reservation no."
              error={error("reservationNumber")}
            >
              {(props) => (
                <Input {...props} name="reservationNumber" defaultValue={values.reservationNumber} />
              )}
            </Field>

            <Field
              id="edit-sailingName"
              label="Sailing"
              error={error("sailingName")}
              className="sm:col-span-2"
            >
              {(props) => (
                <Input {...props} name="sailingName" defaultValue={values.sailingName} />
              )}
            </Field>

            <Field id="edit-specialRequest" label="Special request" error={error("specialRequest")}>
              {(props) => (
                <Input {...props} name="specialRequest" defaultValue={values.specialRequest} />
              )}
            </Field>

            <Field id="edit-departurePort" label="Departs from" error={error("departurePort")}>
              {(props) => (
                <Input {...props} name="departurePort" defaultValue={values.departurePort} />
              )}
            </Field>

            <Field id="edit-arrivalPort" label="Arrives at" error={error("arrivalPort")}>
              {(props) => (
                <Input {...props} name="arrivalPort" defaultValue={values.arrivalPort} />
              )}
            </Field>

            <Field id="edit-nights" label="Nights" error={error("nights")}>
              {(props) => (
                <Input {...props} name="nights" inputMode="numeric" defaultValue={values.nights} />
              )}
            </Field>

            <Field id="edit-sailDate" label="Sail date" error={error("sailDate")}>
              {(props) => (
                <Input {...props} name="sailDate" type="date" defaultValue={values.sailDate} />
              )}
            </Field>

            <Field
              id="edit-returnDate"
              label="Return date"
              hint="Must not be before the sailing date."
              error={error("returnDate")}
            >
              {(props) => (
                <Input {...props} name="returnDate" type="date" defaultValue={values.returnDate} />
              )}
            </Field>

            <Field id="edit-deckNumber" label="Deck" error={error("deckNumber")}>
              {(props) => <Input {...props} name="deckNumber" defaultValue={values.deckNumber} />}
            </Field>

            <Field id="edit-cabinNumber" label="Cabin" error={error("cabinNumber")}>
              {(props) => <Input {...props} name="cabinNumber" defaultValue={values.cabinNumber} />}
            </Field>

            <Field id="edit-cabinCategory" label="Cabin category" error={error("cabinCategory")}>
              {(props) => (
                <Input {...props} name="cabinCategory" defaultValue={values.cabinCategory} />
              )}
            </Field>

            <Field id="edit-cabinCount" label="Cabins held" error={error("cabinCount")}>
              {(props) => (
                <Input
                  {...props}
                  name="cabinCount"
                  inputMode="numeric"
                  defaultValue={values.cabinCount}
                />
              )}
            </Field>

            <Field id="edit-diningPreference" label="Dining" error={error("diningPreference")}>
              {(props) => (
                <Input {...props} name="diningPreference" defaultValue={values.diningPreference} />
              )}
            </Field>

            <Field
              id="edit-gratuitiesIncluded"
              label="Gratuities"
              error={error("gratuitiesIncluded")}
            >
              {(props) => (
                <StickySelect
                  {...props}
                  name="gratuitiesIncluded"
                  defaultValue={values.gratuitiesIncluded ? "true" : "false"}
                >
                  <option value="false">Not included</option>
                  <option value="true">Included</option>
                </StickySelect>
              )}
            </Field>

            <Field
              id="edit-insuranceIncluded"
              label="Insurance"
              error={error("insuranceIncluded")}
            >
              {(props) => (
                <StickySelect
                  {...props}
                  name="insuranceIncluded"
                  defaultValue={values.insuranceIncluded ? "true" : "false"}
                >
                  <option value="false">Not included</option>
                  <option value="true">Included</option>
                </StickySelect>
              )}
            </Field>

            <Field
              id="edit-assistanceNotes"
              label="Special assistance"
              error={error("assistanceNotes")}
              className="sm:col-span-2 lg:col-span-3"
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="assistanceNotes"
                  rows={2}
                  defaultValue={values.assistanceNotes}
                />
              )}
            </Field>
          </div>

          <div className="mt-3">
            <Field
              id="edit-itineraryHtml"
              label="Itinerary"
              hint="Formatting is kept; scripts, embedded frames and images from other sites are removed when saved."
            >
              {() => (
                <RichTextEditor
                  name="itineraryHtml"
                  defaultValue={values.itineraryHtml}
                  placeholder="Type or paste the itinerary…"
                />
              )}
            </Field>
          </div>
        </>
      )}
    >
      {children}
    </EditablePanel>
  );
}

// --- Guests and passengers --------------------------------------------------

export interface TravellerValues {
  id: string;
  title: string;
  firstName: string;
  middleName: string;
  lastName: string;
  type: string;
  gender: string;
  dateOfBirth: string;
  passportNumber: string;
  passportCountry: string;
  passportExpiry: string;
  cabinNumber: string;
  notes: string;
}

function emptyTraveller(): TravellerValues {
  return {
    id: "",
    title: "",
    firstName: "",
    middleName: "",
    lastName: "",
    type: PassengerType.ADULT,
    gender: "",
    dateOfBirth: "",
    passportNumber: "",
    passportCountry: "",
    passportExpiry: "",
    cabinNumber: "",
    notes: "",
  };
}

export function TravellersPanel({
  bookingId,
  canEdit,
  travellers,
  isCruise,
  canEditSensitive,
  description,
  children,
}: {
  bookingId: string;
  canEdit: boolean;
  travellers: TravellerValues[];
  isCruise: boolean;
  /** Passport details and dates of birth are hidden, and left alone, without it. */
  canEditSensitive: boolean;
  description?: string | undefined;
  children: ReactNode;
}) {
  const noun = isCruise ? "guest" : "passenger";

  const [rows, setRows] = useState<{ key: number; values: TravellerValues }[]>(
    () =>
      travellers.length > 0
        ? travellers.map((values, index) => ({ key: index, values }))
        : [{ key: 0, values: emptyTraveller() }],
  );
  const [nextKey, setNextKey] = useState(() => Math.max(rows.length, 1));

  const addRow = () => {
    setRows((current) => [
      ...current,
      { key: nextKey, values: emptyTraveller() },
    ]);
    setNextKey((key) => key + 1);
  };

  const removeRow = (key: number) =>
    setRows((current) =>
      current.length <= 1 ? current : current.filter((row) => row.key !== key),
    );

  return (
    <EditablePanel
      title={isCruise ? "Guests" : "Passengers"}
      description={description}
      collapsible={false}
      canEdit={canEdit}
      bookingId={bookingId}
      action={updateBookingTravellersAction}
      submitLabel={`Save ${noun}s`}
      fields={(error) => (
        <>
          <div className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const field = (key: string) => `travellers.${index}.${key}`;
              const values = row.values;

              return (
                <div
                  key={row.key}
                  className="rounded-md border border-line bg-surface-muted/50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold tracking-wider text-ink-muted uppercase">
                      {noun} {index + 1}
                    </span>
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeRow(row.key)}
                        className="rounded p-1 text-ink-muted hover:bg-status-danger-bg hover:text-status-danger"
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">
                          Remove {noun} {index + 1}
                        </span>
                      </button>
                    ) : null}
                  </div>

                  {/* Carries the existing row through, so a correction edits
                      the traveller rather than replacing them. */}
                  <input type="hidden" name={field("id")} value={values.id} />

                  <div className={GRID}>
                    <Field
                      id={field("firstName")}
                      label="First name"
                      required
                      error={error(field("firstName"))}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          name={field("firstName")}
                          defaultValue={values.firstName}
                        />
                      )}
                    </Field>

                    <Field
                      id={field("middleName")}
                      label="Middle name"
                      error={error(field("middleName"))}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          name={field("middleName")}
                          defaultValue={values.middleName}
                        />
                      )}
                    </Field>

                    <Field
                      id={field("lastName")}
                      label="Last name"
                      required
                      error={error(field("lastName"))}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          name={field("lastName")}
                          defaultValue={values.lastName}
                        />
                      )}
                    </Field>

                    <Field id={field("type")} label="Type" error={error(field("type"))}>
                      {(props) => (
                        <StickySelect
                          {...props}
                          name={field("type")}
                          defaultValue={values.type}
                        >
                          {Object.values(PassengerType).map((type) => (
                            <option key={type} value={type}>
                              {humanise(type)}
                            </option>
                          ))}
                        </StickySelect>
                      )}
                    </Field>

                    <Field id={field("gender")} label="Gender" error={error(field("gender"))}>
                      {(props) => (
                        <StickySelect
                          {...props}
                          name={field("gender")}
                          defaultValue={values.gender}
                        >
                          <option value="">— Select —</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </StickySelect>
                      )}
                    </Field>

                    {isCruise ? (
                      <Field
                        id={field("cabinNumber")}
                        label="Cabin"
                        error={error(field("cabinNumber"))}
                      >
                        {(props) => (
                          <Input
                            {...props}
                            name={field("cabinNumber")}
                            defaultValue={values.cabinNumber}
                          />
                        )}
                      </Field>
                    ) : null}

                    {canEditSensitive ? (
                      <>
                        <Field
                          id={field("dateOfBirth")}
                          label="Date of birth"
                          error={error(field("dateOfBirth"))}
                        >
                          {(props) => (
                            <Input
                              {...props}
                              name={field("dateOfBirth")}
                              type="date"
                              defaultValue={values.dateOfBirth}
                            />
                          )}
                        </Field>

                        <Field
                          id={field("passportNumber")}
                          label="Passport no."
                          error={error(field("passportNumber"))}
                        >
                          {(props) => (
                            <Input
                              {...props}
                              name={field("passportNumber")}
                              defaultValue={values.passportNumber}
                            />
                          )}
                        </Field>

                        <Field
                          id={field("passportCountry")}
                          label="Passport country"
                          error={error(field("passportCountry"))}
                        >
                          {(props) => (
                            <Input
                              {...props}
                              name={field("passportCountry")}
                              defaultValue={values.passportCountry}
                            />
                          )}
                        </Field>

                        <Field
                          id={field("passportExpiry")}
                          label="Passport expiry"
                          error={error(field("passportExpiry"))}
                        >
                          {(props) => (
                            <Input
                              {...props}
                              name={field("passportExpiry")}
                              type="date"
                              defaultValue={values.passportExpiry}
                            />
                          )}
                        </Field>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={addRow}
          >
            <Plus />
            Add {noun}
          </Button>

          {canEditSensitive ? null : (
            <p className="mt-2 text-xs text-ink-subtle">
              Passport details and dates of birth are hidden for your role, and
              are left exactly as they are when this is saved.
            </p>
          )}
        </>
      )}
    >
      {children}
    </EditablePanel>
  );
}
