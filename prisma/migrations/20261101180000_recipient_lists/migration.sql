-- A booking's email now goes to every address in the billing section's
-- Email IDs field, which is a comma-separated list of up to 500 characters.
-- Both columns that record where a message went were VARCHAR(191) and so
-- could not hold one, and silently losing part of the audited recipient is
-- not an acceptable failure for either of these rows.

-- MySQL cannot index a TEXT column without a prefix length, so the index is
-- dropped and rebuilt at the width the column used to have. Lookups are by
-- single address and unaffected.
DROP INDEX `Notification_recipient_idx` ON `Notification`;

ALTER TABLE `Notification` MODIFY `recipient` TEXT NOT NULL;

CREATE INDEX `Notification_recipient_idx` ON `Notification`(`recipient`(191));

-- No index on this one; the evidence of where a signing link was sent.
ALTER TABLE `BookingSignature` MODIFY `recipientEmail` TEXT NOT NULL;
