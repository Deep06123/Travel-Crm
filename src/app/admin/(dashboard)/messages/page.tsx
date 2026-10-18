import type { Metadata } from "next";
import Link from "next/link";
import { PenLine, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/admin-shell";
import { PaginationControls } from "@/components/tables/pagination-controls";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/status-badge";
import { currentUserCan, requireAuth, requirePermission } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listInbox } from "@/server/services/messaging-service";

export const metadata: Metadata = { title: "Inbox · Travel CRM" };

export default async function InboxPage({
  searchParams,
}: PageProps<"/admin/messages">) {
  await requirePermission(PERMISSIONS.MESSAGE_VIEW);
  const user = await requireAuth();
  const canSend = await currentUserCan(PERMISSIONS.MESSAGE_SEND);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const filters = {
    q: pick("q"),
    unreadOnly: pick("unreadOnly") === "1",
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const result = await listInbox(user.id, filters, pagination);

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/messages?${search}` : "/admin/messages";
  };

  return (
    <>
      <PageHeader
        title="Inbox"
        description={`${result.total.toLocaleString()} message${result.total === 1 ? "" : "s"}${result.unreadCount > 0 ? ` · ${result.unreadCount} unread` : ""}`}
        actions={
          canSend ? (
            <Link href="/admin/messages/compose" className={buttonVariants()}>
              <PenLine />
              Compose
            </Link>
          ) : null
        }
      />

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
              placeholder="Subject or message text"
            />
          </div>

          <label className="flex items-center gap-2 pb-2 text-sm text-ink">
            <input
              type="checkbox"
              name="unreadOnly"
              value="1"
              defaultChecked={filters.unreadOnly}
              className="size-4 rounded border-line-strong"
            />
            Unread only
          </label>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {filters.q || filters.unreadOnly ? (
            <Link href="/admin/messages" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        {result.rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-muted">
            {filters.unreadOnly ? "Nothing unread." : "No messages."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {result.rows.map((entry) => (
              <li
                key={entry.id}
                className={entry.readAt === null ? "bg-navy-50/40 p-4" : "p-4"}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  {entry.readAt === null ? <Badge tone="info">Unread</Badge> : null}
                  <span className="font-medium text-ink">{entry.message.subject}</span>
                  {entry.message.booking ? (
                    <Link
                      href={`/admin/bookings/${entry.message.booking.id}`}
                      className="text-xs text-navy-500 hover:underline"
                    >
                      {entry.message.booking.bookingNumber}
                    </Link>
                  ) : null}
                </div>

                <p className="text-sm whitespace-pre-wrap text-ink">
                  {entry.message.body}
                </p>

                <p className="mt-1.5 text-xs text-ink-muted">
                  From {entry.message.sender?.name ?? "Unknown"} ·{" "}
                  {formatDateTime(entry.message.sentAt ?? entry.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

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
