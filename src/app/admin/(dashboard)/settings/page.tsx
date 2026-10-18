import type { Metadata } from "next";
import { Lock } from "lucide-react";

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
import {
  BookingStatus,
  DocumentCategory,
  RefundStatus,
  TicketStatus,
} from "@/generated/prisma/enums";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { allowedTransitionsFrom } from "@/lib/bookings/status";
import { prisma } from "@/lib/db/prisma";
import { allowedRefundTransitionsFrom } from "@/lib/financial/refund-rules";
import { formatMoney } from "@/lib/financial/money";
import { PERMISSIONS } from "@/lib/permissions";
import { listBookingTypes } from "@/server/services/reference-data-service";

export const metadata: Metadata = { title: "Settings · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Renders a stored JSON setting readably. */
function renderValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");

  if (key === "refund_approval_threshold_minor" && typeof value === "number") {
    return formatMoney(value, "USD");
  }

  if (key === "document_max_bytes" && typeof value === "number") {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  return String(value);
}

export default async function SettingsPage() {
  await requirePermission(PERMISSIONS.SETTINGS_VIEW);
  const canManage = await currentUserCan(PERMISSIONS.SETTINGS_MANAGE);

  const [settings, bookingTypes] = await Promise.all([
    prisma.businessSetting.findMany({ orderBy: { key: "asc" } }),
    listBookingTypes(),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Business configuration and the fixed vocabularies reports depend on"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Business settings" collapsible={false}>
          <TableShell>
            <Thead>
              <Tr>
                <Th>Setting</Th>
                <Th>Value</Th>
              </Tr>
            </Thead>
            <Tbody>
              {settings.length === 0 ? (
                <EmptyState colSpan={2} title="No settings stored" />
              ) : (
                settings.map((setting) => (
                  <Tr key={setting.id}>
                    <Td>
                      <span className="font-medium">
                        {humanise(setting.key.replace(/_minor$/, ""))}
                      </span>
                      {setting.description ? (
                        <div className="max-w-80 text-xs text-ink-muted">
                          {setting.description}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="tabular">
                      {renderValue(setting.key, setting.value)}
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </TableShell>

          {!canManage ? (
            <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              Your role can read these but not change them.
            </p>
          ) : null}
        </Panel>

        <Panel title="Booking types" collapsible={false}>
          <TableShell>
            <Thead>
              <Tr>
                <Th>Label</Th>
                <Th>Code</Th>
                <Th align="right">Bookings</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {bookingTypes.length === 0 ? (
                <EmptyState colSpan={4} title="No booking types" />
              ) : (
                bookingTypes.map((type) => (
                  <Tr key={type.id}>
                    <Td className="font-medium">{type.label}</Td>
                    <Td className="font-mono text-xs text-ink-muted">{type.code}</Td>
                    <Td align="right" numeric>
                      {type._count.bookings}
                    </Td>
                    <Td>
                      <Badge tone={type.isActive ? "success" : "neutral"}>
                        {type.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </TableShell>

          <p className="mt-3 text-xs text-ink-muted">
            Booking types are operator-configurable because reports group by the
            stable <code className="rounded bg-surface-sunken px-1">code</code>,
            not the label. Renaming a type is safe; its code never changes.
          </p>
        </Panel>

        <Panel title="Booking lifecycle" collapsible={false} className="lg:col-span-2">
          <p className="mb-3 text-sm text-ink-muted">
            These statuses and their permitted moves are fixed in code, not
            editable here. Reports, work queues and the evidence rules all depend
            on them, so an administrator cannot invent a status that would break
            them.
          </p>

          <TableShell>
            <Thead>
              <Tr>
                <Th>Status</Th>
                <Th>Can move to</Th>
              </Tr>
            </Thead>
            <Tbody>
              {Object.values(BookingStatus).map((status) => {
                const allowed = allowedTransitionsFrom(status);

                return (
                  <Tr key={status}>
                    <Td className="font-medium">{humanise(status)}</Td>
                    <Td>
                      {allowed.length === 0 ? (
                        <span className="text-sm text-ink-subtle">
                          Final — no further moves
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {allowed.map((target) => (
                            <Badge key={target} tone="neutral">
                              {humanise(target)}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableShell>
        </Panel>

        <Panel title="Refund lifecycle" collapsible={false}>
          <TableShell>
            <Thead>
              <Tr>
                <Th>Status</Th>
                <Th>Can move to</Th>
              </Tr>
            </Thead>
            <Tbody>
              {Object.values(RefundStatus).map((status) => {
                const allowed = allowedRefundTransitionsFrom(status);

                return (
                  <Tr key={status}>
                    <Td className="font-medium">{humanise(status)}</Td>
                    <Td>
                      {allowed.length === 0 ? (
                        <span className="text-sm text-ink-subtle">Final</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {allowed.map((target) => (
                            <Badge key={target} tone="neutral">
                              {humanise(target)}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableShell>
        </Panel>

        <Panel title="Fixed vocabularies" collapsible={false}>
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="mb-1.5 text-sm font-semibold text-ink">Ticket statuses</h3>
              <div className="flex flex-wrap gap-1">
                {Object.values(TicketStatus).map((status) => (
                  <Badge key={status} tone="neutral">
                    {humanise(status)}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-1.5 text-sm font-semibold text-ink">
                Document categories
              </h3>
              <div className="flex flex-wrap gap-1">
                {Object.values(DocumentCategory).map((category) => (
                  <Badge key={category} tone="neutral">
                    {humanise(category)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
