import type { Metadata } from "next";

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
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/status-badge";
import { MessageGroupForm } from "@/features/messaging/group-form";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { listMessageGroups } from "@/server/services/messaging-service";

export const metadata: Metadata = { title: "Message groups · Travel CRM" };

export default async function MessageGroupsPage() {
  await requirePermission(PERMISSIONS.MESSAGE_GROUP_MANAGE);
  const canManage = await currentUserCan(PERMISSIONS.MESSAGE_GROUP_MANAGE);

  const [groups, members] = await Promise.all([
    listMessageGroups(),
    prisma.adminUser.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const nameById = new Map(members.map((member) => [member.id, member.name]));

  return (
    <>
      <PageHeader
        title="Message groups"
        description={`${groups.length} group${groups.length === 1 ? "" : "s"}`}
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
            <TableShell>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Members</Th>
                  <Th align="right">Messages</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                </Tr>
              </Thead>
              <Tbody>
                {groups.length === 0 ? (
                  <EmptyState
                    colSpan={5}
                    title="No groups"
                    description="A group is a shortcut for addressing the same people repeatedly."
                  />
                ) : (
                  groups.map((group) => (
                    <Tr key={group.id}>
                      <Td>
                        <span className="font-medium">{group.name}</span>
                        {group.description ? (
                          <div className="max-w-72 text-xs text-ink-muted">
                            {group.description}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="max-w-72 text-ink-muted">
                        {group.memberIds.length === 0 ? (
                          <span className="text-ink-subtle">No members</span>
                        ) : (
                          <span className="text-xs">
                            {group.memberIds
                              .map((id: string) => nameById.get(id) ?? "Unknown")
                              .join(", ")}
                          </span>
                        )}
                      </Td>
                      <Td align="right" numeric>
                        {group._count.messages}
                      </Td>
                      <Td>
                        <Badge tone={group.isActive ? "success" : "neutral"}>
                          {group.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">
                        {formatDate(group.createdAt)}
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableShell>
          </div>
        </div>

        {canManage ? (
          <div>
            <Panel title="New group" collapsible={false}>
              <MessageGroupForm members={members} />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
