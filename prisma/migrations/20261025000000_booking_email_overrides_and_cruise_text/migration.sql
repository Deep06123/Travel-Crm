-- Per-booking overrides for the customer email's subject line and the heading
-- shown at the top of the HTML body. Null leaves the template in charge, which
-- is the reproducible default: an automatic confirmation should read the same
-- whoever triggered it.
ALTER TABLE `Booking`
  ADD COLUMN `customEmailSubject` VARCHAR(191) NULL,
  ADD COLUMN `emailTopHeading` VARCHAR(191) NULL;

-- The cruise line's confirmation pasted verbatim, mirroring FlightDetail.pnrText.
-- TEXT rather than VARCHAR because it is pasted correspondence, not a reference.
ALTER TABLE `CruiseDetail`
  ADD COLUMN `reservationText` TEXT NULL;
