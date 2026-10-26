import "server-only";

import {
  BookingStatus,
  ChargebackStatus,
  PaymentStatus,
  RefundStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Reports.
 *
 * Every figure is a database query over the requested window. The financial
 * report reuses the definitions in `lib/financial/booking-balance` so a report
 * and a booking's own detail page cannot disagree about what "collected" means.
 *
 * Cancelled bookings are excluded from value measures throughout, and included
 * in count measures — a cancellation is a real event worth counting, but
 * nothing is owed on it.
 */

export interface ReportRange {
  from: Date;
  to: Date;
}

export interface CurrencyTotal {
  currency: string;
  amountMinor: number;
}

function toTotals(
  rows: { currency: string; _sum: Record<string, number | null> }[],
  field: string,
): CurrencyTotal[] {
  return rows.map((row) => ({
    currency: row.currency,
    amountMinor: row._sum[field] ?? 0,
  }));
}

// --- Booking report ---------------------------------------------------------

export interface BookingReport {
  totalBookings: number;
  byStatus: { status: BookingStatus; count: number }[];
  byProduct: { product: string; count: number }[];
  byType: { label: string; count: number }[];
  byAgent: { id: string; name: string; count: number }[];
  bySupplier: { id: string; name: string; count: number }[];
  trend: { date: string; count: number }[];
}

export async function getBookingReport(range: ReportRange): Promise<BookingReport> {
  const where: Prisma.BookingWhereInput = {
    bookedAt: { gte: range.from, lte: range.to },
  };

  const [total, byStatus, byProduct, byTypeRows, byAgentRows, bySupplierRows, trendRows] =
    await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.groupBy({ by: ["status"], where, _count: true }),
      prisma.booking.groupBy({ by: ["product"], where, _count: true }),
      prisma.booking.groupBy({ by: ["bookingTypeId"], where, _count: true }),
      prisma.booking.groupBy({ by: ["assignedAgentId"], where, _count: true }),
      prisma.booking.groupBy({ by: ["supplierId"], where, _count: true }),
      // DATE_FORMAT rather than a DATE column: the string is what this is
      // rendered as, and it avoids reading a local-midnight Date back out in
      // UTC, which can report the previous day.
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE_FORMAT(\`bookedAt\`, '%Y-%m-%d') AS day, COUNT(*) AS count
        FROM \`Booking\`
        WHERE \`bookedAt\` >= ${range.from} AND \`bookedAt\` <= ${range.to}
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

  // Resolve the display names for the grouped foreign keys in one round trip
  // each, rather than per row.
  const typeIds = byTypeRows.map((r) => r.bookingTypeId).filter(Boolean) as string[];
  const agentIds = byAgentRows.map((r) => r.assignedAgentId).filter(Boolean) as string[];
  const supplierIds = bySupplierRows.map((r) => r.supplierId).filter(Boolean) as string[];

  const [types, agents, suppliers] = await Promise.all([
    prisma.bookingType.findMany({
      where: { id: { in: typeIds } },
      select: { id: true, label: true },
    }),
    prisma.adminUser.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true },
    }),
    prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true },
    }),
  ]);

  const typeNames = new Map(types.map((t) => [t.id, t.label]));
  const agentNames = new Map(agents.map((a) => [a.id, a.name]));
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));

  return {
    totalBookings: total,
    byStatus: byStatus.map((row) => ({ status: row.status, count: row._count })),
    byProduct: byProduct.map((row) => ({ product: row.product, count: row._count })),
    byType: byTypeRows.map((row) => ({
      // A booking with no type set is still a booking; it is labelled rather
      // than dropped, so the parts sum to the total.
      label: row.bookingTypeId
        ? (typeNames.get(row.bookingTypeId) ?? "Unknown")
        : "Not set",
      count: row._count,
    })),
    byAgent: byAgentRows.map((row) => ({
      id: row.assignedAgentId ?? "unassigned",
      name: row.assignedAgentId
        ? (agentNames.get(row.assignedAgentId) ?? "Unknown")
        : "Unassigned",
      count: row._count,
    })),
    bySupplier: bySupplierRows.map((row) => ({
      id: row.supplierId ?? "none",
      name: row.supplierId
        ? (supplierNames.get(row.supplierId) ?? "Unknown")
        : "Not set",
      count: row._count,
    })),
    trend: trendRows.map((row) => ({
      date: row.day,
      count: Number(row.count),
    })),
  };
}

// --- Financial report -------------------------------------------------------

export interface FinancialReport {
  grossBookingValue: CurrencyTotal[];
  supplierCost: CurrencyTotal[];
  margin: CurrencyTotal[];
  grossMco: CurrencyTotal[];
  netMco: CurrencyTotal[];
  paymentsCollected: CurrencyTotal[];
  paymentsPending: CurrencyTotal[];
  refundsIssued: CurrencyTotal[];
  refundsApprovedNotPaid: CurrencyTotal[];
  netCollections: CurrencyTotal[];
  outstandingBalance: CurrencyTotal[];
  chargebacksOpen: CurrencyTotal[];
  chargebacksLost: CurrencyTotal[];
}

/** Combines per-currency totals with a sign, keeping currencies separate. */
function combine(
  parts: { totals: CurrencyTotal[]; sign: 1 | -1 }[],
): CurrencyTotal[] {
  const byCurrency = new Map<string, number>();

  for (const part of parts) {
    for (const total of part.totals) {
      byCurrency.set(
        total.currency,
        (byCurrency.get(total.currency) ?? 0) + part.sign * total.amountMinor,
      );
    }
  }

  return [...byCurrency.entries()].map(([currency, amountMinor]) => ({
    currency,
    amountMinor,
  }));
}

export async function getFinancialReport(
  range: ReportRange,
): Promise<FinancialReport> {
  const bookingWhere: Prisma.BookingWhereInput = {
    bookedAt: { gte: range.from, lte: range.to },
    // Nothing is owed on a cancelled booking.
    status: { not: BookingStatus.CANCELLED },
  };

  const [
    bookingMoney,
    capturedRows,
    pendingRows,
    refundRows,
    approvedRefundRows,
    openChargebackRows,
    lostChargebackRows,
  ] = await Promise.all([
    prisma.booking.groupBy({
      by: ["currency"],
      where: bookingWhere,
      _sum: {
        totalMinor: true,
        supplierCostMinor: true,
        grossMcoMinor: true,
        netMcoMinor: true,
      },
    }),

    // Only CAPTURED is money received.
    prisma.payment.groupBy({
      by: ["currency"],
      where: {
        status: PaymentStatus.CAPTURED,
        createdAt: { gte: range.from, lte: range.to },
      },
      _sum: { amountMinor: true },
    }),

    prisma.payment.groupBy({
      by: ["currency"],
      where: {
        status: PaymentStatus.PENDING,
        createdAt: { gte: range.from, lte: range.to },
      },
      _sum: { amountMinor: true },
    }),

    // Only COMPLETED refunds have actually left the account.
    prisma.refund.groupBy({
      by: ["currency"],
      where: {
        status: RefundStatus.COMPLETED,
        completedAt: { gte: range.from, lte: range.to },
      },
      _sum: { approvedAmountMinor: true },
    }),

    // Approved but not yet executed: a commitment, reported apart from issued.
    prisma.refund.groupBy({
      by: ["currency"],
      where: {
        status: { in: [RefundStatus.APPROVED, RefundStatus.PROCESSING] },
        approvedAt: { gte: range.from, lte: range.to },
      },
      _sum: { approvedAmountMinor: true },
    }),

    prisma.chargeback.groupBy({
      by: ["currency"],
      where: {
        receivedAt: { gte: range.from, lte: range.to },
        status: {
          in: [
            ChargebackStatus.RECEIVED,
            ChargebackStatus.EVIDENCE_REQUIRED,
            ChargebackStatus.EVIDENCE_SUBMITTED,
            ChargebackStatus.UNDER_REVIEW,
          ],
        },
      },
      _sum: { disputedAmountMinor: true },
    }),

    prisma.chargeback.groupBy({
      by: ["currency"],
      where: {
        receivedAt: { gte: range.from, lte: range.to },
        status: { in: [ChargebackStatus.LOST, ChargebackStatus.ACCEPTED] },
      },
      _sum: { disputedAmountMinor: true },
    }),
  ]);

  const grossBookingValue = toTotals(bookingMoney, "totalMinor");
  const supplierCost = toTotals(bookingMoney, "supplierCostMinor");
  const paymentsCollected = toTotals(capturedRows, "amountMinor");
  const refundsIssued = toTotals(refundRows, "approvedAmountMinor");

  return {
    grossBookingValue,
    supplierCost,
    margin: combine([
      { totals: grossBookingValue, sign: 1 },
      { totals: supplierCost, sign: -1 },
    ]),
    grossMco: toTotals(bookingMoney, "grossMcoMinor"),
    netMco: toTotals(bookingMoney, "netMcoMinor"),
    paymentsCollected,
    paymentsPending: toTotals(pendingRows, "amountMinor"),
    refundsIssued,
    refundsApprovedNotPaid: toTotals(approvedRefundRows, "approvedAmountMinor"),
    netCollections: combine([
      { totals: paymentsCollected, sign: 1 },
      { totals: refundsIssued, sign: -1 },
    ]),
    // What customers were charged, less what has actually been netted in.
    outstandingBalance: combine([
      { totals: grossBookingValue, sign: 1 },
      { totals: paymentsCollected, sign: -1 },
      { totals: refundsIssued, sign: 1 },
    ]),
    chargebacksOpen: toTotals(openChargebackRows, "disputedAmountMinor"),
    chargebacksLost: toTotals(lostChargebackRows, "disputedAmountMinor"),
  };
}

// --- Operational report -----------------------------------------------------

export interface OperationalReport {
  pendingBookings: number;
  needsReview: number;
  ticketingBacklog: number;
  highPriorityOpen: number;
  overdueFollowUps: number;
  openServiceCases: number;
  refundsAwaitingDecision: number;
  refundsAwaitingExecution: number;
  chargebacksPastDeadline: number;
  documentsUnverified: number;
}

export async function getOperationalReport(): Promise<OperationalReport> {
  const now = new Date();

  const [
    pendingBookings,
    needsReview,
    ticketingBacklog,
    highPriorityOpen,
    overdueFollowUps,
    openServiceCases,
    refundsAwaitingDecision,
    refundsAwaitingExecution,
    chargebacksPastDeadline,
    documentsUnverified,
  ] = await Promise.all([
    prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
    prisma.booking.count({ where: { status: BookingStatus.NEEDS_REVIEW } }),
    prisma.booking.count({
      where: {
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        ticketStatus: { in: ["PENDING", "IN_PROGRESS"] },
      },
    }),
    prisma.booking.count({
      where: {
        priority: { in: ["HIGH", "URGENT"] },
        status: { notIn: [BookingStatus.CANCELLED, BookingStatus.COMPLETED] },
      },
    }),
    prisma.bookingFollowUp.count({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: now } },
    }),
    prisma.customerServiceCase.count({
      where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER"] } },
    }),
    prisma.refund.count({ where: { status: RefundStatus.PENDING } }),
    prisma.refund.count({
      where: { status: { in: [RefundStatus.APPROVED, RefundStatus.PROCESSING] } },
    }),
    prisma.chargeback.count({
      where: {
        respondBy: { lt: now },
        status: {
          in: [
            ChargebackStatus.RECEIVED,
            ChargebackStatus.EVIDENCE_REQUIRED,
            ChargebackStatus.EVIDENCE_SUBMITTED,
          ],
        },
      },
    }),
    prisma.document.count({ where: { verificationStatus: "UNVERIFIED" } }),
  ]);

  return {
    pendingBookings,
    needsReview,
    ticketingBacklog,
    highPriorityOpen,
    overdueFollowUps,
    openServiceCases,
    refundsAwaitingDecision,
    refundsAwaitingExecution,
    chargebacksPastDeadline,
    documentsUnverified,
  };
}

// --- Performance reports ----------------------------------------------------

export interface AgentPerformanceRow {
  id: string;
  name: string;
  role: string;
  created: number;
  assigned: number;
  ticketed: number;
  cancelled: number;
  completedFollowUps: number;
  overdueFollowUps: number;
  bookingValue: CurrencyTotal[];
}

/**
 * Agent activity over the window.
 *
 * Counts and value only, and deliberately no composite score: the plan is
 * explicit that agents must not be ranked on metrics that have not been
 * validated. Sorting is alphabetical for the same reason.
 */
export async function getAgentPerformance(
  range: ReportRange,
): Promise<AgentPerformanceRow[]> {
  const agents = await prisma.adminUser.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  const inRange = { bookedAt: { gte: range.from, lte: range.to } };

  return Promise.all(
    agents.map(async (agent) => {
      const [created, assigned, ticketed, cancelled, completed, overdue, value] =
        await Promise.all([
          prisma.booking.count({ where: { ...inRange, createdById: agent.id } }),
          prisma.booking.count({ where: { ...inRange, assignedAgentId: agent.id } }),
          prisma.booking.count({
            where: { ...inRange, assignedAgentId: agent.id, status: "TICKETED" },
          }),
          prisma.booking.count({
            where: { ...inRange, assignedAgentId: agent.id, status: "CANCELLED" },
          }),
          prisma.bookingFollowUp.count({
            where: {
              assigneeId: agent.id,
              status: "COMPLETED",
              completedAt: { gte: range.from, lte: range.to },
            },
          }),
          prisma.bookingFollowUp.count({
            where: {
              assigneeId: agent.id,
              status: { in: ["OPEN", "IN_PROGRESS"] },
              dueAt: { lt: new Date() },
            },
          }),
          prisma.booking.groupBy({
            by: ["currency"],
            where: {
              ...inRange,
              assignedAgentId: agent.id,
              status: { not: BookingStatus.CANCELLED },
            },
            _sum: { totalMinor: true },
          }),
        ]);

      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        created,
        assigned,
        ticketed,
        cancelled,
        completedFollowUps: completed,
        overdueFollowUps: overdue,
        bookingValue: toTotals(value, "totalMinor"),
      };
    }),
  );
}

export interface SupplierPerformanceRow {
  id: string;
  name: string;
  type: string;
  bookings: number;
  cancelled: number;
  bookingValue: CurrencyTotal[];
  supplierCost: CurrencyTotal[];
  grossMco: CurrencyTotal[];
  netMco: CurrencyTotal[];
}

export async function getSupplierPerformance(
  range: ReportRange,
): Promise<SupplierPerformanceRow[]> {
  const suppliers = await prisma.supplier.findMany({
    select: { id: true, name: true, type: true },
    orderBy: { name: "asc" },
  });

  const inRange = { bookedAt: { gte: range.from, lte: range.to } };

  return Promise.all(
    suppliers.map(async (supplier) => {
      const [bookings, cancelled, money] = await Promise.all([
        prisma.booking.count({ where: { ...inRange, supplierId: supplier.id } }),
        prisma.booking.count({
          where: { ...inRange, supplierId: supplier.id, status: "CANCELLED" },
        }),
        prisma.booking.groupBy({
          by: ["currency"],
          where: {
            ...inRange,
            supplierId: supplier.id,
            status: { not: BookingStatus.CANCELLED },
          },
          _sum: {
            totalMinor: true,
            supplierCostMinor: true,
            grossMcoMinor: true,
            netMcoMinor: true,
          },
        }),
      ]);

      return {
        id: supplier.id,
        name: supplier.name,
        type: supplier.type,
        bookings,
        cancelled,
        bookingValue: toTotals(money, "totalMinor"),
        supplierCost: toTotals(money, "supplierCostMinor"),
        grossMco: toTotals(money, "grossMcoMinor"),
        netMco: toTotals(money, "netMcoMinor"),
      };
    }),
  );
}

/** Flat booking rows for CSV export, honouring the same filters as the list. */
export async function getBookingExportRows(
  where: Prisma.BookingWhereInput,
  limit: number,
) {
  return prisma.booking.findMany({
    where,
    orderBy: { bookedAt: "desc" },
    take: limit,
    select: {
      bookingNumber: true,
      product: true,
      status: true,
      ticketStatus: true,
      mcoStatus: true,
      priority: true,
      currency: true,
      baseFareMinor: true,
      taxesFeesMinor: true,
      totalMinor: true,
      supplierCostMinor: true,
      grossMcoMinor: true,
      netMcoMinor: true,
      airlineConfirmation: true,
      bookedAt: true,
      travelStartDate: true,
      contactEmail: true,
      contactPhone: true,
      customer: {
        select: { reference: true, firstName: true, lastName: true, email: true },
      },
      bookingType: { select: { label: true } },
      assignedAgent: { select: { name: true } },
      supplier: { select: { name: true } },
    },
  });
}
