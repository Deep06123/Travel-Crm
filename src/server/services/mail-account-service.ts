import "server-only";

import { AuditAction } from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { openSecret, sealSecret, SecretUnsealError } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db/prisma";
import { loggerFor } from "@/lib/logging/logger";
import { getMailer, SmtpMailAdapter, type MailAdapter } from "@/lib/mail";

const log = loggerFor("mail-account-service");

/**
 * The sending identities an operator configures, and the rules for picking
 * one when a message goes out.
 *
 * Why this exists at all: the address a customer sees is a business decision —
 * authorizations from one mailbox, e-tickets from another, a different brand
 * next quarter — and before this it was an `SMTP_*` environment variable, so
 * changing it meant a server login and a redeploy. Those variables still work
 * and are still the fallback; nothing about an existing deployment changes
 * until the first account is added.
 */

/** Purpose of a message, for choosing a default sender per kind. */
export const MAIL_PURPOSES = [
  "authorization",
  "eticket",
  "confirmation",
  "internal",
] as const;

export type MailPurpose = (typeof MAIL_PURPOSES)[number];

export const MAIL_PURPOSE_LABELS: Record<MailPurpose, string> = {
  authorization: "Customer authorization",
  eticket: "E-ticket",
  confirmation: "Booking confirmation",
  internal: "Internal copies and alerts",
};

/** One row holding the whole map, so reading the defaults is one query. */
export const MAIL_DEFAULTS_SETTING_KEY = "mail_account_defaults";

/** Namespace for the password box; see `sealSecret`. */
const SECRET_PURPOSE = "mail-account-password";

export class MailAccountValidationError extends Error {}

/** An account as the settings page shows it. Never carries the password. */
export interface MailAccountView {
  id: string;
  label: string;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  /** Whether a credential is stored, which is all the page may be told. */
  hasPassword: boolean;
  isActive: boolean;
  verifiedAt: Date | null;
  lastError: string | null;
}

/** The subset a send-time picker needs. */
export interface MailAccountOption {
  id: string;
  label: string;
  fromEmail: string;
  fromName: string | null;
}

export interface MailAccountInput {
  label: string;
  fromEmail: string;
  fromName?: string | undefined;
  replyTo?: string | undefined;
  host: string;
  port: number;
  secure: boolean;
  username?: string | undefined;
  /**
   * Undefined means "leave whatever is stored alone" on an edit, which is how
   * the form can show a password field without the page ever having been sent
   * the current value. An empty string clears it, for a relay that authorises
   * by network.
   */
  password?: string | undefined;
  isActive: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireEmail(value: string, field: string): string {
  const trimmed = value.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(trimmed)) {
    throw new MailAccountValidationError(`${field} must be an email address.`);
  }

  return trimmed;
}

function validate(input: MailAccountInput) {
  const label = input.label.trim();
  if (label === "") {
    throw new MailAccountValidationError("Give the account a name.");
  }

  const host = input.host.trim();
  if (host === "") {
    throw new MailAccountValidationError("An SMTP host is required.");
  }

  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new MailAccountValidationError("The port must be between 1 and 65535.");
  }

  // A username with no password cannot authenticate, and nodemailer would
  // send AUTH with an empty secret rather than failing — which presents as a
  // provider rejection nobody can explain.
  if (input.username?.trim() && input.password === "") {
    throw new MailAccountValidationError(
      "A username needs a password. Clear the username for a relay that authorises by network.",
    );
  }

  return {
    label,
    host,
    fromEmail: requireEmail(input.fromEmail, "The from address"),
    fromName: input.fromName?.trim() || null,
    replyTo: input.replyTo?.trim()
      ? requireEmail(input.replyTo, "The reply-to address")
      : null,
    username: input.username?.trim() || null,
    port: input.port,
    secure: input.secure,
    isActive: input.isActive,
  };
}

function toView(row: {
  id: string;
  label: string;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  passwordCipher: string | null;
  isActive: boolean;
  verifiedAt: Date | null;
  lastError: string | null;
}): MailAccountView {
  const { passwordCipher, ...rest } = row;
  return { ...rest, hasPassword: passwordCipher !== null };
}

