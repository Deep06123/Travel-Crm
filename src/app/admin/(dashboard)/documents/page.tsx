import type { Metadata } from "next";
import Link from "next/link";
import { Download, Eye, Search } from "lucide-react";

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
import {
  DocumentCategory,
  DocumentOrigin,
  DocumentVerificationStatus,
} from "@/generated/prisma/enums";
import { DocumentUploadForm } from "@/features/documents/upload-form";
import { currentUserCan, requirePermission } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { paginationSchema } from "@/lib/pagination";
import { PERMISSIONS } from "@/lib/permissions";
import { listDocuments } from "@/server/services/document-service";

export const metadata: Metadata = { title: "Documents · Travel CRM" };

function humanise(value: string): string {
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const VERIFICATION_TONES = {
  [DocumentVerificationStatus.UNVERIFIED]: "neutral",
  [DocumentVerificationStatus.VERIFIED]: "success",
  [DocumentVerificationStatus.REJECTED]: "danger",
} as const;

export default async function DocumentsPage({
  searchParams,
}: PageProps<"/admin/documents">) {
  await requirePermission(PERMISSIONS.DOCUMENT_VIEW);
  const canUpload = await currentUserCan(PERMISSIONS.DOCUMENT_UPLOAD);

  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const rawCategory = pick("category");
  const rawStatus = pick("verificationStatus");

  const filters = {
    q: pick("q"),
    category:
      rawCategory && rawCategory in DocumentCategory
        ? (rawCategory as DocumentCategory)
        : undefined,
    verificationStatus:
      rawStatus && rawStatus in DocumentVerificationStatus
        ? (rawStatus as DocumentVerificationStatus)
        : undefined,
  };

  const pagination = paginationSchema.parse({
    page: params["page"] ?? 1,
    pageSize: params["pageSize"] ?? 25,
  });

  const result = await listDocuments(filters, pagination);

  const buildHref = (page: number): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "" && key !== "page") {
        query.set(key, value);
      }
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/admin/documents?${search}` : "/admin/documents";
  };

  return (
    <>
      <PageHeader
        title="Documents"
        description={`${result.total.toLocaleString()} document${result.total === 1 ? "" : "s"} · stored privately, never served by public URL`}
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
                  placeholder="Title, booking number or customer"
                />
              </div>

              <div className="w-52">
                <label htmlFor="category" className="mb-1.5 block text-sm font-medium text-ink">
                  Category
                </label>
                <Select id="category" name="category" defaultValue={filters.category ?? ""}>
                  <option value="">All categories</option>
                  {Object.values(DocumentCategory).map((category) => (
                    <option key={category} value={category}>
                      {humanise(category)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="w-44">
                <label
                  htmlFor="verificationStatus"
                  className="mb-1.5 block text-sm font-medium text-ink"
                >
                  Verification
                </label>
                <Select
                  id="verificationStatus"
                  name="verificationStatus"
                  defaultValue={filters.verificationStatus ?? ""}
                >
                  <option value="">All</option>
                  {Object.values(DocumentVerificationStatus).map((status) => (
                    <option key={status} value={status}>
                      {humanise(status)}
                    </option>
                  ))}
                </Select>
              </div>

              <Button type="submit">
                <Search />
                Search
              </Button>

              {filters.q || filters.category || filters.verificationStatus ? (
                <Link href="/admin/documents" className={buttonVariants({ variant: "ghost" })}>
                  Clear
                </Link>
              ) : null}
            </form>

            <TableShell>
              <Thead>
                <Tr>
                  <Th>Title</Th>
                  <Th>Category</Th>
                  <Th>Linked to</Th>
                  <Th>Origin</Th>
                  <Th>Verification</Th>
                  <Th align="right">Version</Th>
                  <Th>Uploaded</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>

              <Tbody>
                {result.rows.length === 0 ? (
                  <EmptyState
                    colSpan={8}
                    title="No documents"
                    description={
                      canUpload
                        ? "Upload a confirmation, e-ticket or invoice to get started."
                        : "Nothing has been uploaded yet."
                    }
                  />
                ) : (
                  result.rows.map((document) => (
                    <Tr key={document.id}>
                      <Td>
                        <span className="font-medium text-ink">{document.title}</span>
                        {document.currentVersion ? (
                          <div className="text-xs text-ink-muted">
                            {formatBytes(document.currentVersion.sizeBytes)}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-ink-muted">{humanise(document.category)}</Td>
                      <Td>
                        {document.booking ? (
                          <Link
                            href={`/admin/bookings/${document.booking.id}`}
                            className="text-navy-500 hover:underline"
                          >
                            {document.booking.bookingNumber}
                          </Link>
                        ) : document.customer ? (
                          <Link
                            href={`/admin/customers/${document.customer.id}`}
                            className="text-navy-500 hover:underline"
                          >
                            {document.customer.reference}
                          </Link>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </Td>
                      <Td>
                        {/* Spelled out because the plan forbids presenting a
                            self-generated PDF as provider-issued. */}
                        <Badge
                          tone={
                            document.origin === DocumentOrigin.INTERNALLY_GENERATED
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {humanise(document.origin)}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge tone={VERIFICATION_TONES[document.verificationStatus]}>
                          {humanise(document.verificationStatus)}
                        </Badge>
                      </Td>
                      <Td align="right" numeric>
                        {document.currentVersion?.version ?? "—"}
                        {document._count.versions > 1 ? (
                          <span className="text-xs text-ink-muted">
                            {" "}
                            of {document._count.versions}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">
                        {formatDate(document.createdAt)}
                        <div className="text-xs text-ink-subtle">
                          {document.uploadedBy?.name ?? "Unknown"}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          {/* Both routes re-check document.view on every
                              fetch; these are not pre-signed public links. */}
                          <a
                            href={`/api/admin/documents/${document.id}/view`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-navy-500"
                            title="View"
                          >
                            <Eye className="size-4" />
                            <span className="sr-only">View {document.title}</span>
                          </a>
                          <a
                            href={`/api/admin/documents/${document.id}/view?download=1`}
                            className="rounded p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-navy-500"
                            title="Download"
                          >
                            <Download className="size-4" />
                            <span className="sr-only">Download {document.title}</span>
                          </a>
                        </div>
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
        </div>

        {canUpload ? (
          <div>
            <Panel title="Upload document" collapsible={false}>
              <DocumentUploadForm />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
