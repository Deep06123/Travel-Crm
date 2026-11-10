import { describe, expect, it } from "vitest";

import { deriveImapHost } from "@/lib/mail/sent-copy";

/**
 * Pairing an IMAP host with an SMTP one.
 *
 * The derivation exists so that turning on "save a copy to Sent" needs one
 * checkbox rather than three fields nobody has to hand. It must stay
 * conservative: a wrong guess is not a harmless default, it is a failed
 * connection on every single send, logged and invisible to the operator who
 * ticked the box.
 */
describe("deriveImapHost", () => {
  it("pairs smtp. with imap. on the same domain", () => {
    expect(deriveImapHost("smtp.hostinger.com")).toBe("imap.hostinger.com");
    expect(deriveImapHost("smtp.gmail.com")).toBe("imap.gmail.com");
    expect(deriveImapHost("smtp.office365.com")).toBe("imap.office365.com");
  });

  it("keeps a combined mail. host, which serves both", () => {
    expect(deriveImapHost("mail.example.com")).toBe("mail.example.com");
  });

  it("is case- and whitespace-insensitive, as a pasted host tends to be", () => {
    expect(deriveImapHost("  SMTP.Hostinger.COM ")).toBe("imap.hostinger.com");
  });

  it("derives nothing from a host that implies no IMAP server", () => {
    // A local catcher has no IMAP at all, and a transactional provider has no
    // mailbox behind it — guessing either would fail on every send.
    expect(deriveImapHost("localhost")).toBeUndefined();
    expect(deriveImapHost("email-smtp.eu-west-1.amazonaws.com")).toBeUndefined();
    expect(deriveImapHost("in-v3.mailjet.com")).toBeUndefined();
  });

  it("does not mistake a domain that merely contains smtp", () => {
    expect(deriveImapHost("mysmtp.example.com")).toBeUndefined();
  });
});