export async function listMailAccounts(): Promise<MailAccountView[]> {
  const rows = await prisma.mailAccount.findMany({
    orderBy: [{ isActive: "desc" }, { label: "asc" }],
  });

  return rows.map(toView);
}

/** Active accounts only: what a send-time picker may offer. */
export async function listSendableAccounts(): Promise<MailAccountOption[]> {
  return prisma.mailAccount.findMany({
    where: { isActive: true },
    orderBy: { label: "asc" },
    select: { id: true, label: true, fromEmail: true, fromName: true },
  });
}

/**
 * The configured default sender per purpose.
 *
 * Missing keys and ids of deleted accounts both read as "no default", which
 * `resolveMailer` then resolves further down its chain rather than failing.
 */
export async function loadPurposeDefaults(): Promise<
  Partial<Record<MailPurpose, string>>
> {
  let value: unknown;

  try {
    const row = await prisma.businessSetting.findUnique({
      where: { key: MAIL_DEFAULTS_SETTING_KEY },
      select: { value: true },
    });
    value = row?.value;
  } catch (error) {
    // A send must not fail because the settings lookup did; the caller falls
    // back to the first active account, or to the environment.
    log.error({ err: error }, "Could not load mail account defaults");
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const record = value as Record<string, unknown>;
  const defaults: Partial<Record<MailPurpose, string>> = {};

  for (const purpose of MAIL_PURPOSES) {
    const id = record[purpose];
    if (typeof id === "string" && id !== "") defaults[purpose] = id;
  }

  return defaults;
}

/** Replaces the whole map. An absent or empty id means "no default". */
export async function savePurposeDefaults(
  defaults: Partial<Record<MailPurpose, string | null>>,
  actorId: string,
): Promise<void> {
  const previous = await loadPurposeDefaults();
  const next: Record<string, string> = {};

  for (const purpose of MAIL_PURPOSES) {
    const id = defaults[purpose];
    if (!id) continue;

    const exists = await prisma.mailAccount.findUnique({
      where: { id },
      select: { isActive: true },
    });

    if (!exists) {
      throw new MailAccountValidationError("That sending account no longer exists.");
    }

    // An inactive default is a trap: the settings page would show a sender
    // that `resolveMailer` skips, and nobody would know why mail came from
    // somewhere else.
    if (!exists.isActive) {
      throw new MailAccountValidationError(
        `${MAIL_PURPOSE_LABELS[purpose]} cannot default to a disabled account.`,
      );
    }

    next[purpose] = id;
  }

  await prisma.businessSetting.upsert({
    where: { key: MAIL_DEFAULTS_SETTING_KEY },
    create: {
      key: MAIL_DEFAULTS_SETTING_KEY,
      value: next,
      description: "Which sending account each kind of customer email uses by default.",
    },
    update: { value: next },
  });

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "BusinessSetting",
    entityId: MAIL_DEFAULTS_SETTING_KEY,
    adminUserId: actorId,
    summary: "Changed which account sends each kind of customer email",
    changes: { defaults: { before: previous, after: next } },
  });
}

export async function createMailAccount(
  input: MailAccountInput,
  actorId: string,
): Promise<string> {
  const data = validate(input);

  const clash = await prisma.mailAccount.findUnique({
    where: { label: data.label },
    select: { id: true },
  });

  if (clash) {
    throw new MailAccountValidationError(
      "An account with that name already exists.",
    );
  }

  const account = await prisma.mailAccount.create({
    data: {
      ...data,
      passwordCipher: input.password
        ? sealSecret(input.password, SECRET_PURPOSE)
        : null,
    },
    select: { id: true },
  });

  await recordAudit({
    action: AuditAction.CREATE,
    entityType: "MailAccount",
    entityId: account.id,
    adminUserId: actorId,
    summary: `Added the sending account "${data.label}" <${data.fromEmail}>`,
    changes: {
      host: { before: null, after: `${data.host}:${data.port}` },
      fromEmail: { before: null, after: data.fromEmail },
    },
  });

  return account.id;
}

