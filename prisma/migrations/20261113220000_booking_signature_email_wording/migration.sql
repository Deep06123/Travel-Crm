-- The covering message an authorization invitation went out with.
--
-- The email is generated from the booking at send time, so nothing recorded
-- what an operator had edited. The preview opened from the booking panel
-- re-rendered the booking as it stands today and showed the generated wording,
-- while the customer was holding an edited message — two different emails, with
-- nothing on screen to say which one had been sent.
--
-- NULL on every existing row, and on any send that used the generated wording.
-- NULL therefore means "generate it", which is what the preview did for every
-- booking before this migration and what it keeps doing for them after it.
--
-- TEXT rather than VARCHAR: the message is paragraphs, and the subject is
-- TEXT for consistency with `recipientEmail` beside it.
ALTER TABLE `BookingSignature`
    ADD COLUMN `emailSubject` TEXT NULL,
    ADD COLUMN `emailBody` TEXT NULL;
