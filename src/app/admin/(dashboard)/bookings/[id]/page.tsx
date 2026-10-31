import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Eye, Info } from "lucide-react";

import { PageHeader } from "@/components/layout/admin-shell";
import {
  EmptyState,
  TableShell,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/tables/data-table";
import { Card, Panel } from "@/components/ui/panel";
import { RichText } from "@/components/ui/rich-text";
import {
  Badge,
  BookingStatusBadge,
  FollowUpStatusBadge,
  McoStatusBadge,
  PriorityBadge,
  TicketStatusBadge,
} from "@/components/ui/status-badge";
import { CommentVisibility, DocumentOrigin } from "@/generated/prisma/enums";
import { CommentForm, FollowUpForm } from "@/features/bookings/comment-form";
import { DOCUMENTS_FAILED_PARAM } from "@/features/bookings/document-attachments.constants";
import { DocumentUploadForm } from "@/features/documents/upload-form";
import { AuthorizationPanel } from "@/features/bookings/authorization-panel";
import { CustomerEmailPanel } from "@/features/bookings/customer-email-panel";
import { SendETicketButton } from "@/features/bookings/send-eticket-button";
import { McoControl } from "@/features/bookings/mco-control";
import { StatusControl } from "@/features/bookings/status-control";
import { TicketingControl } from "@/features/bookings/ticketing-control";
import { TicketingReferencesForm } from "@/features/bookings/ticketing-references-form";
import { BookingFinancialsForm } from "@/features/bookings/booking-financials-form";
import {
  BillingPanel,
  OverviewPanel,
  SailingPanel,
  TravellersPanel,
} from "@/features/bookings/booking-edit-forms";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import {
  allowedMcoTransitionsFrom,
  mcoSupplierIsSettled,
} from "@/lib/bookings/mco";
import { allowedTransitionsFrom } from "@/lib/bookings/status";
import { prisma } from "@/lib/db/prisma";
import { formatMoney, minorToDecimalString } from "@/lib/financial/money";
import {
  formatCalendarDate,
  formatDate,
  formatDateTime,
  fullName,
  isOverdue,
  toCalendarInputValue,
} from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getBookingDetail,
  redactPassengers,
} from "@/server/services/booking-service";
import { getBookingSignatures } from "@/server/services/booking-signature-service";
import { getBookingPosition } from "@/server/services/payment-service";
import {
  BOOKING_CONFIRMED,
  BOOKING_TICKETED,
  getBookingNotifications,
} from "@/server/services/customer-email-service";
import { IN_FLIGHT_REFUND_STATUSES } from "@/lib/financial/refund-rules";

export const metadata: Metadata = { title: "Booking · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * The options a picker offers, plus whatever the booking already points at.
 *
 * Only active types, agents and suppliers are listed, which is right for a new
 * choice and wrong for an existing one: a booking assigned to someone who has
 * since left would show an empty picker, and saving the panel for an unrelated
 * reason would quietly unassign them.
 */
function withCurrent(
  options: { id: string; name: string }[],
  current: { id: string; name: string } | null,
): { id: string; name: string }[] {
  if (!current || options.some((option) => option.id === current.id)) {
    return options;
  }

  return [...options, current];
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <dt className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm text-ink">{value || "—"}</dd>
    </div>
  );
}