export async function updateMailAccount(
  id: string,
  input: MailAccountInput,
  actorId: string,
): Promise<void> {
  const data = validate(input);

  const existing = await prisma.mailAccount.findUnique({ where: { id } });
  if (!existing) {
    throw new MailAccountValidationError("That sending account no longer exists.");
  }

  const clash = await prisma.mailAccount.findFirst({
    where: { label: data.label, id: { not: id } },
    select: { id: true },
  });

  if (clash) {
    throw new MailAccountValidationError(
      "An account with that name already exists.",
    );
  }

  // Undefined leaves the stored credential alone — the form never receives it
  // and so cannot echo it back. An empty string is an explicit "no password".
  const passwordCipher =
    input.password === undefined
      ? existing.passwordCipher
      : input.password === ""
        ? null
        : sealSecret(input.password, SECRET_PURPOSE);

  // Any change to the connection invalidates the last successful check: the
  // tick beside the account must mean "these settings worked", not "some
  // earlier settings did".
  const connectionChanged =
    existing.host !== data.host ||
    existing.port !== data.port ||
    existing.secure !== data.secure ||
    existing.username !== data.username ||
    existing.passwordCipher !== passwordCipher;

  await prisma.mailAccount.update({
    where: { id },
    data: {
      ...data,
      passwordCipher,
      ...(connectionChanged ? { verifiedAt: null, lastError: null } : {}),
    },
  });

  await recordAudit({
    action: AuditAction.UPDATE,
    entityType: "MailAccount",
    entityId: id,
    adminUserId: actorId,
    summary: `Edited the sending account "${data.label}"`,
    changes: {
      fromEmail: { before: existing.fromEmail, after: data.fromEmail },
      host: {
        before: `${existing.host}:${existing.port}`,
        after: `${data.host}:${data.port}`,
      },
      isActive: { before: existing.isActive, after: data.isActive },
    },
  });

  forgetAdapter(id);
}

/**
 * Removes an account.
 *
 * The notifications it sent keep their rows — the foreign key is `SET NULL` —
 * so the delivery history survives. Disabling is usually what an operator
 * actually wants, and the settings page says so.
 */
export async function deleteMailAccount(
  id: string,
  actorId: string,
): Promise<void> {
  const existing = await prisma.mailAccount.findUnique({
    where: { id },
    select: { label: true, fromEmail: true },
  });

  if (!existing) return;

  await prisma.mailAccount.delete({ where: { id } });

  // The map is keyed by id, so a stale entry would silently point a purpose at
  // nothing. Rewriting it here keeps the settings page honest.
  const defaults = await loadPurposeDefaults();
  if (Object.values(defaults).includes(id)) {
    const next = Object.fromEntries(
      Object.entries(defaults).filter(([, value]) => value !== id),
    );

    await prisma.businessSetting.upsert({
      where: { key: MAIL_DEFAULTS_SETTING_KEY },
      create: { key: MAIL_DEFAULTS_SETTING_KEY, value: next },
      update: { value: next },
    });
  }

  await recordAudit({
    action: AuditAction.DELETE,
    entityType: "MailAccount",
    entityId: id,
    adminUserId: actorId,
    summary: `Deleted the sending account "${existing.label}" <${existing.fromEmail}>`,
  });

  forgetAdapter(id);
}

/**
 * Opens a connection and authenticates, without sending anything.
 *
 * Worth a button of its own: the alternative way to discover that a password
 * is wrong is a customer not receiving their authorization.
 */
export async function verifyMailAccount(id: string): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const account = await prisma.mailAccount.findUnique({ where: { id } });

  if (!account) return { ok: false, reason: "That account no longer exists." };

  let adapter: SmtpMailAdapter;

  try {
    adapter = buildAdapter(account);
  } catch (error) {
    const reason =
      error instanceof SecretUnsealError
        ? error.message
        : "The account could not be prepared for sending.";
    await prisma.mailAccount.update({
      where: { id },
      data: { verifiedAt: null, lastError: reason },
    });
    return { ok: false, reason };
  }

  try {
    await adapter.verify();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await prisma.mailAccount.update({
      where: { id },
      data: { verifiedAt: null, lastError: reason },
    });
    log.warn({ err: error, mailAccountId: id }, "Mail account verification failed");
    return { ok: false, reason };
  }

  await prisma.mailAccount.update({
    where: { id },
    data: { verifiedAt: new Date(), lastError: null },
  });

  return { ok: true };
}

