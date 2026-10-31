-- Customer authorization by email, and the e-signature evidence it returns.
--
-- One row per authorization link sent. Request and capture share a table
-- because they are one fact: a signature with no request behind it would be
-- unattributable, and a request is only interesting alongside what came back.
--
-- `tokenHash` follows `AdminSession`: the raw token exists only in the emailed
-- link, so a dump of this table does not yield usable signing URLs.
--
-- Written by hand rather than generated, because this database user cannot
-- create the shadow database `prisma migrate dev` needs. The statements below
-- are what Prisma emits for the model in `schema.prisma`.
--
-- Additive only: nothing is dropped and no backfill is required.

-- CreateTable
CREATE TABLE `BookingSignature` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `status` ENUM('SENT', 'VIEWED', 'SIGNED', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'SENT',
    `recipientEmail` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentById` VARCHAR(191) NULL,
    `viewedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `signedAt` DATETIME(3) NULL,
    `signatureName` VARCHAR(191) NULL,
    `signedPhone` VARCHAR(191) NULL,
    `consentText` TEXT NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `device` VARCHAR(191) NULL,
    `operatingSystem` VARCHAR(191) NULL,
    `browser` VARCHAR(191) NULL,
    `screenSize` VARCHAR(191) NULL,
    `clientTimezone` VARCHAR(191) NULL,
    `geoCity` VARCHAR(191) NULL,
    `geoRegion` VARCHAR(191) NULL,
    `geoCountry` VARCHAR(191) NULL,
    `geoProvider` VARCHAR(191) NULL,
    `geoRaw` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BookingSignature_tokenHash_key`(`tokenHash`),
    INDEX `BookingSignature_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    INDEX `BookingSignature_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BookingSignature` ADD CONSTRAINT `BookingSignature_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingSignature` ADD CONSTRAINT `BookingSignature_sentById_fkey` FOREIGN KEY (`sentById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
