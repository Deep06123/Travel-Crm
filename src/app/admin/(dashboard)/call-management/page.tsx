import type { Metadata } from "next";
import Link from "next/link";
import { Info, Search } from "lucide-react";

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
import { PaginationControls } from "@/components/tables/pagination-controls";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Card } from "@/components/ui/panel";
import { Badge } from "@/components/ui/status-badge";
import { CallDirection, CallOutcome } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime, formatRelativeDays, isOverdue } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listCalls } from "@/server/services/operations-service";

export const metadata: Metadata = { title: "Call management · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const OUTCOME_TONES: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  CONNECTED: "success",
  CALLBACK_REQUESTED: "warning",
  VOICEMAIL: "neutral",
  NO_ANSWER: "neutral",
  BUSY: "neutral",
  WRONG_NUMBER: "danger",
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default async function CallManagementPage({
  searchParams,
}: PageProps<"/admin/call-management">) {
  await requirePermission(PERMISSIONS.CALL_VIEW);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawOutcome = pick("outcome");
  const rawDirection = pick("direction");

  const filters = {
    q: pick("q"),
    outcome:
      rawOutcome && rawOutcome in CallOutcome
        ? (rawOutcome as CallOutcome)
        : undefined,
    direction:
      rawDirection && rawDirection in CallDirection
        ? (rawDirection as CallDirection)
        : undefined,
    agentId: pick("agentId"),
    followUpRequired: pick("followUpRequired") === "1",
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const [result, agents] = await Promise.all([
    listCalls(filters, pagination),
    prisma.adminUser.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/call-management?${search}` : "/admin/call-management";
  };

  return (
    <>
      <PageHeader
        title="Call management"
        description={`${result.total.toLocaleString()} logged call${result.total === 1 ? "" : "s"}`}
      />

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Calls are logged by hand. No telephony system is connected, so nothing
          is captured automatically and no recordings are stored — live capture
          would need its own integration and a consent review first.
        </p>
      </Card>

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">
              Search
            </label>
            <Input
              id="q"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Notes, booking number, customer or phone"
            />
          </div>

          <div className="w-44">
            <label htmlFor="outcome" className="mb-1.5 block text-sm font-medium text-ink">
              Outcome
            </label>
            <Select id="outcome" name="outcome" defaultValue={filters.outcome ?? ""}>
              <option value="">All</option>
              {Object.values(CallOutcome).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-36">
            <label htmlFor="direction" className="mb-1.5 block text-sm font-medium text-ink">
              Direction
            </label>
            <Select id="direction" name="direction" defaultValue={filters.direction ?? ""}>
              <option value="">All</option>
              {Object.values(CallDirection).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-48">
            <label htmlFor="agentId" className="mb-1.5 block text-sm font-medium text-ink">
              Agent
            </label>
            <Select id="agentId" name="agentId" defaultValue={filters.agentId ?? ""}>
              <option value="">Anyone</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </Select>
          </div>

          <label className="flex items-center gap-2 pb-2 text-sm text-ink">
            <input
              type="checkbox"
              name="followUpRequired"
              value="1"
              defaultChecked={filters.followUpRequired}
              className="size-4 rounded border-line-strong"
            />
            Needs follow-up
          </label>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {Object.values(filters).some(Boolean) ? (
            <Link
              href="/admin/call-management"
              className={buttonVariants({ variant: "ghost" })}
            >
              Clear
            </Link>
          ) : null}
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>When</Th>
              <Th>Direction</Th>
              <Th>Outcome</Th>
              <Th align="right">Duration</Th>
              <Th>Customer</Th>
              <Th>Booking</Th>
              <Th>Agent</Th>
              <Th>Notes</Th>
              <Th>Follow-up</Th>
            </Tr>
          </Thead>

          <Tbody>
            {result.rows.length === 0 ? (
              <EmptyState
                colSpan={9}
                title="No calls logged"
                description="Calls are logged from a booking or a customer record."
              />
            ) : (
              result.rows.map((call) => (
                <Tr key={call.id}>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(call.occurredAt)}
                  </Td>
                  <Td className="text-ink-muted">{humanise(call.direction)}</Td>
                  <Td>
                    <Badge tone={OUTCOME_TONES[call.outcome] ?? "neutral"}>
                      {humanise(call.outcome)}
                    </Badge>
                  </Td>
                  <Td align="right" numeric>
                    {formatDuration(call.durationSeconds)}
                  </Td>
                  <Td>
                    {call.customer ? (
                      <Link
                        href={`/admin/customers/${call.customer.id}`}
                        className="text-navy-500 hover:underline"
                      >
                        {call.customer.firstName} {call.customer.lastName}
                      </Link>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </Td>
                  <Td>
                    {call.booking ? (
                      <Link
                        href={`/admin/bookings/${call.booking.id}`}
                        className="text-navy-500 hover:underline"
                      >
                        {call.booking.bookingNumber}
                      </Link>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </Td>
                  <Td className="text-ink-muted">{call.agent?.name ?? "—"}</Td>
                  <Td className="max-w-56 text-ink-muted">
                    <span className="line-clamp-2">{call.notes ?? "—"}</span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {call.followUpRequired && call.followUpAt ? (
                      <span
                        className={
                          isOverdue(call.followUpAt)
                            ? "font-medium text-status-danger"
                            : "text-ink-muted"
                        }
                      >
                        {formatRelativeDays(call.followUpAt)}
                      </span>
                    ) : call.followUpRequired ? (
                      <Badge tone="warning">Required</Badge>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </TableShell>

        <PaginationControls
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={result.pageSize}
          buildHref={buildHref}
        />
      </div>
    </>
  );
}
