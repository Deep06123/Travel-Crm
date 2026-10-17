import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminRole,
  DocumentCategory,
  DocumentOrigin,
  DocumentVerificationStatus,
} from "@/generated/prisma/enums";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { getPermissionsForRole, PERMISSIONS } from "@/lib/permissions";
import { getStorage } from "@/lib/storage";
import {
  FileTooLargeError,
  UnsupportedFileTypeError,
  listDocuments,
  readDocumentVersion,
  uploadDocument,
  verifyDocument,
} from "@/server/services/document-service";

/**
 * Document storage and access control against the real database and the real
 * storage adapter.
 *
 * The point of these is the security boundary: content types are verified
 * against the actual bytes rather than the browser's claim, storage keys leak
 * nothing about the traveller, and a role without `document.view` is not
 * granted access.
 */

const SUFFIX = Date.now();
let actorId: string;
const documentIds: string[] = [];
const storageKeys: string[] = [];

/** Minimal but structurally valid PDF bytes. */
function pdfBytes(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    "ascii",
  );
}

/** Minimal PNG: signature plus enough padding to pass the length check. */
function pngBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
  ]);
}

function makeFile(name: string, type: string, body: Buffer): File {
  return new File([new Uint8Array(body)], name, { type });
}

async function upload(file: File, title = "Test document") {
  const result = await uploadDocument(
    {
      file,
      title,
      category: DocumentCategory.E_TICKET,
      origin: DocumentOrigin.PROVIDER_ISSUED,
    },
    actorId,
  );

  documentIds.push(result.documentId);

  const version = await prisma.documentVersion.findFirstOrThrow({
    where: { documentId: result.documentId, version: result.version },
    select: { storageKey: true },
  });
  storageKeys.push(version.storageKey);

  return result;
}

beforeAll(async () => {
  const actor = await prisma.adminUser.create({
    data: {
      email: `document-test-${SUFFIX}@example.invalid`,
      name: "Document Test Actor",
      passwordHash: await hashPassword("irrelevant-for-these-tests"),
      role: AdminRole.OPERATIONS,
    },
    select: { id: true },
  });
  actorId = actor.id;
});

afterAll(async () => {
  const storage = getStorage();
  await Promise.all(storageKeys.map((key) => storage.delete(key).catch(() => undefined)));

  await prisma.auditLog.deleteMany({ where: { adminUserId: actorId } });
  await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  await prisma.adminUser.deleteMany({ where: { id: actorId } });
  await prisma.$disconnect();
});