export default async function BookingDetailPage({
  params,
  searchParams,
}: PageProps<"/admin/bookings/[id]">) {
  await requirePermission(PERMISSIONS.BOOKING_VIEW);

  // Set by the create action when a file chosen on the booking form failed to
  // store; see `features/bookings/document-attachments.ts`.
  const rawDocumentsFailed = (await searchParams)[DOCUMENTS_FAILED_PARAM];
  const documentsFailed =
    typeof rawDocumentsFailed === "string" && /^\d+$/.test(rawDocumentsFailed)
      ? Number(rawDocumentsFailed)
      : 0;

  const [
    canChangeStatus,
    canViewSensitive,
    canViewPayments,
    canComment,
    canManageFollowUps,
    canViewDocuments,
    canUploadDocuments,
    canResendEmail,
    canUpdateBooking,
    canUpdateMco,
    canSendAuthorization,
  ] = await Promise.all([
    currentUserCan(PERMISSIONS.BOOKING_CHANGE_STATUS),
    currentUserCan(PERMISSIONS.PASSENGER_VIEW_SENSITIVE),
    currentUserCan(PERMISSIONS.PAYMENT_VIEW),
    currentUserCan(PERMISSIONS.COMMENT_CREATE),
    currentUserCan(PERMISSIONS.FOLLOW_UP_MANAGE),
    currentUserCan(PERMISSIONS.DOCUMENT_VIEW),
    currentUserCan(PERMISSIONS.DOCUMENT_UPLOAD),
    currentUserCan(PERMISSIONS.MESSAGE_SEND),
    currentUserCan(PERMISSIONS.BOOKING_UPDATE),
    currentUserCan(PERMISSIONS.BOOKING_MCO_UPDATE),
    currentUserCan(PERMISSIONS.BOOKING_SIGNATURE_SEND),
  ]);

  const { id } = await params;
  const booking = await getBookingDetail(id);
  if (!booking) notFound();

  // Restricted traveller detail is removed here, before render, so it is never
  // present in the HTML sent to an unauthorised role.
  const passengers = canViewSensitive
    ? booking.passengers
    : redactPassengers(booking.passengers);

  // Only the active ones are offered. A booking already pointing at a retired
  // supplier keeps it — the control shows that separately rather than letting
  // the field read as empty.
  const mcoSuppliers = canUpdateMco
    ? await prisma.mcoSupplier.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  // Needed by the follow-up assignee picker and by the overview editor, so
  // loaded when either is on screen rather than once per feature.
  const agents =
    canManageFollowUps || canUpdateBooking
      ? await prisma.adminUser.findMany({
          where: { status: "ACTIVE" },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  // Only the editors need these, and only the active ones are offered. A
  // booking already pointing at a retired type or supplier keeps it: the
  // editor adds the stored one back to its list rather than quietly dropping
  // the value the next time the panel is saved.
  const [bookingTypes, suppliers] = canUpdateBooking
    ? await Promise.all([
        prisma.bookingType.findMany({
          where: { isActive: true },
          select: { id: true, label: true },
          orderBy: { label: "asc" },
        }),
        prisma.supplier.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  // Dates are formatted here rather than in the panel: the panel is a Client
  // Component, and `@/lib/format` reaches `@/lib/env`, which is server-only.
  const customerEmails = (await getBookingNotifications(booking.id)).map(
    (row) => ({
      id: row.id,
      eventType: row.eventType,
      status: row.status,
      recipient: row.recipient,
      sentAtLabel: row.sentAt ? formatDateTime(row.sentAt) : null,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
    }),
  );

  // Same reason as above: the panel is a Client Component, so the dates are
  // formatted here rather than there.
  const signatures = (await getBookingSignatures(booking.id)).map((row) => ({
    id: row.id,
    status: row.status,
    recipientEmail: row.recipientEmail,
    sentAtLabel: formatDateTime(row.sentAt),
    expiresAtLabel: formatDateTime(row.expiresAt),
    viewedAtLabel: row.viewedAt ? formatDateTime(row.viewedAt) : null,
    signedAtLabel: row.signedAt ? formatDateTime(row.signedAt) : null,
    signatureName: row.signatureName,
    signedPhone: row.signedPhone,
    consentText: row.consentText,
    ipAddress: row.ipAddress,
    device: row.device,
    operatingSystem: row.operatingSystem,
    browser: row.browser,
    screenSize: row.screenSize,
    clientTimezone: row.clientTimezone,
    geoCity: row.geoCity,
    geoRegion: row.geoRegion,
    geoCountry: row.geoCountry,
    sentBy: row.sentBy,
  }));

  const hasSignature = signatures.some((row) => row.status === "SIGNED");

  const emailRecipient =
    booking.contactEmail?.trim() || booking.customer.email?.trim() || "";

  // A resend is only offered for an event this booking has actually reached.
  // Offering "resend tickets issued" on an unticketed booking would promise
  // the customer something that has not happened.
  const resendableEvents = [
    ...(booking.status === "CONFIRMED" ||
    booking.status === "TICKETED" ||
    booking.status === "COMPLETED"
      ? [BOOKING_CONFIRMED]
      : []),
    ...(booking.status === "TICKETED" || booking.status === "COMPLETED"
      ? [BOOKING_TICKETED]
      : []),
  ];

  const margin = booking.totalMinor - booking.supplierCostMinor;

  const splitTotalMinor = booking.chargeSplits.reduce(
    (sum, split) => sum + split.amountMinor,
    0,
  );

  // Derived from the stored payment, refund, chargeback and adjustment rows —
  // never cached, so it cannot drift from what it summarises.
  //
  // Loaded regardless of `canViewPayments`: the ticketing panel needs the
  // balance to say why issuing is blocked, and an operator who may ticket but
  // may not read the payment ledger still has to be told. Only the formatted
  // shortfall reaches that panel; the rest of the position stays behind the
  // permission gate below.
  const position = await getBookingPosition(booking.id);

  const outstandingLabel =
    position && !position.isFullyPaid
      ? formatMoney(position.outstandingBalanceMinor, position.currency)
      : null;

  // Refunds already raised still lay claim to this money, so the ceiling shown
  // to the operator accounts for them.
  const inFlightRefundMinor = booking.refunds
    .filter((refund) =>
      (IN_FLIGHT_REFUND_STATUSES as readonly string[]).includes(refund.status),
    )
    .reduce((sum, refund) => sum + refund.requestedAmountMinor, 0);

  const availableToRefundMinor = Math.max(
    0,
    (position?.refundableAmountMinor ?? 0) - inFlightRefundMinor,
  );
  // A cruise is confirmed by the cruise line rather than ticketed by an
  // airline, so the ticketing panel and ticket-number column do not apply.
  const isCruise = booking.product === "CRUISE";

  return (
    <>
      <PageHeader
        title={booking.bookingNumber}
        description={
          <>
            {booking.product === "FLIGHT" ? "Flight" : "Cruise"} booking ·{" "}
            <Link
              href={`/admin/customers/${booking.customer.id}`}
              className="text-navy-500 hover:underline"
            >
              {booking.customer.firstName} {booking.customer.lastName}
            </Link>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <BookingStatusBadge status={booking.status} />
            {isCruise ? null : <TicketStatusBadge status={booking.ticketStatus} />}
            <PriorityBadge level={booking.priority} />
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Left column — the record itself */}
        <div className="flex flex-col gap-4 xl:col-span-2">
          <OverviewPanel
            bookingId={booking.id}
            canEdit={canUpdateBooking}
            bookingTypes={withCurrent(
              bookingTypes.map((type) => ({ id: type.id, name: type.label })),
              booking.bookingType
                ? { id: booking.bookingType.id, name: booking.bookingType.label }
                : null,
            )}
            agents={withCurrent(
              agents,
              booking.assignedAgent
                ? { id: booking.assignedAgent.id, name: booking.assignedAgent.name }
                : null,
            )}
            suppliers={withCurrent(
              suppliers,
              booking.supplier
                ? { id: booking.supplier.id, name: booking.supplier.name }
                : null,
            )}
            values={{
              bookingTypeId: booking.bookingType?.id ?? "",
              chargeOutcome: booking.chargeOutcome,
              source: booking.source ?? "",
              language: booking.language ?? "",
              assignedAgentId: booking.assignedAgent?.id ?? "",
              supplierId: booking.supplier?.id ?? "",
              bookedAt: toCalendarInputValue(booking.bookedAt),
              contactName: booking.contactName ?? "",
              contactEmail: booking.contactEmail ?? "",
              contactPhone: booking.contactPhone ?? "",
            }}
          >
            <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              <DetailRow label="Booking type" value={booking.bookingType?.label} />
              <DetailRow label="Charge outcome" value={humanise(booking.chargeOutcome)} />
              <DetailRow label="Source" value={booking.source} />
              <DetailRow label="Language" value={booking.language} />
              <DetailRow label="Booked" value={formatDateTime(booking.bookedAt)} />
              <DetailRow label="Created by" value={booking.createdBy?.name} />
              <DetailRow label="Assigned agent" value={booking.assignedAgent?.name} />
              <DetailRow label="Supplier" value={booking.supplier?.name} />
              {/* The MCO panel in the right column owns both of these for
                  anyone who can change them. Repeated here only for the roles
                  that cannot, who would otherwise not see them at all. */}
              {canUpdateMco ? null : (
                <>
                  <DetailRow
                    label="MCO supplier"
                    value={booking.mcoSupplier?.name}
                  />
                  <DetailRow
                    label="MCO status"
                    value={<McoStatusBadge status={booking.mcoStatus} />}
                  />
                </>
              )}
              <DetailRow label="Contact" value={booking.contactName} />
              <DetailRow label="Email" value={booking.contactEmail} />
              <DetailRow label="Phone" value={booking.contactPhone} />
            </dl>
          </OverviewPanel>

          {/* What was taken down at booking time, minus the parts that were
              never submitted. There is no card number or CVV to show because
              neither was ever sent to the server. */}
          <BillingPanel
            bookingId={booking.id}
            canEdit={canUpdateBooking}
            values={{
              cardHolderName: booking.cardHolderName ?? "",
              cardType: booking.cardType ?? "",
              cardLast4: booking.cardLast4 ?? "",
              cardExpiry: booking.cardExpiry ?? "",
              inboundPhone: booking.inboundPhone ?? "",
              billingPhone: booking.billingPhone ?? "",
              billingEmails: booking.billingEmails ?? "",
              billingAddressLine1: booking.billingAddressLine1 ?? "",
              billingCity: booking.billingCity ?? "",
              billingState: booking.billingState ?? "",
              billingPostalCode: booking.billingPostalCode ?? "",
              billingCountry: booking.billingCountry ?? "",
            }}
          >
            <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              <DetailRow label="Card holder" value={booking.cardHolderName} />
              <DetailRow
                label="Card"
                value={
                  booking.cardLast4
                    ? `${booking.cardType ? humanise(booking.cardType) : "Card"} ····${booking.cardLast4}`
                    : null
                }
              />
              <DetailRow
                label="Expires"
                value={
                  booking.cardExpiry
                    ? `${booking.cardExpiry.slice(0, 2)}/${booking.cardExpiry.slice(2)}`
                    : null
                }
              />
              <DetailRow label="Inbound no." value={booking.inboundPhone} />
              <DetailRow label="Billing no." value={booking.billingPhone} />
              <DetailRow label="Email IDs" value={booking.billingEmails} />
              <DetailRow
                label="Billing address"
                value={booking.billingAddressLine1}
              />
              <DetailRow label="City" value={booking.billingCity} />
              <DetailRow label="State" value={booking.billingState} />
              <DetailRow label="Zip code" value={booking.billingPostalCode} />
              <DetailRow label="Country" value={booking.billingCountry} />
            </dl>
          </BillingPanel>

          {booking.flightDetail ? (
            <Panel title="Itinerary" collapsible={false}>
              <dl className="mb-4 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
                <DetailRow label="PNR" value={booking.flightDetail.pnrLocator} />
                <DetailRow label="Airline" value={booking.flightDetail.airline} />
                <DetailRow
                  label="Route"
                  value={
                    booking.flightDetail.origin && booking.flightDetail.destination
                      ? `${booking.flightDetail.origin} → ${booking.flightDetail.destination}`
                      : null
                  }
                />
                <DetailRow
                  label="Class"
                  value={booking.flightDetail.bookingClass}
                />
                <DetailRow
                  label="Departure"
                  value={formatCalendarDate(booking.flightDetail.departureDate)}
                />
                <DetailRow
                  label="Return"
                  value={
                    booking.flightDetail.isRoundTrip
                      ? formatCalendarDate(booking.flightDetail.returnDate)
                      : "One way"
                  }
                />
              </dl>

              <TableShell>
                <Thead>
                  <Tr>
                    <Th>#</Th>
                    <Th>Flight</Th>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th>Departs</Th>
                    <Th>Arrives</Th>
                    <Th>Class</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {booking.segments.length === 0 ? (
                    <EmptyState
                      colSpan={7}
                      title="No segments recorded"
                      description="Flight segments are entered on the booking form."
                    />
                  ) : (
                    booking.segments.map((segment) => (
                      <Tr key={segment.id}>
                        <Td numeric>{segment.sequence}</Td>
                        <Td>
                          {segment.airline} {segment.flightNumber}
                        </Td>
                        <Td>{segment.origin}</Td>
                        <Td>{segment.destination}</Td>
                        <Td className="whitespace-nowrap">
                          {formatDateTime(segment.departureAt)}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {formatDateTime(segment.arrivalAt)}
                        </Td>
                        <Td className="text-ink-muted">{segment.bookingClass ?? "—"}</Td>
                      </Tr>
                    ))
                  )}
                </Tbody>
              </TableShell>

              {/* Composed in the same editor the cruise form uses, and until
                  now stored but never shown. */}
              {booking.flightDetail.itineraryHtml ? (
                <div className="mt-4">
                  <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                    Itinerary
                  </p>
                  <RichText
                    html={booking.flightDetail.itineraryHtml}
                    className="mt-1"
                  />
                </div>
              ) : null}

              {booking.flightDetail.pnrText ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-navy-500">
                    Raw PNR text
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-surface-sunken p-3 font-mono text-xs text-ink">
                    {booking.flightDetail.pnrText}
                  </pre>
                  <p className="mt-1 text-xs text-ink-muted">
                    Stored as pasted. No decoding was performed.
                  </p>
                </details>
              ) : null}
            </Panel>
          ) : null}

          {booking.cruiseDetail ? (
            <SailingPanel
              bookingId={booking.id}
              canEdit={canUpdateBooking}
              values={{
                cruiseLine: booking.cruiseDetail.cruiseLine,
                ship: booking.cruiseDetail.ship ?? "",
                reservationNumber: booking.cruiseDetail.reservationNumber ?? "",
                sailingName: booking.cruiseDetail.sailingName ?? "",
                specialRequest: booking.cruiseDetail.specialRequest ?? "",
                departurePort: booking.cruiseDetail.departurePort ?? "",
                arrivalPort: booking.cruiseDetail.arrivalPort ?? "",
                sailDate: toCalendarInputValue(booking.cruiseDetail.sailDate),
                returnDate: toCalendarInputValue(
                  booking.cruiseDetail.returnDate,
                ),
                nights: booking.cruiseDetail.nights?.toString() ?? "",
                deckNumber: booking.cruiseDetail.deckNumber ?? "",
                cabinNumber: booking.cruiseDetail.cabinNumber ?? "",
                cabinCategory: booking.cruiseDetail.cabinCategory ?? "",
                cabinCount: booking.cruiseDetail.cabinCount.toString(),
                diningPreference: booking.cruiseDetail.diningPreference ?? "",
                gratuitiesIncluded: booking.cruiseDetail.gratuitiesIncluded,
                insuranceIncluded: booking.cruiseDetail.insuranceIncluded,
                assistanceNotes: booking.cruiseDetail.assistanceNotes ?? "",
                itineraryHtml: booking.cruiseDetail.itineraryHtml ?? "",
              }}
            >
              <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
                <DetailRow label="Cruise line" value={booking.cruiseDetail.cruiseLine} />
                <DetailRow label="Ship" value={booking.cruiseDetail.ship} />
                <DetailRow
                  label="Reservation no."
                  value={booking.cruiseDetail.reservationNumber}
                />
                <DetailRow
                  label="Nights"
                  value={booking.cruiseDetail.nights?.toString()}
                />
                <DetailRow
                  label="Sailing"
                  value={booking.cruiseDetail.sailingName}
                />
                <DetailRow
                  label="Special request"
                  value={booking.cruiseDetail.specialRequest}
                />
                <DetailRow
                  label="Departs from"
                  value={booking.cruiseDetail.departurePort}
                />
                <DetailRow label="Arrives at" value={booking.cruiseDetail.arrivalPort} />
                <DetailRow
                  label="Sail date"
                  value={formatCalendarDate(booking.cruiseDetail.sailDate)}
                />
                <DetailRow
                  label="Return date"
                  value={formatCalendarDate(booking.cruiseDetail.returnDate)}
                />
                <DetailRow label="Deck" value={booking.cruiseDetail.deckNumber} />
                <DetailRow label="Cabin" value={booking.cruiseDetail.cabinNumber} />
                <DetailRow
                  label="Cabin category"
                  value={booking.cruiseDetail.cabinCategory}
                />
                <DetailRow
                  label="Cabins held"
                  value={booking.cruiseDetail.cabinCount.toString()}
                />
                <DetailRow
                  label="Dining"
                  value={booking.cruiseDetail.diningPreference}
                />
                <DetailRow
                  label="Gratuities"
                  value={booking.cruiseDetail.gratuitiesIncluded ? "Included" : "Not included"}
                />
                <DetailRow
                  label="Insurance"
                  value={booking.cruiseDetail.insuranceIncluded ? "Included" : "Not included"}
                />
              </dl>

              {/* The itinerary as it was composed. `itinerary` is the one-line
                  summary older records carry; the form no longer offers it, so
                  it is a fallback rather than a second thing to read. */}
              {booking.cruiseDetail.itineraryHtml ||
              booking.cruiseDetail.itinerary ? (
                <div className="mt-3">
                  <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                    Itinerary
                  </p>
                  {booking.cruiseDetail.itineraryHtml ? (
                    <RichText
                      html={booking.cruiseDetail.itineraryHtml}
                      className="mt-1"
                    />
                  ) : (
                    <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">
                      {booking.cruiseDetail.itinerary}
                    </p>
                  )}
                </div>
              ) : null}

              {booking.cruiseDetail.assistanceNotes ? (
                <p className="mt-3 rounded-md bg-surface-muted p-3 text-sm whitespace-pre-wrap text-ink">
                  {booking.cruiseDetail.assistanceNotes}
                </p>
              ) : null}

            </SailingPanel>
          ) : null}

          <TravellersPanel
            bookingId={booking.id}
            canEdit={canUpdateBooking}
            isCruise={isCruise}
            canEditSensitive={canViewSensitive}
            description={
              canViewSensitive
                ? undefined
                : "Passport details and dates of birth are hidden for your role."
            }
            travellers={booking.passengers.map((passenger) => ({
              id: passenger.id,
              title: passenger.title ?? "",
              firstName: passenger.firstName,
              middleName: passenger.middleName ?? "",
              lastName: passenger.lastName,
              type: passenger.type,
              gender: passenger.gender ?? "",
              // From the unredacted rows: a role that may not see these is
              // not shown them, and the service keeps what is stored.
              dateOfBirth: canViewSensitive
                ? toCalendarInputValue(passenger.dateOfBirth)
                : "",
              passportNumber: canViewSensitive
                ? (passenger.passportNumber ?? "")
                : "",
              passportCountry: canViewSensitive
                ? (passenger.passportCountry ?? "")
                : "",
              passportExpiry: canViewSensitive
                ? toCalendarInputValue(passenger.passportExpiry)
                : "",
              cabinNumber: passenger.cabinNumber ?? "",
              notes: passenger.notes ?? "",
            }))}
          >
            <TableShell>
              <Thead>
                <Tr>
                  <Th>#</Th>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  {canViewSensitive ? <Th>Date of birth</Th> : null}
                  {canViewSensitive ? <Th>Passport</Th> : null}
                  <Th>{isCruise ? "Cabin" : "Ticket no."}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {passengers.length === 0 ? (
                  <EmptyState colSpan={canViewSensitive ? 6 : 4} title="No passengers recorded" />
                ) : (
                  passengers.map((passenger) => (
                    <Tr key={passenger.id}>
                      <Td numeric>{passenger.sequence}</Td>
                      <Td>{fullName(passenger)}</Td>
                      <Td className="text-ink-muted">{humanise(passenger.type)}</Td>
                      {canViewSensitive ? (
                        <Td className="text-ink-muted">
                          {formatCalendarDate(passenger.dateOfBirth)}
                        </Td>
                      ) : null}
                      {canViewSensitive ? (
                        <Td className="text-ink-muted">
                          {passenger.passportNumber ?? "—"}
                        </Td>
                      ) : null}
                      <Td className="text-ink-muted">
                        {(isCruise ? passenger.cabinNumber : passenger.ticketNumber) ?? "—"}
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableShell>

          </TravellersPanel>

          {!isCruise ? (
          <Panel title="Ticketing" collapsible={false}>
            <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              <DetailRow
                label="Ticket status"
                value={<TicketStatusBadge status={booking.ticketStatus} />}
              />
              <DetailRow label="Airline confirmation" value={booking.airlineConfirmation} />
              <DetailRow label="Supplier reference" value={booking.ticketingReference} />
              <DetailRow label="Ticketed at" value={formatDateTime(booking.ticketedAt)} />
            </dl>
            {booking.ticketingNotes ? (
              <p className="mt-3 rounded-md bg-surface-muted p-3 text-sm whitespace-pre-wrap text-ink">
                {booking.ticketingNotes}
              </p>
            ) : null}

            {/* Before the issue form, because it is the thing that unblocks
                it: the gate reads `airlineConfirmation`, which until now could
                only be set when the booking was created — before the airline
                had sent one back. Hidden once issued, for the same reason the
                issue form is: the confirmation is the evidence the ticket was
                issued against, not something to revise afterwards. */}
            {canUpdateBooking && booking.ticketStatus !== "ISSUED" ? (
              <TicketingReferencesForm
                bookingId={booking.id}
                airlineConfirmation={booking.airlineConfirmation}
                ticketingReference={booking.ticketingReference}
              />
            ) : null}

            {/* Hidden once issued: re-issuing is a void-and-reissue, which is a
                different operation with its own consequences, not this form
                submitted twice. The service refuses it either way. */}
            {canUpdateBooking && booking.ticketStatus !== "ISSUED" ? (
              <TicketingControl
                bookingId={booking.id}
                outstandingLabel={outstandingLabel}
                passengers={booking.passengers.map((passenger) => ({
                  id: passenger.id,
                  fullName: fullName(passenger),
                  ticketNumber: passenger.ticketNumber,
                }))}
              />
            ) : null}
          </Panel>
          ) : null}

          {canViewPayments ? (
            <Panel title="Accounting" collapsible={false}>
              <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                <DetailRow label="Currency" value={booking.currency} />
                <DetailRow
                  label="Base fare"
                  value={formatMoney(booking.baseFareMinor, booking.currency)}
                />
                <DetailRow
                  label="Taxes and fees"
                  value={formatMoney(booking.taxesFeesMinor, booking.currency)}
                />
                <DetailRow
                  label="Gross booking value"
                  value={formatMoney(booking.totalMinor, booking.currency)}
                />
                <DetailRow
                  label="Supplier cost"
                  value={formatMoney(booking.supplierCostMinor, booking.currency)}
                />
                <DetailRow
                  label="Margin"
                  value={
                    <span
                      className={margin < 0 ? "text-status-danger" : undefined}
                    >
                      {formatMoney(margin, booking.currency)}
                    </span>
                  }
                />
                <DetailRow
                  label="Gross MCO"
                  value={formatMoney(booking.grossMcoMinor, booking.currency)}
                />
                <DetailRow
                  label="Net MCO"
                  value={formatMoney(booking.netMcoMinor, booking.currency)}
                />
                <DetailRow
                  label="Split charges"
                  value={booking.splitCharges ? "Yes" : "No"}
                />
              </dl>

              {/* The division itself, when there is one. A booking flagged as
                  split with no rows behind it is shown as exactly that, rather
                  than as an empty space that reads like nothing was split. */}
              {booking.splitCharges ? (
                <div className="mt-3">
                  <h3 className="mb-1 text-sm font-semibold text-ink">
                    How the total is split
                  </h3>
                  {booking.chargeSplits.length > 0 ? (
                    <TableShell>
                      <Thead>
                        <Tr>
                          <Th>Title</Th>
                          <Th align="right">Amount</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {booking.chargeSplits.map((split) => (
                          <Tr key={split.id}>
                            <Td>{split.title}</Td>
                            <Td align="right" numeric>
                              {formatMoney(split.amountMinor, booking.currency)}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </TableShell>
                  ) : (
                    <p className="text-sm text-ink-muted">
                      Marked as split, but the individual charges were never
                      recorded.
                    </p>
                  )}

                  {/* Said plainly rather than left to be added up by eye: a
                      split that no longer matches the booking value is the
                      thing worth noticing here. */}
                  {booking.chargeSplits.length > 0 ? (
                    <p className="mt-1 text-xs text-ink-muted">
                      {splitTotalMinor === booking.totalMinor
                        ? `These add up to ${formatMoney(splitTotalMinor, booking.currency)}, matching the gross booking value.`
                        : `These add up to ${formatMoney(splitTotalMinor, booking.currency)}, which does not match the gross booking value of ${formatMoney(booking.totalMinor, booking.currency)}.`}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {position ? (
                <>
                  <h3 className="mt-4 mb-1 text-sm font-semibold text-ink">
                    Position
                  </h3>
                  <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                    <DetailRow
                      label="Collected"
                      value={formatMoney(position.amountCollectedMinor, position.currency)}
                    />
                    <DetailRow
                      label="Refunded"
                      value={formatMoney(position.amountRefundedMinor, position.currency)}
                    />
                    <DetailRow
                      label="Net collected"
                      value={formatMoney(position.netCollectedMinor, position.currency)}
                    />
                    <DetailRow
                      label="Outstanding"
                      value={
                        <span
                          className={
                            position.outstandingBalanceMinor > 0
                              ? "font-medium text-status-warning"
                              : undefined
                          }
                        >
                          {formatMoney(
                            position.outstandingBalanceMinor,
                            position.currency,
                          )}
                        </span>
                      }
                    />
                    <DetailRow
                      label="Refundable"
                      value={formatMoney(availableToRefundMinor, position.currency)}
                    />
                    <DetailRow
                      label="Disputed"
                      value={formatMoney(position.amountDisputedMinor, position.currency)}
                    />
                  </dl>
                </>
              ) : null}

              <p className="mt-3 text-xs text-ink-muted">
                Gross booking value is what the customer is charged. Collected is
                what has actually been captured. The two are tracked separately
                and routinely differ.
              </p>

              {canUpdateBooking ? (
                <BookingFinancialsForm
                  bookingId={booking.id}
                  currency={booking.currency}
                  amounts={{
                    baseFare: minorToDecimalString(
                      booking.baseFareMinor,
                      booking.currency,
                    ),
                    taxesFees: minorToDecimalString(
                      booking.taxesFeesMinor,
                      booking.currency,
                    ),
                    total: minorToDecimalString(
                      booking.totalMinor,
                      booking.currency,
                    ),
                    supplierCost: minorToDecimalString(
                      booking.supplierCostMinor,
                      booking.currency,
                    ),
                    grossMco: minorToDecimalString(
                      booking.grossMcoMinor,
                      booking.currency,
                    ),
                    netMco: minorToDecimalString(
                      booking.netMcoMinor,
                      booking.currency,
                    ),
                  }}
                  splitCharges={booking.splitCharges}
                  splits={booking.chargeSplits.map((split) => ({
                    title: split.title,
                    amount: minorToDecimalString(
                      split.amountMinor,
                      booking.currency,
                    ),
                  }))}
                />
              ) : null}

              {booking.financialNotes ? (
                <p className="mt-3 rounded-md bg-surface-muted p-3 text-sm whitespace-pre-wrap text-ink">
                  {booking.financialNotes}
                </p>
              ) : null}
            </Panel>
          ) : null}

          <Panel
            title="Documents"
            defaultOpen={booking.documents.length > 0 || documentsFailed > 0}
          >
            {/* The booking was created but one of the files attached to the
                form did not store. Said here rather than on the form, which
                the operator has already been redirected away from. */}
            {documentsFailed > 0 ? (
              <p
                role="alert"
                className="mb-4 rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
              >
                {documentsFailed === 1
                  ? "One document could not be attached when the booking was created. Upload it again below."
                  : `${documentsFailed} documents could not be attached when the booking was created. Upload them again below.`}
              </p>
            ) : null}

            {booking.documents.length === 0 ? (
              <p className="text-sm text-ink-muted">No documents attached.</p>
            ) : (
              <ul className="mb-4 divide-y divide-line">
                {booking.documents.map((document) => (
                  <li key={document.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{document.title}</p>
                      <p className="text-xs text-ink-muted">
                        {humanise(document.category)} · {formatDate(document.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* A self-generated PDF is labelled as such; it is never
                          presented as something the provider issued. */}
                      {document.origin === DocumentOrigin.INTERNALLY_GENERATED ? (
                        <Badge tone="warning">Internally generated</Badge>
                      ) : null}
                      {canViewDocuments ? (
                        <a
                          href={`/api/admin/documents/${document.id}/view`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-navy-500"
                        >
                          <Eye className="size-4" />
                          <span className="sr-only">View {document.title}</span>
                        </a>
                      ) : null}
                      {/* `download=1` makes the same protected route send the
                          bytes as an attachment; a PDF the operator needs to
                          forward should not have to be re-saved out of the
                          browser's viewer. */}
                      {canViewDocuments ? (
                        <a
                          href={`/api/admin/documents/${document.id}/view?download=1`}
                          className="rounded p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-navy-500"
                        >
                          <Download className="size-4" />
                          <span className="sr-only">
                            Download {document.title}
                          </span>
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {canUploadDocuments ? (
              <div className="border-t border-line pt-4">
                <DocumentUploadForm bookingId={booking.id} />
              </div>
            ) : null}
          </Panel>
        </div>

        {/* Right column — actions and activity */}
        <div className="flex flex-col gap-4">
          {canChangeStatus ? (
            <Panel title="Status" collapsible={false}>
              <StatusControl
                bookingId={booking.id}
                currentStatus={booking.status}
                allowedStatuses={allowedTransitionsFrom(booking.status)}
              />
            </Panel>
          ) : null}

          {/* Owns the MCO status outright — the Overview panel shows only the
              supplier, so the status is not stated in two places that could
              disagree mid-render. Sits outside the `canViewPayments` gate: a
              role that can move the settlement forward should not also need
              permission to see the booking's money to do it. */}
          {canUpdateMco ? (
            <Panel title="MCO" collapsible={false}>
              <McoControl
                bookingId={booking.id}
                currentStatus={booking.mcoStatus}
                currentSupplierId={booking.mcoSupplier?.id ?? null}
                allowedStatuses={allowedMcoTransitionsFrom(booking.mcoStatus)}
                suppliers={mcoSuppliers}
                supplierLocked={mcoSupplierIsSettled(booking.mcoStatus)}
              />
            </Panel>
          ) : null}

          {/* Ahead of the e-ticket controls because it gates them: an agent
              reading down the column meets the authorization before the send
              button it governs. */}
          <Panel title="Customer authorization" collapsible={false}>
            <AuthorizationPanel
              bookingId={booking.id}
              rows={signatures}
              canSend={canSendAuthorization}
              recipient={emailRecipient}
            />

            <div className="mt-4 border-t border-line pt-4">
              {canResendEmail ? (
                <SendETicketButton
                  bookingId={booking.id}
                  recipient={emailRecipient}
                  viewHref={`/admin/bookings/${booking.id}/eticket`}
                  blockedReason={
                    hasSignature
                      ? undefined
                      : "The customer has not signed the authorization yet."
                  }
                />
              ) : (
                <p className="text-xs text-ink-subtle">
                  Sending the e-ticket requires the message.send permission.
                </p>
              )}
            </div>
          </Panel>

          <Panel title="Customer email" collapsible={false}>
            <CustomerEmailPanel
              bookingId={booking.id}
              rows={customerEmails}
              canResend={canResendEmail}
              availableEvents={resendableEvents}
            />
          </Panel>

          <Panel title="Follow-ups" collapsible={false}>
            {booking.followUps.length === 0 ? (
              <p className="mb-3 text-sm text-ink-muted">No follow-ups.</p>
            ) : (
              <ul className="mb-4 divide-y divide-line">
                {booking.followUps.map((followUp) => {
                  const overdue =
                    followUp.status === "OPEN" && isOverdue(followUp.dueAt);

                  return (
                    <li key={followUp.id} className="py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-ink">{followUp.reason}</p>
                        <FollowUpStatusBadge status={followUp.status} />
                      </div>
                      <p
                        className={
                          overdue
                            ? "text-xs font-medium text-status-danger"
                            : "text-xs text-ink-muted"
                        }
                      >
                        Due {formatCalendarDate(followUp.dueAt)}
                        {followUp.assignee ? ` · ${followUp.assignee.name}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}

            {canManageFollowUps ? (
              <FollowUpForm bookingId={booking.id} agents={agents} />
            ) : null}
          </Panel>

          <Panel title="Comments" collapsible={false}>
            {canComment ? (
              <div className="mb-4 border-b border-line pb-4">
                <CommentForm bookingId={booking.id} />
              </div>
            ) : null}

            {booking.comments.length === 0 ? (
              <p className="text-sm text-ink-muted">No comments yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {booking.comments.map((comment) => (
                  <li key={comment.id} className="py-2.5">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge
                        tone={
                          comment.visibility === CommentVisibility.CUSTOMER_FACING
                            ? "info"
                            : "neutral"
                        }
                      >
                        {comment.visibility === CommentVisibility.CUSTOMER_FACING
                          ? "Customer-facing"
                          : "Internal"}
                      </Badge>
                      {comment.category ? (
                        <span className="text-xs text-ink-muted">{comment.category}</span>
                      ) : null}
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-ink">{comment.body}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {comment.author?.name ?? "Unknown"} ·{" "}
                      {formatDateTime(comment.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Status history" collapsible={false}>
            <ol className="divide-y divide-line">
              {booking.statusHistory.map((entry) => (
                <li key={entry.id} className="py-2">
                  <p className="text-sm text-ink">
                    {entry.fromStatus ? `${humanise(entry.fromStatus)} → ` : ""}
                    <span className="font-medium">{humanise(entry.toStatus)}</span>
                  </p>
                  {entry.reason ? (
                    <p className="text-xs text-ink-muted">{entry.reason}</p>
                  ) : null}
                  <p className="text-xs text-ink-subtle">
                    {entry.changedBy?.name ?? "System"} ·{" "}
                    {formatDateTime(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>

          <Card>
            <p className="flex items-start gap-2 text-xs text-ink-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Booking, ticketing, payment and refund states are tracked
              separately. A cancelled booking may still hold a captured payment
              and an open refund.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
