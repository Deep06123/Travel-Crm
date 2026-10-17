import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

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
import { buttonVariants } from "@/components/ui/button";
import { Card, Panel } from "@/components/ui/panel";
import {
  Badge,
  BookingStatusBadge,
  TicketStatusBadge,
} from "@/components/ui/status-badge";
import { CustomerStatus } from "@/generated/prisma/enums";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/financial/money";
import { PERMISSIONS } from "@/lib/permissions";
import { getCustomerProfile } from "@/server/services/customer-service";

export const metadata: Metadata = { title: "Customer · Travel CRM" };

const STATUS_TONES = {
  [CustomerStatus.ACTIVE]: "success",
  [CustomerStatus.INACTIVE]: "neutral",
  [CustomerStatus.BLOCKED]: "danger",
} as const;

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

export default async function CustomerProfilePage({
  params,
  searchParams,
}: PageProps<"/admin/customers/[id]">) {
  await requirePermission(PERMISSIONS.CUSTOMER_VIEW);
  const canEdit = await currentUserCan(PERMISSIONS.CUSTOMER_UPDATE);
  const canViewPayments = await currentUserCan(PERMISSIONS.PAYMENT_VIEW);

  const { id } = await params;
  const query = await searchParams;

  const customer = await getCustomerProfile(id);
  if (!customer) notFound();

  const address = [
    customer.billingAddressLine1,
    customer.billingAddressLine2,
    [customer.billingCity, customer.billingState, customer.billingPostalCode]
      .filter(Boolean)
      .join(", "),
    customer.billingCountry,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title={`${customer.firstName} ${customer.lastName}`}
        description={`${customer.reference} · created ${formatDate(customer.createdAt)}`}
        actions={
          canEdit ? (
            <Link
              href={`/admin/customers/${customer.id}/edit`}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Pencil />
              Edit
            </Link>
          ) : null
        }
      />

      {query["saved"] === "1" ? (
        <p
          role="status"
          className="mb-4 rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success"
        >
          Changes saved.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-1">
          <Panel title="Contact" collapsible={false}>
            <dl className="divide-y divide-line">
              <DetailRow
                label="Status"
                value={
                  <Badge tone={STATUS_TONES[customer.status]}>
                    {customer.status.charAt(0) +
                      customer.status.slice(1).toLowerCase()}
                  </Badge>
                }
              />
              <DetailRow
                label="Email"
                value={
                  customer.email ? (
                    <a
                      href={`mailto:${customer.email}`}
                      className="text-navy-500 hover:underline"
                    >
                      {customer.email}
                    </a>
                  ) : null
                }
              />
              <DetailRow
                label="Phone"
                value={
                  customer.phone ? (
                    <a
                      href={`tel:${customer.phone}`}
                      className="text-navy-500 hover:underline"
                    >
                      {customer.phone}
                    </a>
                  ) : null
                }
              />
              <DetailRow label="Language" value={customer.preferredLanguage} />
              <DetailRow
                label="Last updated"
                value={formatDateTime(customer.updatedAt)}
              />
            </dl>
          </Panel>

          <Panel title="Billing address" collapsible={false}>
            {address.length > 0 ? (
              <address className="text-sm not-italic text-ink">
                {address.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </address>
            ) : (
              <p className="text-sm text-ink-muted">No billing address recorded.</p>
            )}
          </Panel>

          <div className="grid grid-cols-3 gap-3">
            <Card className="text-center">
              <p className="tabular text-2xl font-semibold text-navy-500">
                {customer._count.bookings}
              </p>
              <p className="text-xs text-ink-muted">Bookings</p>
            </Card>
            <Card className="text-center">
              <p className="tabular text-2xl font-semibold text-navy-500">
                {customer._count.serviceCases}
              </p>
              <p className="text-xs text-ink-muted">Cases</p>
            </Card>
            <Card className="text-center">
              <p className="tabular text-2xl font-semibold text-navy-500">
                {customer._count.documents}
              </p>
              <p className="text-xs text-ink-muted">Documents</p>
            </Card>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel
            title="Booking history"
            description={
              customer._count.bookings > customer.bookings.length
                ? `Showing the ${customer.bookings.length} most recent of ${customer._count.bookings}`
                : undefined
            }
            collapsible={false}
          >
            <TableShell>
              <Thead>
                <Tr>
                  <Th>Booking</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th>Ticketing</Th>
                  {canViewPayments ? <Th align="right">Total</Th> : null}
                  <Th>Booked</Th>
                </Tr>
              </Thead>
              <Tbody>
                {customer.bookings.length === 0 ? (
                  <EmptyState
                    colSpan={canViewPayments ? 6 : 5}
                    title="No bookings yet"
                    description="Bookings created for this customer appear here."
                  />
                ) : (
                  customer.bookings.map((booking) => (
                    <Tr key={booking.id}>
                      <Td>
                        <Link
                          href={`/admin/bookings/${booking.id}`}
                          className="font-medium text-navy-500 hover:underline"
                        >
                          {booking.bookingNumber}
                        </Link>
                      </Td>
                      <Td className="text-ink-muted">
                        {booking.product === "FLIGHT" ? "Flight" : "Cruise"}
                      </Td>
                      <Td>
                        <BookingStatusBadge status={booking.status} />
                      </Td>
                      <Td>
                        <TicketStatusBadge status={booking.ticketStatus} />
                      </Td>
                      {canViewPayments ? (
                        <Td align="right" numeric>
                          {formatMoney(booking.totalMinor, booking.currency)}
                        </Td>
                      ) : null}
                      <Td className="text-ink-muted whitespace-nowrap">
                        {formatDate(booking.bookedAt)}
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableShell>
          </Panel>

          <Panel title="Internal notes" collapsible={false}>
            {customer.notes ? (
              <p className="mb-4 rounded-md bg-surface-muted p-3 text-sm whitespace-pre-wrap text-ink">
                {customer.notes}
              </p>
            ) : null}

            {customer.customerNotes.length === 0 ? (
              <p className="text-sm text-ink-muted">No note entries.</p>
            ) : (
              <ul className="divide-y divide-line">
                {customer.customerNotes.map((note) => (
                  <li key={note.id} className="py-2.5">
                    <p className="text-sm whitespace-pre-wrap text-ink">{note.body}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {note.author?.name ?? "Unknown"} ·{" "}
                      {formatDateTime(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
