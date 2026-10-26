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
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/status-badge";
import { AdminRole, AdminUserStatus } from "@/generated/prisma/enums";
import { CreateAgentForm } from "@/features/admin/agent-forms";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatDate, formatDateTime } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listAgents } from "@/server/services/agent-service";

export const metadata: Metadata = { title: "Agents · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const STATUS_TONES = {
  [AdminUserStatus.ACTIVE]: "success",
  [AdminUserStatus.SUSPENDED]: "warning",
  [AdminUserStatus.DEACTIVATED]: "neutral",
} as const;

export default async function AgentsPage({
  searchParams,
}: PageProps<"/admin/agents">) {
  await requirePermission(PERMISSIONS.AGENT_VIEW);
  const canManage = await currentUserCan(PERMISSIONS.AGENT_MANAGE);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawRole = pick("role");
  const rawStatus = pick("status");

  const filters = {
    q: pick("q"),
    role: rawRole && rawRole in AdminRole ? (rawRole as AdminRole) : undefined,
    status:
      rawStatus && rawStatus in AdminUserStatus
        ? (rawStatus as AdminUserStatus)
        : undefined,
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const result = await listAgents(filters, pagination);

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/agents?${search}` : "/admin/agents";
  };

  return (
    <>
      <PageHeader
        title="Agents"
        description={`${result.total.toLocaleString()} account${result.total === 1 ? "" : "s"}`}
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
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
                  placeholder="Name, email, username, phone or dialer id"
                />
              </div>

              <div className="w-44">
                <label htmlFor="role" className="mb-1.5 block text-sm font-medium text-ink">
                  Role
                </label>
                <Select id="role" name="role" defaultValue={filters.role ?? ""}>
                  <option value="">All roles</option>
                  {Object.values(AdminRole).map((role) => (
                    <option key={role} value={role}>
                      {humanise(role)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="w-44">
                <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-ink">
                  Status
                </label>
                <Select id="status" name="status" defaultValue={filters.status ?? ""}>
                  <option value="">All</option>
                  {Object.values(AdminUserStatus).map((value) => (
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
                <Link href="/admin/agents" className={buttonVariants({ variant: "ghost" })}>
                  Clear
                </Link>
              ) : null}
            </form>

            <TableShell>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Username / dialer</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  {canManage ? <Th>Pending password</Th> : null}
                  <Th>Last sign-in</Th>
                  <Th>Created</Th>
                </Tr>
              </Thead>

              <Tbody>
                {result.rows.length === 0 ? (
                  <EmptyState
                    colSpan={8}
                    title="No agents"
                    description={
                      canManage
                        ? "Create an account to get started."
                        : "No accounts match your filters."
                    }
                  />
                ) : (
                  result.rows.map((agent) => (
                    <Tr key={agent.id}>
                      <Td>
                        {canManage ? (
                          <Link
                            href={`/admin/agents/${agent.id}`}
                            className="font-medium text-navy-500 hover:underline"
                          >
                            {agent.adminUser.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{agent.adminUser.name}</span>
                        )}
                        {agent.team ? (
                          <div className="text-xs text-ink-muted">{agent.team}</div>
                        ) : null}
                      </Td>
                      <Td className="text-ink-muted">
                        {agent.adminUser.username ?? "—"}
                        {agent.dialerId ? (
                          <div className="text-xs text-ink-subtle">{agent.dialerId}</div>
                        ) : null}
                      </Td>
                      <Td className="text-ink-muted">{agent.adminUser.email}</Td>
                      <Td className="text-ink-muted">{agent.adminUser.phone ?? "—"}</Td>
                      <Td>
                        <Badge tone="info">{humanise(agent.adminUser.role)}</Badge>
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONES[agent.adminUser.status]}>
                          {humanise(agent.adminUser.status)}
                        </Badge>
                        {agent.adminUser.mustChangePassword ? (
                          <div className="mt-0.5 text-xs text-ink-subtle">
                            Must set password
                          </div>
                        ) : null}
                      </Td>
                      {canManage ? (
                        <Td>
                          {agent.adminUser.pendingPassword ? (
                            <code className="rounded bg-status-warning-bg px-1.5 py-0.5 font-mono text-xs break-all text-status-warning">
                              {agent.adminUser.pendingPassword}
                            </code>
                          ) : (
                            <span className="text-xs text-ink-subtle">—</span>
                          )}
                        </Td>
                      ) : null}

                      <Td className="whitespace-nowrap text-ink-muted">
                        {agent.adminUser.lastLoginAt
                          ? formatDateTime(agent.adminUser.lastLoginAt)
                          : "Never"}
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">
                        {formatDate(agent.adminUser.createdAt)}
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

          {/* The reference CRM printed every agent's *real* password here.
              What this column shows is narrower, and the difference is worth
              stating rather than leaving someone to assume the worse one. */}
          <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            “Pending password” is the one-time password an account was created
            or reset with, readable until that account first signs in and then
            erased. Chosen passwords are never shown: they are stored only as
            bcrypt hashes and cannot be displayed or recovered by anyone,
            including super administrators. Use “Reset password” on an agent to
            issue a new one.
          </p>
        </div>

        {canManage ? (
          <div>
            <Panel title="New agent" collapsible={false}>
              <CreateAgentForm />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
