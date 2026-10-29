import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { PageHeader } from "@/components/layout/admin-shell";
import { PaginationControls } from "@/components/tables/pagination-controls";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge, BookingStatusBadge } from "@/components/ui/status-badge";
import { CommentVisibility } from "@/generated/prisma/enums";
import { requirePermission } from "@/lib/auth/dal";
import {
  formatCalendarDate,
  formatDateTime,
  isOverdue,
} from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import {
  listLatestComments,
  type CommentFeedFilters,
} from "@/server/services/operations-service";

export const metadata: Metadata = { title: "Latest comments · Travel CRM" };

export default async function CommentsPage({
  searchParams,
}: PageProps<"/admin/comments">) {
  await requirePermission(PERMISSIONS.COMMENT_VIEW);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawVisibility = pick("visibility");

  const filters: CommentFeedFilters = {
    q: pick("q"),
    visibility:
      rawVisibility === "INTERNAL" || rawVisibility === "CUSTOMER_FACING"
        ? rawVisibility
        : undefined,
    withFollowUpOnly: pick("withFollowUpOnly") === "1",
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const result = await listLatestComments(filters, pagination);

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/comments?${search}` : "/admin/comments";
  };

  return (
    <>
      <PageHeader
        title="Latest comments"
        description={`${result.total.toLocaleString()} comment${result.total === 1 ? "" : "s"} across all bookings`}
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
              placeholder="Comment text, category or booking number"
            />
          </div>

          <div className="w-52">
            <label htmlFor="visibility" className="mb-1.5 block text-sm font-medium text-ink">
              Visibility
            </label>
            <Select id="visibility" name="visibility" defaultValue={filters.visibility ?? ""}>
              <option value="">All</option>
              <option value={CommentVisibility.INTERNAL}>Internal only</option>
              <option value={CommentVisibility.CUSTOMER_FACING}>Customer-facing</option>
            </Select>
          </div>

          <label className="flex items-center gap-2 pb-2 text-sm text-ink">
            <input
              type="checkbox"
              name="withFollowUpOnly"
              value="1"
              defaultChecked={filters.withFollowUpOnly}
              className="size-4 rounded border-line-strong"
            />
            With a follow-up date
          </label>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {Object.values(filters).some(Boolean) ? (
            <Link href="/admin/comments" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        {result.rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-muted">
            No comments match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {result.rows.map((comment) => (
              <li key={comment.id} className="p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/bookings/${comment.booking.id}`}
                    className="font-medium text-navy-500 hover:underline"
                  >
                    {comment.booking.bookingNumber}
                  </Link>
                  <BookingStatusBadge status={comment.booking.status} />
                  {/* Internal notes and customer-facing messages are different
                      things, so the distinction is always visible. */}
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
                  <span className="text-xs text-ink-subtle">
                    {comment.booking.customer.firstName}{" "}
                    {comment.booking.customer.lastName}
                  </span>
                </div>

                <p className="text-sm whitespace-pre-wrap text-ink">{comment.body}</p>

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                  <span>{comment.author?.name ?? "Unknown"}</span>
                  <span>{formatDateTime(comment.createdAt)}</span>
                  {comment.followUpAt ? (
                    <span
                      className={
                        isOverdue(comment.followUpAt)
                          ? "font-medium text-status-danger"
                          : undefined
                      }
                    >
                      Follow-up {formatCalendarDate(comment.followUpAt)}
                    </span>
                  ) : null}
                </div>
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
