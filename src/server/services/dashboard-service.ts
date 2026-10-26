import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  BookingStatus,
  FollowUpStatus,
  PaymentStatus,
  RefundStatus,
  TicketStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";

/**
 * Dashboard metrics.
 *
 * Every figure is computed from the database. None is hard-coded, and none is
 * derived from another by assumption.
 *
 * The financial measures are deliberately kept apart because they answer
 * different questions and routinely disagree:
 *
 *   grossBookingValue  what customers were charged across bookings in range
 *   paymentsCollected  what was actually captured — a booking with an unpaid
 *                      payment link contributes to the first and not the second
 *   supplierCost       what we owe suppliers
 *   grossMco / netMco  the MCO figures the reference CRM reports separately
 *   refundsIssued      only refunds that reached COMPLETED
 *   netCollections     paymentsCollected − refundsIssued
 *
 * Amounts are summed per currency. Totals across currencies are never combined,
 * since there is no exchange-rate policy configured.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

export interface CurrencyTotal {
  currency: string;
  amountMinor: number;
}

export interface DashboardMetrics {
  range: DateRange;

  counts: {
    totalBookings: number;
    newBookings: number;
    pending: number;
    needsReview: number;
    confirmed: number;
    ticketed: number;
    cancelled: number;
    completed: number;
  };

  financial: {
    grossBookingValue: CurrencyTotal[];
    supplierCost: CurrencyTotal[];
    grossMco: CurrencyTotal[];
    netMco: CurrencyTotal[];
    paymentsCollected: CurrencyTotal[];
    refundsIssued: CurrencyTotal[];
    netCollections: CurrencyTotal[];
  };

  trend: { date: string; bookings: number }[];
  statusDistribution: { status: BookingStatus; count: number }[];

  supplierPerformance: {
    id: string;
    name: string;
    bookings: number;
    grossMco: CurrencyTotal[];
    netMco: CurrencyTotal[];
  }[];

  agentPerformance: {
    id: string;
    name: string;
    bookings: number;
    ticketed: number;
    grossBookingValue: CurrencyTotal[];
  }[];

  recentBookings: {
    id: string;
    bookingNumber: string;
    customerName: string;
    status: BookingStatus;
    ticketStatus: TicketStatus;
    totalMinor: number;
    currency: string;
    bookedAt: Date;
  }[];

  pendingTicketing: number;
  overdueFollowUps: {
    id: string;
    bookingId: string;
    bookingNumber: string;
    reason: string;
    dueAt: Date;
    assigneeName: string | null;
  }[];
  refundsAwaitingAttention: number;
  highPriorityOpen: number;
}

type MoneyField =
  | "totalMinor"
  | "supplierCostMinor"
  | "grossMcoMinor"
  | "netMcoMinor";

/**
 * Sums every booking money column, grouped by currency.
 *
 * Grouping by currency rather than summing everything together is what stops a
 * EUR booking from being added to a USD one and reported as one number. All
 * four columns come back from a single scan rather than four.
 */
async function sumBookingMoney(
  where: Prisma.BookingWhereInput,
): Promise<Record<MoneyField, CurrencyTotal[]>> {
  const rows = await prisma.booking.groupBy({
    by: ["currency"],
    where,
    _sum: {
      totalMinor: true,
      supplierCostMinor: true,
      grossMcoMinor: true,
      netMcoMinor: true,
    },
  });

  const pick = (field: MoneyField): CurrencyTotal[] =>
    rows.map((row) => ({
      currency: row.currency,
      amountMinor: row._sum[field] ?? 0,
    }));

  return {
    totalMinor: pick("totalMinor"),
    supplierCostMinor: pick("supplierCostMinor"),
    grossMcoMinor: pick("grossMcoMinor"),
    netMcoMinor: pick("netMcoMinor"),
  };
}

function subtractTotals(
  left: CurrencyTotal[],
  right: CurrencyTotal[],
): CurrencyTotal[] {
  const byCurrency = new Map<string, number>();

  for (const total of left) {
    byCurrency.set(total.currency, total.amountMinor);
  }

  for (const total of right) {
    byCurrency.set(
      total.currency,
      (byCurrency.get(total.currency) ?? 0) - total.amountMinor,
    );
  }

  return [...byCurrency.entries()].map(([currency, amountMinor]) => ({
    currency,
    amountMinor,
  }));
}

