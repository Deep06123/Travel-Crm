import type { Metadata } from "next";
import Link from "next/link";
import { Info, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/admin-shell";
import { PaginationControls } from "@/components/tables/pagination-controls";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Card } from "@/components/ui/panel";
import { Badge } from "@/components/ui/status-badge";
import { MessageStatus } from "@/generated/prisma/enums";
import { requireAuth, requirePermission } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listSent } from "@/server/services/messaging-service";

export const metadata: Metadata = { title: "Sent messages · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const STATUS_TONES: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  DRAFT: "neutral",
  QUEUED: "warning",
  SENDING: "warning",
  SENT: "success",
  FAILED: "danger",
};

export default async function SentPage({
  searchParams,
}: PageProps<"/admin/messages/sent">) {
  await requirePermission(PERMISSIONS.MESSAGE_VIEW);
  const user = await requireAuth();

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const result = await listSent(user.id, { q: pick("q") }, pagination);
  const justSent = pick("sent");

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/messages/sent?${search}` : "/admin/messages/sent";
  };

  return (
    <>
      <PageHeader
        title="Sent messages"
        description={`${result.total.toLocaleString()} message${result.total === 1 ? "" : "s"}`}
      />

      {justSent ? (
        <p
          role="status"
          className="mb-4 rounded-md bg-status-success-bg px-3 py-2 text-sm text-status-success"
        >
          Message delivered to {justSent} recipient
          {justSent === "1" ? "" : "s"}&rsquo; inboxes in this application.
        </p>
      ) : null}

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          &ldquo;Sent&rdquo; here means the message is readable in each
          recipient&rsquo;s inbox in this application. No email or SMS is
          transmitted — no provider is configured — so nothing on this page
          claims a message reached anyone outside the CRM.
        </p>
      </Card>

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-ink">
              Search
            </label>
            <Input id="q" name="q" defaultValue={pick("q") ?? ""} placeholder="Subject or text" />
          </div>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {pick("q") ? (
            <Link href="/admin/messages/sent" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        {result.rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-muted">
            You have not sent any messages.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {result.rows.map((message) => {
              const readCount = message.recipients.filter(
                (recipient) => recipient.readAt !== null,
              ).length;

              return (
                <li key={message.id} className="p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONES[message.status] ?? "neutral"}>
                      {humanise(message.status)}
                    </Badge>
                    <span className="font-medium text-ink">{message.subject}</span>
                    {message.group ? (
                      <span className="text-xs text-ink-muted">
                        via {message.group.name}
                      </span>
                    ) : null}
                    {message.booking ? (
                      <Link
                        href={`/admin/bookings/${message.booking.id}`}
                        className="text-xs text-navy-500 hover:underline"
                      >
                        {message.booking.bookingNumber}
                      </Link>
                    ) : null}
                  </div>

                  <p className="text-sm whitespace-pre-wrap text-ink line-clamp-3">
                    {message.body}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                    {message.status === MessageStatus.DRAFT ? (
                      <span>Draft — no recipients, not sent</span>
                    ) : (
                      <span>
                        {message.recipients.length} recipient
                        {message.recipients.length === 1 ? "" : "s"} · {readCount} read
                      </span>
                    )}
                    <span>{formatDateTime(message.sentAt ?? message.createdAt)}</span>
                    {message.failureReason ? (
                      <span className="text-status-danger">{message.failureReason}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
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
