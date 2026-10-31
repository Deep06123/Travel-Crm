-- Itemises a booking whose total is collected across more than one card.
--
-- `Booking.splitCharges` already said that a total was split, but nothing
-- recorded how: the amounts, and which card took each one, lived only in
-- whatever an agent typed into the notes. These rows hold that division as
-- data, so it can be shown, corrected and checked against the total fare.
--
-- Not a Payment: a Payment is money the ledger has seen and it drives the
-- outstanding balance. A split is the agent's statement of intent at the time
-- the booking was taken, which is written before anything is collected.
--
-- Additive: no existing column or row is touched, and a booking with no
-- splits behaves exactly as it did before.

-- CreateTable
CREATE TABLE `BookingChargeSplit` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `amountMinor` INTEGER NOT NULL,
    `cardType` ENUM('VISA', 'MASTERCARD', 'AMERICAN_EXPRESS', 'DISCOVER', 'DINERS_CLUB', 'JCB', 'OTHER') NOT NULL,
    `cardLast4` CHAR(4) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BookingChargeSplit_bookingId_sequence_idx`(`bookingId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BookingChargeSplit` ADD CONSTRAINT `BookingChargeSplit_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
