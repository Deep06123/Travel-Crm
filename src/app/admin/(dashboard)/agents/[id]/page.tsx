import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/admin-shell";
import { Card, Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/status-badge";
import {
  AgentSecurityActions,
  EditAgentForm,
} from "@/features/admin/agent-forms";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/financial/money";
import { formatDate, formatDateTime, isOverdue } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { getAgent, getAgentActivity } from "@/server/services/agent-service";

export const metadata: Metadata = { title: "Agent · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="text-center">
      <p className="tabular text-2xl font-semibold text-navy-500">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </Card>
  );
}

export default async function AgentDetailPage({
  params,
}: PageProps<"/admin/agents/[id]">) {
  await requirePermission(PERMISSIONS.AGENT_VIEW);
  const canManage = await currentUserCan(PERMISSIONS.AGENT_MANAGE);

  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();

  // Last 30 days of activity, matching the dashboard's default window.
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86_400_000);

  const [activity, lockState, recentEvents] = await Promise.all([
    getAgentActivity(agent.adminUser.id, from, to),
    prisma.adminUser.findUniqueOrThrow({
      where: { id: agent.adminUser.id },
      select: { lockedUntil: true, failedLoginAttempts: true, passwordChangedAt: true },
    }),
    prisma.loginEvent.findMany({
      where: { adminUserId: agent.adminUser.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, type: true, createdAt: true, ipAddress: true, reason: true },
    }),
  ]);

  // `isOverdue` keeps Date.now() out of the render path, which React's purity
  // rule forbids. A lockout is "live" while its expiry has NOT passed.
  const isLocked =
    lockState.lockedUntil !== null && !isOverdue(lockState.lockedUntil);

  return (
    <>
      <PageHeader
        title={agent.adminUser.name}
        description={`${agent.adminUser.email} · ${humanise(agent.adminUser.role)}`}
        actions={
          <Link href="/admin/agents" className="text-sm text-navy-500 hover:underline">
            Back to agents
          </Link>
        }
      />

      {isLocked ? (
        <p
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger"
        >
          <Lock className="size-4 shrink-0" />
          This account is locked after {lockState.failedLoginAttempts} failed
          sign-in attempts, until {formatDateTime(lockState.lockedUntil)}.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {canManage ? (
            <Panel title="Account" collapsible={false}>
              <EditAgentForm
                agentId={agent.id}
                defaults={{
                  name: agent.adminUser.name,
                  phone: agent.adminUser.phone ?? "",
                  role: agent.adminUser.role,
                  status: agent.adminUser.status,
                  dialerId: agent.dialerId ?? "",
                  team: agent.team ?? "",
                  isActive: agent.isActive,
                  allowedIpRanges: agent.allowedIpRanges,
                }}
              />
            </Panel>
          ) : (
            <Panel title="Account" collapsible={false}>
              <dl className="grid gap-x-6 sm:grid-cols-2">
                <div className="py-1.5">
                  <dt className="text-xs text-ink-muted uppercase">Role</dt>
                  <dd className="text-sm">{humanise(agent.adminUser.role)}</dd>
                </div>
                <div className="py-1.5">
                  <dt className="text-xs text-ink-muted uppercase">Status</dt>
                  <dd className="text-sm">{humanise(agent.adminUser.status)}</dd>
                </div>
              </dl>
            </Panel>
          )}

          <Panel
            title="Activity"
            description={`${formatDate(from)} – ${formatDate(to)}. Counts and value only — agents are not scored or ranked.`}
            collapsible={false}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Created" value={activity.created} />
              <Metric label="Assigned" value={activity.assigned} />
              <Metric label="Ticketed" value={activity.ticketed} />
              <Metric label="Cancelled" value={activity.cancelled} />
              <Metric label="Open follow-ups" value={activity.openFollowUps} />
              <Metric label="Overdue" value={activity.overdueFollowUps} />
            </div>

            <p className="mt-3 text-sm text-ink-muted">
              Booking value:{" "}
              <span className="tabular font-medium text-ink">
                {activity.bookingValue.length === 0
                  ? formatMoney(0, "USD")
                  : activity.bookingValue
                      .map((row) => formatMoney(row.amountMinor, row.currency))
                      .join(" · ")}
              </span>
            </p>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          {canManage ? (
            <Panel title="Security" collapsible={false}>
              <p className="mb-3 flex items-start gap-2 text-xs text-ink-muted">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                No password can be displayed here. Only a bcrypt hash is stored.
                Password last changed {formatDate(lockState.passwordChangedAt)}.
              </p>

              <AgentSecurityActions agentId={agent.id} isLocked={isLocked} />
            </Panel>
          ) : null}

          <Panel title="Recent sign-in activity" collapsible={false}>
            {recentEvents.length === 0 ? (
              <p className="text-sm text-ink-muted">No sign-in events recorded.</p>
            ) : (
              <ul className="divide-y divide-line">
                {recentEvents.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <Badge
                        tone={
                          event.type === "SUCCESS"
                            ? "success"
                            : event.type === "LOGOUT"
                              ? "neutral"
                              : "danger"
                        }
                      >
                        {humanise(event.type)}
                      </Badge>
                      {event.reason ? (
                        <p className="mt-0.5 text-xs text-ink-muted">{event.reason}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs whitespace-nowrap text-ink-muted">
                        {formatDateTime(event.createdAt)}
                      </p>
                      {event.ipAddress ? (
                        <p className="font-mono text-xs text-ink-subtle">
                          {event.ipAddress}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
