import "dotenv/config";

import { ImapFlow } from "imapflow";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { mysqlPoolConfig } from "../src/lib/db/mysql-url.js";
import { openSecret } from "../src/lib/crypto/secret-box.js";
import { deriveImapHost } from "../src/lib/mail/sent-copy.js";

/**
 * Why a sent message is, or is not, turning up in the Sent folder.
 *
 * Saving to Sent happens after a successful send and must never be allowed to
 * fail one, so the failure path is a warning in the log and nothing else. That
 * is right for a customer's e-ticket and useless when you are standing in
 * front of an empty folder wondering which of six things is wrong.
 *
 * This asks the same questions the send path asks, out loud, against the real
 * mailbox: is the setting on, can we sign in, what folders exist, which one is
 * flagged Sent, and does an APPEND actually succeed.
 *
 * Usage:
 *   npm run mail:check-sent              # report only
 *   npm run mail:check-sent -- --append  # also file a test message
 *
 * On a deployed server the secrets are not in the checkout — `hostinger-deploy`
 * keeps them in `shared/.env` and deletes any `.env` from the release — so
 * load them first:
 *
 *   cd /srv/travel-crm/repo
 *   set -a; . /srv/travel-crm/shared/.env; set +a
 *   npm run mail:check-sent
 *
 * `--append` puts one real message in the Sent folder, which you can then
 * delete from webmail. It is the only part of this that writes anything.
 *
 * Run it through npm rather than tsx directly: the modules it reaches are
 * marked `server-only`, which throws outside a Server Component graph, and the
 * script resolves them with `--conditions=react-server` instead of keeping a
 * second copy of the decryption in sync with the first.
 */

const SECRET_PURPOSE = "mail-account-password";

const shouldAppend = process.argv.includes("--append");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Run via npm so .env is loaded.");
  process.exit(1);
}

// A one-shot script needs barely any pool; two connections keep it from
// competing with a running server for a small MySQL's connection budget.
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(
    mysqlPoolConfig(connectionString, { connectionLimit: 2 }),
  ),
});

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(16)} ${value}`);
}

async function main(): Promise<void> {
  const accounts = await prisma.mailAccount.findMany({
    orderBy: [{ isActive: "desc" }, { label: "asc" }],
  });

  if (accounts.length === 0) {
    console.log(
      "No sending accounts are configured, so every send uses the SMTP_* environment variables.",
    );
    console.log(
      `MAIL_SAVE_TO_SENT is ${process.env["MAIL_SAVE_TO_SENT"] ?? "unset"}; IMAP_HOST is ${
        process.env["IMAP_HOST"] ?? "unset"
      }.`,
    );
    return;
  }

  for (const account of accounts) {
    console.log(`\n${account.label} <${account.fromEmail}>`);
    line("active", account.isActive ? "yes" : "no — never used for sending");
    line("smtp", `${account.host}:${account.port}`);
    line("username", account.username ?? "(none)");

    if (!account.saveToSent) {
      line("save to Sent", "OFF");
      console.log(
        "\n  → This is the answer for this account: nothing is attempted, so nothing is logged.",
      );
      console.log(
        "    Settings → Sending accounts → edit → tick 'Save a copy in the mailbox's Sent folder'.",
      );
      continue;
    }

    line("save to Sent", "on");

    const host = account.imapHost ?? deriveImapHost(account.host);

    if (!host) {
      line("imap host", `none — cannot be derived from ${account.host}`);
      continue;
    }

    line("imap", `${host}:${account.imapPort} ${account.imapSecure ? "TLS" : "plain"}`);
    line("folder", account.sentFolder ?? "(ask the server)");

    if (!account.username || !account.passwordCipher) {
      console.log("\n  → No credentials stored, so there is nothing to sign in with.");
      continue;
    }

    let password: string;
    try {
      password = openSecret(account.passwordCipher, SECRET_PURPOSE);
    } catch (error) {
      console.log(`\n  → The stored password could not be decrypted: ${String(error)}`);
      console.log("    AUTH_SECRET differs from the one that encrypted it.");
      continue;
    }

    const client = new ImapFlow({
      host,
      port: account.imapPort,
      secure: account.imapSecure,
      auth: { user: account.username, pass: password },
      logger: false,
    });

    try {
      await client.connect();
      console.log("\n  Signed in.");

      const mailboxes = await client.list();
      console.log("  Folders the server reports:");
      for (const box of mailboxes) {
        const flag = box.specialUse ? `  ${box.specialUse}` : "";
        console.log(`    ${box.path}${flag}`);
      }

      const flagged = mailboxes.find((box) => box.specialUse === "\\Sent");
      const target = account.sentFolder ?? flagged?.path ?? "Sent";

      console.log(
        flagged
          ? `\n  → Copies go to "${target}" (the server flags it \\Sent).`
          : `\n  → The server flags no folder \\Sent, so copies go to "${target}". If that is not a real folder, set the Sent folder explicitly on the account.`,
      );

      if (shouldAppend) {
        const raw = Buffer.from(
          [
            `From: ${account.fromEmail}`,
            `To: ${account.fromEmail}`,
            "Subject: Sent-folder check",
            `Date: ${new Date().toUTCString()}`,
            `Message-ID: <sent-check-${Date.now()}@${account.fromEmail.split("@")[1]}>`,
            "Content-Type: text/plain; charset=utf-8",
            "",
            "Written by scripts/check-sent-copy.mts. Safe to delete.",
            "",
          ].join("\r\n"),
          "utf8",
        );

        await client.append(target, raw, ["\\Seen"], new Date());
        console.log(`  → Appended a test message to "${target}". Look for it in webmail.`);
      } else {
        console.log("    Re-run with --append to prove an APPEND succeeds.");
      }
    } catch (error) {
      console.log(`\n  → IMAP failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(
        "    This is the same failure the send path logs as 'Could not save a copy to the Sent folder'.",
      );
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
