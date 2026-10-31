-- Removes the previous-name fields from Passenger.
--
-- These recorded the name a traveller held before a name-change request, so an
-- authorisation document could show the old name beside the new one. The
-- booking form no longer collects them and nothing displays them, so the
-- columns are dropped rather than left to accumulate nulls.
--
-- DESTRUCTIVE: any prior name still stored is deleted and cannot be recovered.

-- AlterTable
ALTER TABLE `Passenger` DROP COLUMN `previousFirstName`,
    DROP COLUMN `previousLastName`;
