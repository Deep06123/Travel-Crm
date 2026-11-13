-- The wording a lifecycle email actually went out with.
--
-- The counterpart of `BookingSignature.emailSubject` / `emailBody`, which the
-- migration before this added for the authorization. Same complaint, same
-- shape: an operator edited the e-ticket email, the customer received the
-- edited one, and every preview afterwards re-rendered the booking and showed
-- the generated document instead.
--
-- One row per booking per event — `dedupeKey` is unique — so this column pair
-- is "the message that was last accepted for this event", which is exactly
-- what the preview needs to show. NULL means the generated wording was sent,
-- which is every existing row.
ALTER TABLE `Notification`
    ADD COLUMN `emailSubject` TEXT NULL,
    ADD COLUMN `emailBody` TEXT NULL;
