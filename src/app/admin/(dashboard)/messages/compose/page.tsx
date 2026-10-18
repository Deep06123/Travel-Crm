import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/admin-shell";
import { Panel } from "@/components/ui/panel";
import { ComposeForm } from "@/features/messaging/compose-form";
import { requireAuth, requirePermission } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/prisma";
import { PERMISSIONS } from "@/lib/permissions";
import { listMessageGroups } from "@/server/services/messaging-service";

export const metadata: Metadata = { title: "Compose · Travel CRM" };

export default async function ComposePage() {
  await requirePermission(PERMISSIONS.MESSAGE_SEND);
  const user = await requireAuth();

  const [recipients, groups] = await Promise.all([
    prisma.adminUser.findMany({
      // Sending to yourself is not useful, so you are excluded from the list.
      where: { status: "ACTIVE", id: { not: user.id } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    listMessageGroups(),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Compose message"
        description="Internal message to other administrators"
      />

      <Panel title="New message" collapsible={false}>
        <ComposeForm
          recipients={recipients}
          groups={groups
            .filter((group) => group.isActive)
            .map((group) => ({
              id: group.id,
              name: group.name,
              memberCount: group.memberIds.length,
            }))}
        />
      </Panel>
    </div>
  );
}
