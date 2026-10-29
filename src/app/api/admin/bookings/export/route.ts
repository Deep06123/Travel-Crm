import { AuditAction } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { requireAuthOrThrow } from "@/lib/auth/dal";
import {
  MAX_EXPORT_ROWS,
  buildCsv,
  csvFilename,
  csvResponse,
} from "@/lib/export/csv";
import { minorToDecimalString } from "@/lib/financial/money";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { loggerFor } from "@/lib/logging/logger";
import {
  ForbiddenError,
  PERMISSIONS,
  getPermissionsForRole,
} from "@/lib/permissions";
import { bookingSearchSchema } from "@/features/bookings/schemas";
import { buildBookingWhere } from "@/server/services/booking-service";
import { getBookingExportRows } from "@/server/services/report-service";

/** See the admin layout: a cold start must build the embedded database first. */
export const maxDuration = 60;

const log = loggerFor("booking-export");

/**
 * Exports the booking list as CSV.
 *
 * The export honours exactly the filters the list was showing — the same
 * `bookingSearchSchema` and the same `buildBookingWhere` — so what downloads
 * matches what was on screen rather than silently being everything.
 *
 * Financial columns are included only for roles that may see them. Hiding the
 * money on the page but shipping it in the CSV would make the export a way to
 * read around the permission.
 */
export async function GET(request: Request): Promise<Response> {
  let actorId: string;
  let canSeeMoney = false;

  try {
    const user = await requireAuthOrThrow();
    actorId = user.id;

    const granted = await getPermissionsForRole(user.role);

    if (!granted.has(PERMISSIONS.BOOKING_EXPORT)) {
      throw new ForbiddenError(PERMISSIONS.BOOKING_EXPORT);
    }

    canSeeMoney = granted.has(PERMISSIONS.PAYMENT_VIEW);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const pick = (key: string): string | undefined => {
    const value = url.searchParams.get(key);
    return value && value !== "" ? value : undefined;
  };

  const parsed = bookingSearchSchema.safeParse({
    q: pick("q"),
    status: pick("status"),
    ticketStatus: pick("ticketStatus"),
    mcoStatus: pick("mcoStatus"),
    priority: pick("priority"),
    agentId: pick("agentId"),
    supplierId: pick("supplierId"),
    currency: pick("currency"),
    from: pick("from"),
    to: pick("to"),
  });

  if (!parsed.success) {
    return new Response("Invalid filters", { status: 400 });
  }

  const where = buildBookingWhere(parsed.data);

  // One over the cap, so buildCsv can tell whether more rows matched.
  const rows = await getBookingExportRows(where, MAX_EXPORT_ROWS + 1);

  const columns = [
    { header: "Booking number", value: (r: (typeof rows)[number]) => r.bookingNumber },
    { header: "Product", value: (r: (typeof rows)[number]) => r.product },
    { header: "Type", value: (r: (typeof rows)[number]) => r.bookingType?.label ?? "" },
    { header: "Booking status", value: (r: (typeof rows)[number]) => r.status },
    { header: "Ticket status", value: (r: (typeof rows)[number]) => r.ticketStatus },
    { header: "MCO status", value: (r: (typeof rows)[number]) => r.mcoStatus },
    { header: "Priority", value: (r: (typeof rows)[number]) => r.priority },
    { header: "Customer reference", value: (r: (typeof rows)[number]) => r.customer.reference },
    { header: "Customer name", value: (r: (typeof rows)[number]) => `${r.customer.firstName} ${r.customer.lastName}` },
    { header: "Customer email", value: (r: (typeof rows)[number]) => r.customer.email ?? "" },
    { header: "Contact phone", value: (r: (typeof rows)[number]) => r.contactPhone ?? "" },
    { header: "Confirmation", value: (r: (typeof rows)[number]) => r.airlineConfirmation ?? "" },
    { header: "Agent", value: (r: (typeof rows)[number]) => r.assignedAgent?.name ?? "" },
    { header: "Supplier", value: (r: (typeof rows)[number]) => r.supplier?.name ?? "" },
    { header: "Booked", value: (r: (typeof rows)[number]) => formatDateTime(r.bookedAt) },
    { header: "Travel date", value: (r: (typeof rows)[number]) => (r.travelStartDate ? formatCalendarDate(r.travelStartDate) : "") },
  ];

  if (canSeeMoney) {
    columns.push(
      { header: "Currency", value: (r: (typeof rows)[number]) => r.currency },
      // Decimal strings rather than minor units, so a spreadsheet shows what a
      // person expects.
      { header: "Base fare", value: (r: (typeof rows)[number]) => minorToDecimalString(r.baseFareMinor, r.currency) },
      { header: "Taxes and fees", value: (r: (typeof rows)[number]) => minorToDecimalString(r.taxesFeesMinor, r.currency) },
      { header: "Gross booking value", value: (r: (typeof rows)[number]) => minorToDecimalString(r.totalMinor, r.currency) },
      { header: "Supplier cost", value: (r: (typeof rows)[number]) => minorToDecimalString(r.supplierCostMinor, r.currency) },
      { header: "Gross MCO", value: (r: (typeof rows)[number]) => minorToDecimalString(r.grossMcoMinor, r.currency) },
      { header: "Net MCO", value: (r: (typeof rows)[number]) => minorToDecimalString(r.netMcoMinor, r.currency) },
    );
  }

  const csv = buildCsv(rows, columns);

  // Exports move customer data out of the system, so each one is recorded.
  await recordAudit({
    action: AuditAction.EXPORT,
    entityType: "Booking",
    entityId: "list",
    adminUserId: actorId,
    summary: `Exported ${csv.rowCount} booking(s) to CSV${csv.truncated ? " (truncated)" : ""}${canSeeMoney ? " including financial columns" : ""}`,
  });

  log.info(
    { actorId, rowCount: csv.rowCount, truncated: csv.truncated },
    "Booking export generated",
  );

  return csvResponse(csv, csvFilename("bookings"));
}
