-- AlterTable
ALTER TABLE `CruiseDetail` ADD COLUMN `sailingName` VARCHAR(191) NULL,
    ADD COLUMN `specialRequest` TEXT NULL,
    ADD COLUMN `deckNumber` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Passenger` ADD COLUMN `previousFirstName` VARCHAR(191) NULL,
    ADD COLUMN `previousLastName` VARCHAR(191) NULL;
