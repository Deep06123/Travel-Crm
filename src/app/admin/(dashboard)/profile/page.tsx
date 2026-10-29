import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, Monitor } from "lucide-react";

import { PageHeader } from "@/components/layout/admin-shell";
import { buttonVariants } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/status-badge";
import { AdminUserStatus } from "@/generated/prisma/enums";
import { getCurrentUserPermissions, requireAuth } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/format";
import { PERMISSION_DEFINITIONS } from "@/lib/permissions";

export const metadata: Metadata = { title: "My profile · Travel CRM" };

/**
 * The signed-in administrator's own account.
 *
 * Reached from the name in the top-right of every page, which linked here
 * before the route existed — so every page prefetched a 404 and clicking it
 * went nowhere.
 *
 * Read-only on purpose. Editing an administrator — name, role, status — is
 * `adminUser.manage` and belongs on the agents screen, where the person making
 * the change is not the person being changed. What an account holder needs
 * from their own page is to confirm who the system thinks they are, see what
 * that lets them do, check nothing else is signed in as them, and change their
 * password. No permission is required beyond being signed in: there is nothing
 * here that is not already the viewer's own.
 */

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <dt className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm text-ink">{value || "—"}</dd>
    </div>
  );
}

const STATUS_TONE = {
  [AdminUserStatus.ACTIVE]: "success",
  [AdminUserStatus.SUSPENDED]: "warning",
  [AdminUserStatus.DEACTIVATED]: "danger",
} as const;

/** "Chrome on Linux" from a user-agent string, or null when unreadable. */
function describeClient(userAgent: string | null): string | null {
  if (!userAgent) return null;

  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\//.test(userAgent) ? "Opera"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : null;

  const platform =
    /Windows/.test(userAgent) ? "Windows"
    : /Macintosh|Mac OS/.test(userAgent) ? "macOS"
    : /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform;
}

export default async function ProfilePage() {
  const user = await requireAuth();

  const [account, sessions, permissions] = await Promise.all([
    prisma.adminUser.findUnique({
      where: { id: user.id },
      select: {
        phone: true,
        lastLoginAt: true,
        passwordChangedAt: true,
        createdAt: true,
      },
    }),
    // Only what is still usable. A revoked or expired row is history, and
    // listing it would suggest someone is signed in who is not.
    prisma.adminSession.findMany({
      where: {
        adminUserId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        lastActiveAt: true,
        createdAt: true,
        ipAddress: true,
        userAgent: true,
      },
      orderBy: { lastActiveAt: "desc" },
    }),
    getCurrentUserPermissions(),
  ]);

  // Grouped by the catalogue's own categories, so this page cannot drift from
  // what the permission catalogue says the role actually holds.
  const granted = PERMISSION_DEFINITIONS.filter((definition) =>
    permissions.has(definition.key as never),
  );

  const byCategory = new Map<string, typeof granted>();
  for (const definition of granted) {
    byCategory.set(definition.category, [
      ...(byCategory.get(definition.category) ?? []),
      definition,
    ]);
  }

  return (
    <>
      <PageHeader
        title={user.name}
        description={`${humanise(user.role)} · ${user.email}`}
        actions={
          <Link
            href="/admin/change-password"
            className={buttonVariants({ variant: "secondary" })}
          >
            <KeyRound />
            Change password
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Panel title="Account" collapsible={false}>
            <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              <DetailRow label="Name" value={user.name} />
              <DetailRow label="Email" value={user.email} />
              <DetailRow label="Username" value={user.username} />
              <DetailRow label="Phone" value={account?.phone} />
              <DetailRow label="Role" value={humanise(user.role)} />
              <DetailRow
                label="Status"
                value={
                  <Badge tone={STATUS_TONE[user.status]}>
                    {humanise(user.status)}
                  </Badge>
                }
              />
              <DetailRow
                label="Last sign-in"
                value={formatDateTime(account?.lastLoginAt)}
              />
              <DetailRow
                label="Password changed"
                value={formatDateTime(account?.passwordChangedAt)}
              />
              <DetailRow
                label="Account created"
                value={formatDateTime(account?.createdAt)}
              />
            </dl>

            <p className="mt-3 text-xs text-ink-subtle">
              Your name, role and status are set by an administrator on the
              agents screen. Ask one of them if any of this is wrong.
            </p>
          </Panel>

          <Panel title="Permissions" collapsible={false}>
            {granted.length === 0 ? (
              <p className="text-sm text-ink-muted">
                This role holds no capabilities. You will not be able to do
                much until an administrator grants some.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {[...byCategory.entries()].map(([category, definitions]) => (
                  <div key={category}>
                    <h3 className="mb-1.5 text-xs font-semibold tracking-wider text-ink-muted uppercase">
                      {category}
                    </h3>
                    <ul className="flex flex-col gap-1">
                      {definitions.map((definition) => (
                        <li
                          key={definition.key}
                          className="text-sm text-ink"
                        >
                          {definition.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 text-xs text-ink-subtle">
              {granted.length} of {PERMISSION_DEFINITIONS.length} capabilities,
              from the {humanise(user.role)} role.
            </p>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Signed-in devices" collapsible={false}>
            <ol className="divide-y divide-line">
              {sessions.map((session) => {
                const isCurrent = session.id === user.sessionId;
                const client = describeClient(session.userAgent);

                return (
                  <li key={session.id} className="flex gap-3 py-2.5">
                    <Monitor className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm text-ink">
                        {client ?? "Unrecognised browser"}
                        {isCurrent ? (
                          <Badge tone="info">This device</Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {session.ipAddress ?? "Unknown address"}
                      </p>
                      <p className="text-xs text-ink-subtle">
                        Active {formatDateTime(session.lastActiveAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            <p className="mt-3 text-xs text-ink-subtle">
              Signing out ends this device&apos;s session only. If you do not
              recognise one of these, change your password and tell an
              administrator — they can revoke the rest.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
