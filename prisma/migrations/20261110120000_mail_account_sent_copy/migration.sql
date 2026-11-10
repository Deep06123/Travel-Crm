-- Filing a copy of each sent message in the mailbox's Sent folder.
--
-- Saving to Sent is not part of SMTP: a submission server relays the message
-- and keeps nothing. Mail clients fill the folder themselves with a second
-- IMAP APPEND after the send, and that is what these columns configure.
--
-- `saveToSent` defaults to false so no existing account starts opening IMAP
-- connections to a host it was never configured for. Turning it on is a
-- deliberate edit in Settings, per account.
ALTER TABLE `MailAccount`
    ADD COLUMN `saveToSent` BOOLEAN NOT NULL DEFAULT false,
    -- NULL means "derive from the SMTP host", which covers the usual
    -- smtp.example.com / imap.example.com pairing.
    ADD COLUMN `imapHost` VARCHAR(191) NULL,
    ADD COLUMN `imapPort` INTEGER NOT NULL DEFAULT 993,
    ADD COLUMN `imapSecure` BOOLEAN NOT NULL DEFAULT true,
    -- NULL means "ask the server for the folder it flags \Sent". Provider
    -- names differ (Sent, INBOX.Sent, Sent Items) and a wrong guess creates a
    -- stray folder rather than filling the real one.
    ADD COLUMN `sentFolder` VARCHAR(191) NULL;
