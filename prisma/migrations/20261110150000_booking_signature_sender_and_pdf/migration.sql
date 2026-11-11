-- Who the authorization invitation came from, and where the signed
-- confirmation PDF ended up.
--
-- The confirmation email that follows a signature must go back to the mailbox
-- that issued the invitation, which can be days earlier and need not still be
-- the configured default. `sentById` already records which *person* sent it;
-- these record which *mailbox* did.
--
-- All three are NULL on existing rows: invitations sent before this migration
-- have no captured sender, and nothing retroactively invents one. The
-- confirmation path treats a NULL `senderEmail` as "nowhere to send it" and
-- records a suppressed notification rather than guessing an address.
ALTER TABLE `BookingSignature`
    -- TEXT, matching `recipientEmail`: a sender line may legitimately carry a
    -- quoted display name alongside the address.
    ADD COLUMN `senderEmail` TEXT NULL,
    ADD COLUMN `senderMailAccountId` VARCHAR(191) NULL,
    -- Storage key, not bytes. A non-null value is what makes a retried
    -- confirmation re-read the delivered document instead of rendering a
    -- second one that would differ from it.
    ADD COLUMN `confirmationPdfKey` VARCHAR(191) NULL;

CREATE INDEX `BookingSignature_senderMailAccountId_idx`
    ON `BookingSignature`(`senderMailAccountId`);

-- SET NULL rather than CASCADE, as on `Notification.mailAccountId`: deleting a
-- sending account must not delete the signature evidence that was collected
-- through it. `senderEmail` survives the deletion and still names the mailbox.
ALTER TABLE `BookingSignature`
    ADD CONSTRAINT `BookingSignature_senderMailAccountId_fkey`
    FOREIGN KEY (`senderMailAccountId`) REFERENCES `MailAccount`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