/**
 * Built adapters, keyed by account and the row's `updatedAt`.
 *
 * nodemailer pools TCP connections per transporter, so one per send would
 * handshake every time and trip provider connection-rate limits. Including
 * `updatedAt` in the key means an edited account is picked up on the next send
 * without a restart, because the old key can never match again.
 */
const adapters = new Map<string, SmtpMailAdapter>();

function forgetAdapter(id: string): void {
  for (const key of adapters.keys()) {
    if (key.startsWith(`${id}:`)) adapters.delete(key);
  }
}

/** Test seam, and the counterpart to `resetMailerCache`. */
export function resetMailAccountCache(): void {
  adapters.clear();
}

type MailAccountRow = {
  id: string;
  label: string;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  passwordCipher: string | null;
  updatedAt: Date;
};

function buildAdapter(account: MailAccountRow): SmtpMailAdapter {
  const key = `${account.id}:${account.updatedAt.getTime()}`;
  const cached = adapters.get(key);
  if (cached) return cached;

  const password = account.passwordCipher
    ? openSecret(account.passwordCipher, SECRET_PURPOSE)
    : undefined;

  const adapter = new SmtpMailAdapter({
    host: account.host,
    port: account.port,
    secure: account.secure,
    ...(account.username ? { user: account.username } : {}),
    ...(password ? { password } : {}),
    // Quoted display name: a comma or a full stop in it would otherwise be
    // read as an address separator by the receiving server.
    from: account.fromName
      ? `"${account.fromName.replace(/"/g, "")}" <${account.fromEmail}>`
      : account.fromEmail,
    ...(account.replyTo ? { replyTo: account.replyTo } : {}),
  });

  adapters.set(key, adapter);
  return adapter;
}

export interface ResolvedMailer {
  adapter: MailAdapter;
  /** Null when the send fell back to the `SMTP_*` environment variables. */
  accountId: string | null;
  /** For the message the operator is shown, e.g. "sent from Reservations". */
  label: string;
}

/**
 * Picks the transport for one message.
 *
 * In order: the account the operator chose for this send, the default for this
 * kind of message, the only active account if there is exactly one, then the
 * `SMTP_*` environment configuration. Returns null when none of those yields a
 * transport, which callers record as a SUPPRESSED notification — an
 * unconfigured mailer must never fail a booking.
 *
 * The "exactly one active account" step is deliberate: a deployment that has
 * added its single mailbox and set no defaults should send from it rather than
 * quietly falling through to a stale environment variable.
 */
export async function resolveMailer(
  purpose: MailPurpose,
  requestedAccountId?: string | null,
): Promise<ResolvedMailer | null> {
  let account: MailAccountRow | null = null;

  try {
    if (requestedAccountId) {
      account = await prisma.mailAccount.findFirst({
        where: { id: requestedAccountId, isActive: true },
      });

      // A chosen account that has been disabled or deleted since the page was
      // rendered falls through to the default rather than failing the send.
      if (!account) {
        log.warn(
          { requestedAccountId, purpose },
          "Requested mail account is unavailable; falling back",
        );
      }
    }

    if (!account) {
      const defaults = await loadPurposeDefaults();
      const defaultId = defaults[purpose];

      if (defaultId) {
        account = await prisma.mailAccount.findFirst({
          where: { id: defaultId, isActive: true },
        });
      }
    }

    if (!account) {
      const active = await prisma.mailAccount.findMany({
        where: { isActive: true },
        take: 2,
      });

      if (active.length === 1) account = active[0]!;
    }
  } catch (error) {
    // Reaching the environment fallback is better than no email at all.
    log.error({ err: error, purpose }, "Mail account lookup failed");
  }

  if (account) {
    try {
      return {
        adapter: buildAdapter(account),
        accountId: account.id,
        label: account.label,
      };
    } catch (error) {
      // A password that cannot be decrypted is a configuration fault, not a
      // reason to send from an unexpected address: a customer receiving an
      // authorization from the wrong sender is worse than not receiving one,
      // and the settings page shows the reason.
      log.error(
        { err: error, mailAccountId: account.id },
        "Mail account could not be prepared for sending",
      );
      return null;
    }
  }

  const fallback = getMailer();
  if (!fallback) return null;

  return { adapter: fallback, accountId: null, label: "the server configuration" };
}
