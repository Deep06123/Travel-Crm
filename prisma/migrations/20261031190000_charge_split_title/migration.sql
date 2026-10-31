-- A split is a title and an amount, not a card.
--
-- `BookingChargeSplit` was created one migration ago with `cardType` and
-- `cardLast4`, which assumed every division was across cards. It is not: a
-- deposit and a balance, or a fare and an insurance line, are the same
-- division with no second card to name, and the agent had nothing to write
-- except a `note` that was optional and therefore usually empty.
--
-- `title` replaces all three. The card a charge actually went to is recorded
-- on the Payment, which is where the ledger looks for it.
--
-- Added nullable and backfilled before being made NOT NULL, so the statement
-- is safe against rows written between the two migrations rather than relying
-- on the table being empty.

-- AlterTable
ALTER TABLE `BookingChargeSplit` ADD COLUMN `title` VARCHAR(191) NULL;

UPDATE `BookingChargeSplit`
SET `title` = COALESCE(NULLIF(`note`, ''), CONCAT('Charge ', `sequence`))
WHERE `title` IS NULL;

ALTER TABLE `BookingChargeSplit` MODIFY COLUMN `title` VARCHAR(191) NOT NULL;

ALTER TABLE `BookingChargeSplit`
    DROP COLUMN `cardType`,
    DROP COLUMN `cardLast4`,
    DROP COLUMN `note`;