describe("uploadDocument", () => {
  it("stores the bytes and records metadata", async () => {
    const { documentId, version } = await upload(
      makeFile("ticket.pdf", "application/pdf", pdfBytes()),
    );

    expect(version).toBe(1);

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { currentVersion: true },
    });

    expect(document.currentVersion).not.toBeNull();
    expect(document.currentVersion?.contentType).toBe("application/pdf");
    expect(document.currentVersion?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the stored object an opaque key that leaks nothing", async () => {
    const { documentId } = await upload(
      makeFile("ADAMS-passport-X9988776.pdf", "application/pdf", pdfBytes()),
      "Passport scan for Adams",
    );

    const version = await prisma.documentVersion.findFirstOrThrow({
      where: { documentId },
      select: { storageKey: true, fileName: true },
    });

    // The original name is retained as metadata for display…
    expect(version.fileName).toBe("ADAMS-passport-X9988776.pdf");
    // …but must not appear anywhere in the key, which reaches logs and backups.
    expect(version.storageKey).not.toContain("ADAMS");
    expect(version.storageKey).not.toContain("X9988776");
    expect(version.storageKey).not.toContain("passport");
    expect(version.storageKey).toMatch(/^documents\/\d{4}\/\d{2}\/[0-9a-f]{48}\.pdf$/);
  });

  it("rejects a disallowed content type", async () => {
    await expect(
      upload(makeFile("notes.txt", "text/plain", Buffer.from("hello world"))),
    ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
  });

  it("rejects bytes that do not match the declared type", async () => {
    // A script payload claiming to be a PNG. Trusting the browser's content
    // type here would let it be stored and later served back.
    const payload = Buffer.from("<script>alert(1)</script>", "ascii");

    await expect(
      upload(makeFile("evil.png", "image/png", payload)),
    ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
  });

  it("rejects a file above the configured limit", async () => {
    const huge = Buffer.concat([pdfBytes(), Buffer.alloc(30 * 1024 * 1024, 0)]);

    await expect(
      upload(makeFile("huge.pdf", "application/pdf", huge)),
    ).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it("accepts PNG as well as PDF", async () => {
    const { documentId } = await upload(makeFile("scan.png", "image/png", pngBytes()));

    const version = await prisma.documentVersion.findFirstOrThrow({
      where: { documentId },
      select: { contentType: true },
    });

    expect(version.contentType).toBe("image/png");
  });

  it("writes an audit entry that does not contain the filename", async () => {
    const { documentId } = await upload(
      makeFile("JONES-passport.pdf", "application/pdf", pdfBytes()),
    );

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Document", entityId: documentId },
    });

    expect(entry.summary).not.toContain("JONES");
    expect(entry.summary).not.toContain("passport.pdf");
  });
});

describe("versioning", () => {
  it("adds a second version and makes it current", async () => {
    const first = await upload(makeFile("v1.pdf", "application/pdf", pdfBytes()));

    const second = await uploadDocument(
      {
        file: makeFile("v2.pdf", "application/pdf", Buffer.concat([pdfBytes(), Buffer.from("v2")])),
        title: "Test document",
        category: DocumentCategory.E_TICKET,
        origin: DocumentOrigin.PROVIDER_ISSUED,
        documentId: first.documentId,
      },
      actorId,
    );

    expect(second.version).toBe(2);

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: first.documentId },
      include: { currentVersion: true, versions: true },
    });

    expect(document.versions).toHaveLength(2);
    expect(document.currentVersion?.version).toBe(2);

    const key = document.versions.find((v) => v.version === 2)?.storageKey;
    if (key) storageKeys.push(key);
  });

  it("resets verification when a new version is uploaded", async () => {
    const first = await upload(makeFile("doc.pdf", "application/pdf", pdfBytes()));

    await verifyDocument(
      first.documentId,
      DocumentVerificationStatus.VERIFIED,
      "Checked against the airline record",
      actorId,
    );

    const beforeNewVersion = await prisma.document.findUniqueOrThrow({
      where: { id: first.documentId },
      select: { verificationStatus: true },
    });
    expect(beforeNewVersion.verificationStatus).toBe(
      DocumentVerificationStatus.VERIFIED,
    );

    await uploadDocument(
      {
        file: makeFile("doc-v2.pdf", "application/pdf", Buffer.concat([pdfBytes(), Buffer.from("x")])),
        title: "Test document",
        category: DocumentCategory.E_TICKET,
        origin: DocumentOrigin.PROVIDER_ISSUED,
        documentId: first.documentId,
      },
      actorId,
    );

    // Nobody has checked the new bytes, so the old verification must not carry
    // over to them.
    const after = await prisma.document.findUniqueOrThrow({
      where: { id: first.documentId },
      select: { verificationStatus: true, verifiedById: true, verifiedAt: true },
    });

    expect(after.verificationStatus).toBe(DocumentVerificationStatus.UNVERIFIED);
    expect(after.verifiedById).toBeNull();
    expect(after.verifiedAt).toBeNull();

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: first.documentId },
      select: { storageKey: true },
    });
    storageKeys.push(...versions.map((v) => v.storageKey));
  });

  it("reads a specific version as well as the current one", async () => {
    const first = await upload(makeFile("a.pdf", "application/pdf", pdfBytes()));

    const v2Body = Buffer.concat([pdfBytes(), Buffer.from("SECOND")]);
    await uploadDocument(
      {
        file: makeFile("b.pdf", "application/pdf", v2Body),
        title: "Test document",
        category: DocumentCategory.E_TICKET,
        origin: DocumentOrigin.PROVIDER_ISSUED,
        documentId: first.documentId,
      },
      actorId,
    );

    const current = await readDocumentVersion(first.documentId);
    const original = await readDocumentVersion(first.documentId, 1);

    expect(current?.body.includes("SECOND")).toBe(true);
    expect(original?.body.includes("SECOND")).toBe(false);

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: first.documentId },
      select: { storageKey: true },
    });
    storageKeys.push(...versions.map((v) => v.storageKey));
  });
});