export async function getDashboardMetrics(
  range: DateRange,
): Promise<DashboardMetrics> {
  const inRange = { bookedAt: { gte: range.from, lte: range.to } };

  const countFor = (status: BookingStatus) =>
    prisma.booking.count({ where: { ...inRange, status } });

  const [
    totalBookings,
    newBookings,
    pending,
    needsReview,
    confirmed,
    ticketed,
    cancelled,
    completed,
  ] = await Promise.all([
    prisma.booking.count(),
    prisma.booking.count({ where: inRange }),
    countFor(BookingStatus.PENDING),
    countFor(BookingStatus.NEEDS_REVIEW),
    countFor(BookingStatus.CONFIRMED),
    countFor(BookingStatus.TICKETED),
    countFor(BookingStatus.CANCELLED),
    countFor(BookingStatus.COMPLETED),
  ]);

  // Cancelled bookings are excluded from value measures: nothing is owed on a
  // booking that was never fulfilled.
  const valueWhere = { ...inRange, status: { not: BookingStatus.CANCELLED } };

  /**
   * The seven independent aggregates, issued together.
   *
   * None of them reads another's result — each is a separate roll-up over the
   * same date range — so awaiting them one at a time bought nothing and cost a
   * full round trip each. That is invisible against a database on localhost
   * and very visible against a managed one: at 20ms of network latency this
   * was 140ms of the page spent waiting in series for queries that could have
   * gone out at once.
   *
   * The follow-ups that genuinely do depend on these — resolving supplier and
   * agent names from the ids the roll-ups return — stay below, where they
   * belong.
   */
  const [
    bookingMoney,
    paymentRows,
    refundRows,
    trendRows,
    distributionRows,
    supplierGroups,
    agentGroups,
  ] = await Promise.all([
    sumBookingMoney(valueWhere),

    // Only captured payments count as collected. A pending payment, or a saved
    // payment link, is not money received.
    prisma.payment.groupBy({
      by: ["currency"],
      where: {
        status: PaymentStatus.CAPTURED,
        createdAt: { gte: range.from, lte: range.to },
      },
      _sum: { amountMinor: true },
    }),

    // Only completed refunds count as issued; an approved-but-unprocessed
    // refund has not left the account.
    prisma.refund.groupBy({
      by: ["currency"],
      where: {
        status: RefundStatus.COMPLETED,
        completedAt: { gte: range.from, lte: range.to },
      },
      _sum: { approvedAmountMinor: true },
    }),

    // Daily booking counts, bucketed in SQL so the grouping happens once in
    // the database rather than over every row in JavaScript.
    //
    // DATE_FORMAT yields the `YYYY-MM-DD` string this is rendered as, which
    // also sidesteps a conversion that was never safe: a DATE coming back
    // through the driver is a JS Date at local midnight, and reading the day
    // back out of it in UTC can land on the day before.
    prisma.$queryRaw<{ day: string; count: bigint }[]>`
      SELECT DATE_FORMAT(\`bookedAt\`, '%Y-%m-%d') AS day, COUNT(*) AS count
      FROM \`Booking\`
      WHERE \`bookedAt\` >= ${range.from} AND \`bookedAt\` <= ${range.to}
      GROUP BY day
      ORDER BY day ASC
    `,

    prisma.booking.groupBy({
      by: ["status"],
      where: inRange,
      _count: true,
    }),

    prisma.booking.groupBy({
      by: ["supplierId", "currency"],
      where: { ...valueWhere, supplierId: { not: null } },
      _count: true,
      _sum: { grossMcoMinor: true, netMcoMinor: true },
    }),

    prisma.booking.groupBy({
      by: ["assignedAgentId", "currency"],
      where: { ...valueWhere, assignedAgentId: { not: null } },
      _count: true,
      _sum: { totalMinor: true },
    }),
  ]);

  const grossBookingValue = bookingMoney.totalMinor;
  const supplierCost = bookingMoney.supplierCostMinor;
  const grossMco = bookingMoney.grossMcoMinor;
  const netMco = bookingMoney.netMcoMinor;

  const paymentsCollected: CurrencyTotal[] = paymentRows.map((row) => ({
    currency: row.currency,
    amountMinor: row._sum.amountMinor ?? 0,
  }));

  const refundsIssued: CurrencyTotal[] = refundRows.map((row) => ({
    currency: row.currency,
    amountMinor: row._sum.approvedAmountMinor ?? 0,
  }));

  const netCollections = subtractTotals(paymentsCollected, refundsIssued);

  const trend = trendRows.map((row) => ({
    date: row.day,
    bookings: Number(row.count),
  }));

  const statusDistribution = distributionRows.map((row) => ({
    status: row.status,
    count: row._count,
  }));

  // --- Supplier performance -----------------------------------------------
  const supplierIds = [
    ...new Set(supplierGroups.map((group) => group.supplierId).filter(Boolean)),
  ] as string[];

  const supplierNames = new Map(
    (
      await prisma.supplier.findMany({
        where: { id: { in: supplierIds } },
        select: { id: true, name: true },
      })
    ).map((supplier) => [supplier.id, supplier.name]),
  );

  const supplierPerformance = supplierIds.map((id) => {
    const groups = supplierGroups.filter((group) => group.supplierId === id);

    return {
      id,
      name: supplierNames.get(id) ?? "Unknown",
      bookings: groups.reduce((total, group) => total + group._count, 0),
      grossMco: groups.map((group) => ({
        currency: group.currency,
        amountMinor: group._sum.grossMcoMinor ?? 0,
      })),
      netMco: groups.map((group) => ({
        currency: group.currency,
        amountMinor: group._sum.netMcoMinor ?? 0,
      })),
    };
  });

  // --- Agent performance --------------------------------------------------
  const agentIds = [
    ...new Set(agentGroups.map((group) => group.assignedAgentId).filter(Boolean)),
  ] as string[];

  const [agentNames, ticketedByAgent] = await Promise.all([
    prisma.adminUser
      .findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true },
      })
      .then((rows) => new Map(rows.map((row) => [row.id, row.name]))),
    prisma.booking
      .groupBy({
        by: ["assignedAgentId"],
        where: {
          ...inRange,
          assignedAgentId: { in: agentIds },
          status: BookingStatus.TICKETED,
        },
        _count: true,
      })
      .then(
        (rows) =>
          new Map(rows.map((row) => [row.assignedAgentId ?? "", row._count])),
      ),
  ]);

  const agentPerformance = agentIds.map((id) => {
    const groups = agentGroups.filter((group) => group.assignedAgentId === id);

    return {
      id,
      name: agentNames.get(id) ?? "Unknown",
      bookings: groups.reduce((total, group) => total + group._count, 0),
      ticketed: ticketedByAgent.get(id) ?? 0,
      grossBookingValue: groups.map((group) => ({
        currency: group.currency,
        amountMinor: group._sum.totalMinor ?? 0,
      })),
    };
  });

  // --- Operational panels ---------------------------------------------------
  const [recentRows, pendingTicketing, overdueRows, refundsAwaitingAttention, highPriorityOpen] =
    await Promise.all([
      prisma.booking.findMany({
        orderBy: { bookedAt: "desc" },
        take: 10,
        select: {
          id: true,
          bookingNumber: true,
          status: true,
          ticketStatus: true,
          totalMinor: true,
          currency: true,
          bookedAt: true,
          customer: { select: { firstName: true, lastName: true } },
        },
      }),

      prisma.booking.count({
        where: {
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
          ticketStatus: { in: [TicketStatus.PENDING, TicketStatus.IN_PROGRESS] },
        },
      }),

      prisma.bookingFollowUp.findMany({
        where: {
          status: { in: [FollowUpStatus.OPEN, FollowUpStatus.IN_PROGRESS] },
          dueAt: { lt: new Date() },
        },
        orderBy: { dueAt: "asc" },
        take: 10,
        select: {
          id: true,
          reason: true,
          dueAt: true,
          booking: { select: { id: true, bookingNumber: true } },
          assignee: { select: { name: true } },
        },
      }),

      prisma.refund.count({
        where: {
          status: { in: [RefundStatus.PENDING, RefundStatus.APPROVED, RefundStatus.FAILED] },
        },
      }),

      prisma.booking.count({
        where: {
          priority: { in: ["HIGH", "URGENT"] },
          status: { notIn: [BookingStatus.CANCELLED, BookingStatus.COMPLETED] },
        },
      }),
    ]);

  return {
    range,
    counts: {
      totalBookings,
      newBookings,
      pending,
      needsReview,
      confirmed,
      ticketed,
      cancelled,
      completed,
    },
    financial: {
      grossBookingValue,
      supplierCost,
      grossMco,
      netMco,
      paymentsCollected,
      refundsIssued,
      netCollections,
    },
    trend,
    statusDistribution,
    supplierPerformance,
    agentPerformance,
    recentBookings: recentRows.map((row) => ({
      id: row.id,
      bookingNumber: row.bookingNumber,
      customerName: `${row.customer.firstName} ${row.customer.lastName}`,
      status: row.status,
      ticketStatus: row.ticketStatus,
      totalMinor: row.totalMinor,
      currency: row.currency,
      bookedAt: row.bookedAt,
    })),
    pendingTicketing,
    overdueFollowUps: overdueRows.map((row) => ({
      id: row.id,
      bookingId: row.booking.id,
      bookingNumber: row.booking.bookingNumber,
      reason: row.reason,
      dueAt: row.dueAt,
      assigneeName: row.assignee?.name ?? null,
    })),
    refundsAwaitingAttention,
    highPriorityOpen,
  };
}
