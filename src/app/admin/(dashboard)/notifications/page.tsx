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
import { NotificationChannel, NotificationStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listNotifications } from "@/server/services/messaging-service";

export const metadata: Metadata = { title: "Notifications · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const STATUS_TONES: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  PENDING: "warning",
  SENT: "info" as never,
  DELIVERED: "success",
  FAILED: "danger",
  SUPPRESSED: "neutral",
};

export default async function NotificationsPage({
  searchParams,
}: PageProps<"/admin/notifications">) {
  await requirePermission(PERMISSIONS.NOTIFICATION_VIEW);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const filters = {
    q: pick("q"),
    status: pick("status"),
    channel: pick("channel"),
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const result = await listNotifications(filters, pagination);

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/notifications?${search}` : "/admin/notifications";
  };

  return (
    <>
      <PageHeader
        title="Notification history"
        description={`${result.total.toLocaleString()} record${result.total === 1 ? "" : "s"}`}
      />

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          No email or SMS provider is configured, so nothing here has been
          transmitted. A row reaches <strong>Delivered</strong> only when a
          provider confirms it — writing the record sets{" "}
          <strong>Pending</strong>, and the list will stay empty until an
          integration exists to populate it.
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
              placeholder="Event type, recipient or template"
            />
          </div>

          <div className="w-44">
            <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-ink">
              Status
            </label>
            <Select id="status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All</option>
              {Object.values(NotificationStatus).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-40">
            <label htmlFor="channel" className="mb-1.5 block text-sm font-medium text-ink">
              Channel
            </label>
            <Select id="channel" name="channel" defaultValue={filters.channel ?? ""}>
              <option value="">All</option>
              {Object.values(NotificationChannel).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {Object.values(filters).some(Boolean) ? (
            <Link href="/admin/notifications" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>Event</Th>
              <Th>Channel</Th>
              <Th>Recipient</Th>
              <Th>Template</Th>
              <Th>Status</Th>
              <Th align="right">Attempts</Th>
              <Th>Provider reference</Th>
              <Th>Created</Th>
            </Tr>
          </Thead>

          <Tbody>
            {result.rows.length === 0 ? (
              <EmptyState
                colSpan={8}
                title="No notifications"
                description="Nothing has been queued, because no delivery provider is configured."
              />
            ) : (
              result.rows.map((notification) => (
                <Tr key={notification.id}>
                  <Td className="font-medium">{notification.eventType}</Td>
                  <Td className="text-ink-muted">{humanise(notification.channel)}</Td>
                  <Td className="text-ink-muted">{notification.recipient}</Td>
                  <Td className="text-ink-muted">{notification.template ?? "—"}</Td>
                  <Td>
                    <Badge tone={STATUS_TONES[notification.status] ?? "neutral"}>
                      {humanise(notification.status)}
                    </Badge>
                    {notification.lastError ? (
                      <div className="mt-0.5 max-w-56 text-xs text-status-danger">
                        {notification.lastError}
                      </div>
                    ) : null}
                  </Td>
                  <Td align="right" numeric>
                    {notification.attemptCount}
                  </Td>
                  <Td className="font-mono text-xs text-ink-subtle">
                    {notification.providerReference ?? "—"}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(notification.createdAt)}
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
