import type { Metadata } from "next";
import Link from "next/link";
import { Search, ShieldCheck } from "lucide-react";

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
import { AuditAction } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/format";
import { paginationSchema, toPageRequest } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Audit logs · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const ACTION_TONES: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "danger",
  STATUS_CHANGE: "info",
  LOGIN: "neutral",
  LOGOUT: "neutral",
  APPROVE: "success",
  REJECT: "danger",
  EXPORT: "warning",
  VIEW_SENSITIVE: "warning",
};

/** Renders the redacted before/after map compactly. */
function Changes({ changes }: { changes: unknown }) {
  if (!changes || typeof changes !== "object") return null;

  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5">
      {entries.map(([field, change]) => {
        const { before, after } = (change ?? {}) as {
          before?: unknown;
          after?: unknown;
        };

        return (
          <li key={field} className="font-mono text-xs text-ink-subtle">
            {field}: {String(before ?? "—")} → {String(after ?? "—")}
          </li>
        );
      })}
    </ul>
  );
}

export default async function AuditLogsPage({
  searchParams,
}: PageProps<"/admin/audit-logs">) {
  await requirePermission(PERMISSIONS.AUDIT_LOG_VIEW);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawAction = pick("action");

  const filters = {
    q: pick("q"),
    action: rawAction && rawAction in AuditAction ? (rawAction as AuditAction) : undefined,
    entityType: pick("entityType"),
    adminUserId: pick("adminUserId"),
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 50,
  });

  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.adminUserId) where.adminUserId = filters.adminUserId;

  if (filters.q) {
    const term = filters.q.trim();
    where.OR = [
      { summary: { contains: term, mode: "insensitive" } },
      { entityId: { contains: term, mode: "insensitive" } },
    ];
  }

  const { skip, take } = toPageRequest(pagination);

  const [rows, total, actors, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        changes: true,
        ipAddress: true,
        createdAt: true,
        adminUser: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
    prisma.adminUser.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.auditLog.findMany({
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/audit-logs?${search}` : "/admin/audit-logs";
  };

  return (
    <>
      <PageHeader
        title="Audit logs"
        description={`${total.toLocaleString()} recorded action${total === 1 ? "" : "s"}`}
      />

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Entries are append-only — nothing here can be edited or deleted, and a
          correction is a new entry. Passwords, passport numbers and card
          details are redacted before an entry is written, so the trail records
          that a field changed without recording its value.
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
              placeholder="Summary or record id"
            />
          </div>

          <div className="w-48">
            <label htmlFor="action" className="mb-1.5 block text-sm font-medium text-ink">
              Action
            </label>
            <Select id="action" name="action" defaultValue={filters.action ?? ""}>
              <option value="">All</option>
              {Object.values(AuditAction).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-48">
            <label htmlFor="entityType" className="mb-1.5 block text-sm font-medium text-ink">
              Record type
            </label>
            <Select id="entityType" name="entityType" defaultValue={filters.entityType ?? ""}>
              <option value="">All</option>
              {entityTypes.map((row) => (
                <option key={row.entityType} value={row.entityType}>
                  {row.entityType}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-48">
            <label htmlFor="adminUserId" className="mb-1.5 block text-sm font-medium text-ink">
              Actor
            </label>
            <Select id="adminUserId" name="adminUserId" defaultValue={filters.adminUserId ?? ""}>
              <option value="">Anyone</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </Select>
          </div>

          <Button type="submit">
            <Search />
            Search
          </Button>

          {Object.values(filters).some(Boolean) ? (
            <Link href="/admin/audit-logs" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>

        <TableShell>
          <Thead>
            <Tr>
              <Th>When</Th>
              <Th>Action</Th>
              <Th>Record</Th>
              <Th>Summary</Th>
              <Th>Actor</Th>
              <Th>IP</Th>
            </Tr>
          </Thead>

          <Tbody>
            {rows.length === 0 ? (
              <EmptyState colSpan={6} title="No matching entries" />
            ) : (
              rows.map((entry) => (
                <Tr key={entry.id}>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(entry.createdAt)}
                  </Td>
                  <Td>
                    <Badge tone={ACTION_TONES[entry.action] ?? "neutral"}>
                      {humanise(entry.action)}
                    </Badge>
                  </Td>
                  <Td className="text-ink-muted">
                    {entry.entityType}
                    <div className="font-mono text-xs text-ink-subtle">
                      {entry.entityId.slice(0, 12)}…
                    </div>
                  </Td>
                  <Td className="max-w-96">
                    {entry.summary}
                    <Changes changes={entry.changes} />
                  </Td>
                  <Td className="text-ink-muted">
                    {entry.adminUser?.name ?? "System"}
                  </Td>
                  <Td className="font-mono text-xs text-ink-subtle">
                    {entry.ipAddress ?? "—"}
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </TableShell>

        <PaginationControls
          page={pagination.page}
          pageCount={pageCount}
          total={total}
          pageSize={pagination.pageSize}
          buildHref={buildHref}
        />
      </div>
    </>
  );
}