describe("access control", () => {
  it("grants document.view to roles that should read documents", async () => {
    for (const role of [
      AdminRole.SUPER_ADMIN,
      AdminRole.OPERATIONS,
      AdminRole.FINANCE,
      AdminRole.SUPPORT,
    ]) {
      const granted = await getPermissionsForRole(role);
      expect(granted.has(PERMISSIONS.DOCUMENT_VIEW)).toBe(true);
    }
  });

  it("withholds upload and verify from roles that only read", async () => {
    const readOnly = await getPermissionsForRole(AdminRole.READ_ONLY);

    expect(readOnly.has(PERMISSIONS.DOCUMENT_VIEW)).toBe(true);
    expect(readOnly.has(PERMISSIONS.DOCUMENT_UPLOAD)).toBe(false);
    expect(readOnly.has(PERMISSIONS.DOCUMENT_VERIFY)).toBe(false);
    expect(readOnly.has(PERMISSIONS.DOCUMENT_DELETE)).toBe(false);
  });

  it("withholds verification from support", async () => {
    const support = await getPermissionsForRole(AdminRole.SUPPORT);
    expect(support.has(PERMISSIONS.DOCUMENT_VERIFY)).toBe(false);
  });
});

describe("verifyDocument", () => {
  it("records who verified and when", async () => {
    const { documentId } = await upload(makeFile("v.pdf", "application/pdf", pdfBytes()));

    await verifyDocument(
      documentId,
      DocumentVerificationStatus.VERIFIED,
      "Matches the supplier confirmation",
      actorId,
    );

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: {
        verificationStatus: true,
        verifiedById: true,
        verifiedAt: true,
        verificationNotes: true,
      },
    });

    expect(document.verificationStatus).toBe(DocumentVerificationStatus.VERIFIED);
    expect(document.verifiedById).toBe(actorId);
    expect(document.verifiedAt).not.toBeNull();
    expect(document.verificationNotes).toBe("Matches the supplier confirmation");
  });

  it("supports rejection as well as approval", async () => {
    const { documentId } = await upload(makeFile("r.pdf", "application/pdf", pdfBytes()));

    await verifyDocument(
      documentId,
      DocumentVerificationStatus.REJECTED,
      "Wrong passenger",
      actorId,
    );

    const document = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { verificationStatus: true },
    });

    expect(document.verificationStatus).toBe(DocumentVerificationStatus.REJECTED);
  });
});

describe("listDocuments", () => {
  it("filters by verification status", async () => {
    const { documentId } = await upload(makeFile("f.pdf", "application/pdf", pdfBytes()));
    await verifyDocument(documentId, DocumentVerificationStatus.VERIFIED, undefined, actorId);

    const verified = await listDocuments(
      { verificationStatus: DocumentVerificationStatus.VERIFIED },
      { page: 1, pageSize: 100 },
    );

    expect(verified.rows.map((row) => row.id)).toContain(documentId);
    expect(
      verified.rows.every(
        (row) => row.verificationStatus === DocumentVerificationStatus.VERIFIED,
      ),
    ).toBe(true);
  });

  it("paginates", async () => {
    const result = await listDocuments({}, { page: 1, pageSize: 2 });
    expect(result.rows.length).toBeLessThanOrEqual(2);
  });
});
