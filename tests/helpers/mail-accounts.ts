import { prisma } from "@/lib/db/prisma";
import { resetMailAccountCache } from "@/server/services/mail-account-service";

/**
 * Pins the sending accounts for a test file, for the same reason
 * `takeAdminNoticeSetting` pins the notification addresses.
 *
 * Integration tests run against the real development database, so an account
 * an operator added in Settings is live for them too — and `resolveMailer`
 * prefers a configured account over the `SMTP_*` environment. A file that sets
 * `SMTP_HOST` to its own sink and then asserts on what crossed the socket
 * would be sending through somebody else's mailbox instead.
 *
 * Disables rather than deletes: these rows hold an operator's credentials, and
 * a test file is not entitled to destroy them to make its own assertions
 * simpler. The ids are returned so the originals can be switched back on.
 */
export type SuspendedAccounts = readonly string[];

/** Disables every active account and returns the ids that were disabled. */
export async function suspendMailAccounts(): Promise<SuspendedAccounts> {
  const active = await prisma.mailAccount.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  if (active.length > 0) {
    await prisma.mailAccount.updateMany({
      where: { id: { in: active.map((row) => row.id) } },
      data: { isActive: false },
    });
  }

  // Built adapters are keyed by id and `updatedAt`, so a row disabled here
  // could still be served from the cache to a resolver that ran earlier.
  resetMailAccountCache();

  return active.map((row) => row.id);
}

/** Puts back exactly what `suspendMailAccounts` switched off. */
export async function restoreMailAccounts(
  ids: SuspendedAccounts,
): Promise<void> {
  if (ids.length > 0) {
    await prisma.mailAccount.updateMany({
      where: { id: { in: [...ids] } },
      data: { isActive: true },
    });
  }

  resetMailAccountCache();
}
