-- CreateTable
CREATE TABLE `AdminUser` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT', 'READ_ONLY') NOT NULL DEFAULT 'READ_ONLY',
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `passwordChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminUser_email_key`(`email`),
    UNIQUE INDEX `AdminUser_username_key`(`username`),
    INDEX `AdminUser_role_status_idx`(`role`, `status`),
    INDEX `AdminUser_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminSession` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `adminUserId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastActiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AdminSession_tokenHash_key`(`tokenHash`),
    INDEX `AdminSession_adminUserId_revokedAt_idx`(`adminUserId`, `revokedAt`),
    INDEX `AdminSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoginEvent` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('SUCCESS', 'FAILED_PASSWORD', 'FAILED_UNKNOWN_USER', 'LOCKED_OUT', 'LOGOUT', 'SESSION_REVOKED') NOT NULL,
    `identifier` VARCHAR(191) NOT NULL,
    `adminUserId` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoginEvent_adminUserId_createdAt_idx`(`adminUserId`, `createdAt`),
    INDEX `LoginEvent_identifier_createdAt_idx`(`identifier`, `createdAt`),
    INDEX `LoginEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Permission_key_key`(`key`),
    INDEX `Permission_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `id` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT', 'READ_ONLY') NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RolePermission_role_idx`(`role`),
    UNIQUE INDEX `RolePermission_role_permissionId_key`(`role`, `permissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'EXPORT', 'VIEW_SENSITIVE') NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `adminUserId` VARCHAR(191) NULL,
    `summary` TEXT NOT NULL,
    `changes` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    INDEX `AuditLog_adminUserId_createdAt_idx`(`adminUserId`, `createdAt`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'BLOCKED') NOT NULL DEFAULT 'ACTIVE',
    `billingAddressLine1` VARCHAR(191) NULL,
    `billingAddressLine2` VARCHAR(191) NULL,
    `billingCity` VARCHAR(191) NULL,
    `billingState` VARCHAR(191) NULL,
    `billingPostalCode` VARCHAR(191) NULL,
    `billingCountry` VARCHAR(191) NULL,
    `preferredLanguage` VARCHAR(191) NULL DEFAULT 'en',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Customer_reference_key`(`reference`),
    INDEX `Customer_email_idx`(`email`),
    INDEX `Customer_phone_idx`(`phone`),
    INDEX `Customer_lastName_firstName_idx`(`lastName`, `firstName`),
    INDEX `Customer_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerNote` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerNote_customerId_createdAt_idx`(`customerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingType` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `product` ENUM('FLIGHT', 'CRUISE') NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BookingType_code_key`(`code`),
    INDEX `BookingType_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Booking` (
    `id` VARCHAR(191) NOT NULL,
    `bookingNumber` VARCHAR(191) NOT NULL,
    `product` ENUM('FLIGHT', 'CRUISE') NOT NULL,
    `status` ENUM('DRAFT', 'PENDING', 'NEEDS_REVIEW', 'CONFIRMED', 'TICKETED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'DRAFT',
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `bookingTypeId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `assignedAgentId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `mcoSupplierId` VARCHAR(191) NULL,
    `tfnId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NULL,
    `language` VARCHAR(191) NULL DEFAULT 'en',
    `contactName` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `billingAddressLine1` VARCHAR(191) NULL,
    `billingAddressLine2` VARCHAR(191) NULL,
    `billingCity` VARCHAR(191) NULL,
    `billingState` VARCHAR(191) NULL,
    `billingPostalCode` VARCHAR(191) NULL,
    `billingCountry` VARCHAR(191) NULL,
    `ticketStatus` ENUM('NOT_APPLICABLE', 'PENDING', 'IN_PROGRESS', 'ISSUED', 'VOIDED', 'EXCHANGED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `airlineConfirmation` VARCHAR(191) NULL,
    `ticketingReference` VARCHAR(191) NULL,
    `ticketedAt` DATETIME(3) NULL,
    `ticketingNotes` TEXT NULL,
    `mcoStatus` ENUM('NOT_APPLICABLE', 'PENDING', 'SUBMITTED', 'CONFIRMED', 'REJECTED') NOT NULL DEFAULT 'NOT_APPLICABLE',
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `baseFareMinor` INTEGER NOT NULL DEFAULT 0,
    `taxesFeesMinor` INTEGER NOT NULL DEFAULT 0,
    `totalMinor` INTEGER NOT NULL DEFAULT 0,
    `supplierCostMinor` INTEGER NOT NULL DEFAULT 0,
    `grossMcoMinor` INTEGER NOT NULL DEFAULT 0,
    `netMcoMinor` INTEGER NOT NULL DEFAULT 0,
    `splitCharges` BOOLEAN NOT NULL DEFAULT false,
    `financialNotes` TEXT NULL,
    `travelStartDate` DATETIME(3) NULL,
    `travelEndDate` DATETIME(3) NULL,
    `followUpAt` DATETIME(3) NULL,
    `bookedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Booking_bookingNumber_key`(`bookingNumber`),
    INDEX `Booking_status_bookedAt_idx`(`status`, `bookedAt`),
    INDEX `Booking_customerId_bookedAt_idx`(`customerId`, `bookedAt`),
    INDEX `Booking_assignedAgentId_status_idx`(`assignedAgentId`, `status`),
    INDEX `Booking_supplierId_bookedAt_idx`(`supplierId`, `bookedAt`),
    INDEX `Booking_ticketStatus_status_idx`(`ticketStatus`, `status`),
    INDEX `Booking_priority_status_idx`(`priority`, `status`),
    INDEX `Booking_bookedAt_idx`(`bookedAt`),
    INDEX `Booking_followUpAt_idx`(`followUpAt`),
    INDEX `Booking_airlineConfirmation_idx`(`airlineConfirmation`),
    INDEX `Booking_product_status_idx`(`product`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FlightDetail` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `pnrText` TEXT NULL,
    `pnrLocator` VARCHAR(191) NULL,
    `airline` VARCHAR(191) NULL,
    `bookingClass` VARCHAR(191) NULL,
    `origin` CHAR(3) NULL,
    `destination` CHAR(3) NULL,
    `departureDate` DATETIME(3) NULL,
    `returnDate` DATETIME(3) NULL,
    `isRoundTrip` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FlightDetail_bookingId_key`(`bookingId`),
    INDEX `FlightDetail_pnrLocator_idx`(`pnrLocator`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FlightSegment` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `airline` VARCHAR(191) NOT NULL,
    `flightNumber` VARCHAR(191) NOT NULL,
    `origin` CHAR(3) NOT NULL,
    `destination` CHAR(3) NOT NULL,
    `departureAt` DATETIME(3) NOT NULL,
    `arrivalAt` DATETIME(3) NOT NULL,
    `bookingClass` VARCHAR(191) NULL,
    `cabin` VARCHAR(191) NULL,
    `operatingCarrier` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FlightSegment_bookingId_idx`(`bookingId`),
    INDEX `FlightSegment_departureAt_idx`(`departureAt`),
    UNIQUE INDEX `FlightSegment_bookingId_sequence_key`(`bookingId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CruiseDetail` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `cruiseLine` VARCHAR(191) NOT NULL,
    `ship` VARCHAR(191) NULL,
    `reservationNumber` VARCHAR(191) NULL,
    `itinerary` TEXT NULL,
    `departurePort` VARCHAR(191) NULL,
    `arrivalPort` VARCHAR(191) NULL,
    `sailDate` DATETIME(3) NULL,
    `returnDate` DATETIME(3) NULL,
    `nights` INTEGER NULL,
    `cabinNumber` VARCHAR(191) NULL,
    `cabinCategory` VARCHAR(191) NULL,
    `diningPreference` VARCHAR(191) NULL,
    `cabinCount` INTEGER NOT NULL DEFAULT 1,
    `gratuitiesIncluded` BOOLEAN NOT NULL DEFAULT false,
    `insuranceIncluded` BOOLEAN NOT NULL DEFAULT false,
    `assistanceNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CruiseDetail_bookingId_key`(`bookingId`),
    INDEX `CruiseDetail_cruiseLine_sailDate_idx`(`cruiseLine`, `sailDate`),
    INDEX `CruiseDetail_reservationNumber_idx`(`reservationNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Passenger` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `title` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `middleName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `type` ENUM('ADULT', 'CHILD', 'INFANT', 'SENIOR') NOT NULL DEFAULT 'ADULT',
    `gender` VARCHAR(191) NULL,
    `dateOfBirth` DATETIME(3) NULL,
    `passportNumber` VARCHAR(191) NULL,
    `passportCountry` VARCHAR(191) NULL,
    `passportExpiry` DATETIME(3) NULL,
    `frequentFlyerNumber` VARCHAR(191) NULL,
    `cabinNumber` VARCHAR(191) NULL,
    `ticketNumber` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Passenger_bookingId_idx`(`bookingId`),
    INDEX `Passenger_lastName_firstName_idx`(`lastName`, `firstName`),
    INDEX `Passenger_ticketNumber_idx`(`ticketNumber`),
    UNIQUE INDEX `Passenger_bookingId_sequence_key`(`bookingId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingStatusHistory` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `fromStatus` ENUM('DRAFT', 'PENDING', 'NEEDS_REVIEW', 'CONFIRMED', 'TICKETED', 'CANCELLED', 'COMPLETED') NULL,
    `toStatus` ENUM('DRAFT', 'PENDING', 'NEEDS_REVIEW', 'CONFIRMED', 'TICKETED', 'CANCELLED', 'COMPLETED') NOT NULL,
    `reason` TEXT NULL,
    `changedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BookingStatusHistory_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    INDEX `BookingStatusHistory_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingComment` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `category` VARCHAR(191) NULL,
    `visibility` ENUM('INTERNAL', 'CUSTOMER_FACING') NOT NULL DEFAULT 'INTERNAL',
    `authorId` VARCHAR(191) NULL,
    `followUpAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BookingComment_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    INDEX `BookingComment_createdAt_idx`(`createdAt`),
    INDEX `BookingComment_followUpAt_idx`(`followUpAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingFollowUp` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `dueAt` DATETIME(3) NOT NULL,
    `assigneeId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `lastActionAt` DATETIME(3) NULL,
    `lastActionNote` TEXT NULL,
    `resolutionNotes` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BookingFollowUp_status_dueAt_idx`(`status`, `dueAt`),
    INDEX `BookingFollowUp_assigneeId_status_dueAt_idx`(`assigneeId`, `status`, `dueAt`),
    INDEX `BookingFollowUp_bookingId_idx`(`bookingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Document` (
    `id` VARCHAR(191) NOT NULL,
    `category` ENUM('BOOKING_CONFIRMATION', 'FLIGHT_ITINERARY', 'E_TICKET', 'CRUISE_CONFIRMATION', 'INVOICE', 'RECEIPT', 'REFUND_EVIDENCE', 'CHARGEBACK_EVIDENCE', 'GENERAL_ATTACHMENT') NOT NULL,
    `origin` ENUM('PROVIDER_ISSUED', 'INTERNALLY_GENERATED', 'CUSTOMER_SUPPLIED') NOT NULL DEFAULT 'PROVIDER_ISSUED',
    `title` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NULL,
    `currentVersionId` VARCHAR(191) NULL,
    `verificationStatus` ENUM('UNVERIFIED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
    `verifiedById` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verificationNotes` TEXT NULL,
    `uploadedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Document_currentVersionId_key`(`currentVersionId`),
    INDEX `Document_bookingId_category_idx`(`bookingId`, `category`),
    INDEX `Document_customerId_category_idx`(`customerId`, `category`),
    INDEX `Document_category_createdAt_idx`(`category`, `createdAt`),
    INDEX `Document_verificationStatus_idx`(`verificationStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentVersion` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `checksum` VARCHAR(191) NULL,
    `uploadedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DocumentVersion_storageKey_key`(`storageKey`),
    INDEX `DocumentVersion_documentId_idx`(`documentId`),
    UNIQUE INDEX `DocumentVersion_documentId_version_key`(`documentId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `amountMinor` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `method` ENUM('CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'CASH', 'MCO', 'OTHER') NOT NULL,
    `captureMode` ENUM('MANUAL_RECORD', 'PROVIDER_CONFIRMED') NOT NULL DEFAULT 'MANUAL_RECORD',
    `status` ENUM('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'PENDING',
    `provider` VARCHAR(191) NULL,
    `providerTransactionId` VARCHAR(191) NULL,
    `paymentUrl` TEXT NULL,
    `failureReason` TEXT NULL,
    `cardLast4` CHAR(4) NULL,
    `cardBrand` VARCHAR(191) NULL,
    `reconciliationStatus` ENUM('UNRECONCILED', 'MATCHED', 'DISPUTED', 'WRITTEN_OFF') NOT NULL DEFAULT 'UNRECONCILED',
    `reconciledAt` DATETIME(3) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `recordedById` VARCHAR(191) NULL,
    `capturedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_reference_key`(`reference`),
    UNIQUE INDEX `Payment_idempotencyKey_key`(`idempotencyKey`),
    INDEX `Payment_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    INDEX `Payment_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Payment_reconciliationStatus_idx`(`reconciliationStatus`),
    INDEX `Payment_customerId_idx`(`customerId`),
    UNIQUE INDEX `Payment_provider_providerTransactionId_key`(`provider`, `providerTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Refund` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `kind` ENUM('REFUND', 'VOID') NOT NULL DEFAULT 'REFUND',
    `bookingId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NULL,
    `requestedAmountMinor` INTEGER NOT NULL,
    `approvedAmountMinor` INTEGER NULL,
    `currency` CHAR(3) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `requestedById` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `provider` VARCHAR(191) NULL,
    `providerRefundId` VARCHAR(191) NULL,
    `providerResponse` JSON NULL,
    `failureReason` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `evidenceDocumentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Refund_reference_key`(`reference`),
    UNIQUE INDEX `Refund_idempotencyKey_key`(`idempotencyKey`),
    INDEX `Refund_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    INDEX `Refund_status_requestedAt_idx`(`status`, `requestedAt`),
    INDEX `Refund_paymentId_idx`(`paymentId`),
    UNIQUE INDEX `Refund_provider_providerRefundId_key`(`provider`, `providerRefundId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Chargeback` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NULL,
    `disputedAmountMinor` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `reasonCode` VARCHAR(191) NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('RECEIVED', 'EVIDENCE_REQUIRED', 'EVIDENCE_SUBMITTED', 'UNDER_REVIEW', 'WON', 'LOST', 'ACCEPTED') NOT NULL DEFAULT 'RECEIVED',
    `receivedAt` DATETIME(3) NOT NULL,
    `respondBy` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `submissionReference` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolution` TEXT NULL,
    `outcomeAmountMinor` INTEGER NULL,
    `assignedToId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Chargeback_reference_key`(`reference`),
    INDEX `Chargeback_status_respondBy_idx`(`status`, `respondBy`),
    INDEX `Chargeback_bookingId_idx`(`bookingId`),
    INDEX `Chargeback_assignedToId_status_idx`(`assignedToId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChargebackEvidence` (
    `id` VARCHAR(191) NOT NULL,
    `chargebackId` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ChargebackEvidence_chargebackId_documentId_key`(`chargebackId`, `documentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FinancialAdjustment` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `kind` ENUM('SUPPLIER_CREDIT', 'SUPPLIER_DEBIT', 'WRITE_OFF', 'CORRECTION', 'FEE') NOT NULL,
    `amountMinor` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `reason` TEXT NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FinancialAdjustment_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    INDEX `FinancialAdjustment_kind_createdAt_idx`(`kind`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Agent` (
    `id` VARCHAR(191) NOT NULL,
    `adminUserId` VARCHAR(191) NOT NULL,
    `dialerId` VARCHAR(191) NULL,
    `team` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `allowedIpRanges` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Agent_adminUserId_key`(`adminUserId`),
    UNIQUE INDEX `Agent_dialerId_key`(`dialerId`),
    INDEX `Agent_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Supplier` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('AIRLINE', 'CRUISE_LINE', 'CONSOLIDATOR', 'OTA', 'OTHER') NOT NULL,
    `externalId` VARCHAR(191) NULL,
    `contactName` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `supportedProducts` JSON NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Supplier_name_key`(`name`),
    INDEX `Supplier_isActive_type_idx`(`isActive`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `McoSupplier` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `mailFrom` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `McoSupplier_name_key`(`name`),
    INDEX `McoSupplier_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tfn` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tfn_number_key`(`number`),
    INDEX `Tfn_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerServiceCase` (
    `id` VARCHAR(191) NOT NULL,
    `caseNumber` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NULL,
    `category` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `assignedToId` VARCHAR(191) NULL,
    `resolution` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerServiceCase_caseNumber_key`(`caseNumber`),
    INDEX `CustomerServiceCase_status_priority_createdAt_idx`(`status`, `priority`, `createdAt`),
    INDEX `CustomerServiceCase_customerId_idx`(`customerId`),
    INDEX `CustomerServiceCase_assignedToId_status_idx`(`assignedToId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CallRecord` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NULL,
    `agentId` VARCHAR(191) NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
    `outcome` ENUM('CONNECTED', 'NO_ANSWER', 'VOICEMAIL', 'BUSY', 'WRONG_NUMBER', 'CALLBACK_REQUESTED') NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `durationSeconds` INTEGER NULL,
    `notes` TEXT NULL,
    `followUpRequired` BOOLEAN NOT NULL DEFAULT false,
    `followUpAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CallRecord_occurredAt_idx`(`occurredAt`),
    INDEX `CallRecord_agentId_occurredAt_idx`(`agentId`, `occurredAt`),
    INDEX `CallRecord_bookingId_idx`(`bookingId`),
    INDEX `CallRecord_followUpRequired_followUpAt_idx`(`followUpRequired`, `followUpAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `senderId` VARCHAR(191) NULL,
    `bookingId` VARCHAR(191) NULL,
    `groupId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'DRAFT',
    `sentAt` DATETIME(3) NULL,
    `failureReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Message_senderId_createdAt_idx`(`senderId`, `createdAt`),
    INDEX `Message_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Message_groupId_idx`(`groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MessageRecipient_recipientId_readAt_idx`(`recipientId`, `readAt`),
    UNIQUE INDEX `MessageRecipient_messageId_recipientId_key`(`messageId`, `recipientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageGroup` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `memberIds` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MessageGroup_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `channel` ENUM('IN_APP', 'EMAIL', 'SMS') NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED') NOT NULL DEFAULT 'PENDING',
    `dedupeKey` VARCHAR(191) NULL,
    `bookingId` VARCHAR(191) NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `template` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `provider` VARCHAR(191) NULL,
    `providerReference` VARCHAR(191) NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Notification_dedupeKey_key`(`dedupeKey`),
    INDEX `Notification_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Notification_eventType_createdAt_idx`(`eventType`, `createdAt`),
    INDEX `Notification_recipient_idx`(`recipient`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookEvent` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `processedAt` DATETIME(3) NULL,
    `processError` TEXT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebhookEvent_provider_processedAt_idx`(`provider`, `processedAt`),
    UNIQUE INDEX `WebhookEvent_provider_externalId_key`(`provider`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntegrationConfiguration` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT false,
    `settings` JSON NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IntegrationConfiguration_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReferenceSequence` (
    `kind` VARCHAR(191) NOT NULL,
    `value` BIGINT NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BusinessSetting` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `description` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BusinessSetting_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AdminSession` ADD CONSTRAINT `AdminSession_adminUserId_fkey` FOREIGN KEY (`adminUserId`) REFERENCES `AdminUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoginEvent` ADD CONSTRAINT `LoginEvent_adminUserId_fkey` FOREIGN KEY (`adminUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_adminUserId_fkey` FOREIGN KEY (`adminUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerNote` ADD CONSTRAINT `CustomerNote_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerNote` ADD CONSTRAINT `CustomerNote_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_bookingTypeId_fkey` FOREIGN KEY (`bookingTypeId`) REFERENCES `BookingType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_assignedAgentId_fkey` FOREIGN KEY (`assignedAgentId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_mcoSupplierId_fkey` FOREIGN KEY (`mcoSupplierId`) REFERENCES `McoSupplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_tfnId_fkey` FOREIGN KEY (`tfnId`) REFERENCES `Tfn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FlightDetail` ADD CONSTRAINT `FlightDetail_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FlightSegment` ADD CONSTRAINT `FlightSegment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CruiseDetail` ADD CONSTRAINT `CruiseDetail_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Passenger` ADD CONSTRAINT `Passenger_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingStatusHistory` ADD CONSTRAINT `BookingStatusHistory_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingStatusHistory` ADD CONSTRAINT `BookingStatusHistory_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingComment` ADD CONSTRAINT `BookingComment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingComment` ADD CONSTRAINT `BookingComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingFollowUp` ADD CONSTRAINT `BookingFollowUp_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingFollowUp` ADD CONSTRAINT `BookingFollowUp_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingFollowUp` ADD CONSTRAINT `BookingFollowUp_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_currentVersionId_fkey` FOREIGN KEY (`currentVersionId`) REFERENCES `DocumentVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentVersion` ADD CONSTRAINT `DocumentVersion_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentVersion` ADD CONSTRAINT `DocumentVersion_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refund` ADD CONSTRAINT `Refund_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refund` ADD CONSTRAINT `Refund_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refund` ADD CONSTRAINT `Refund_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refund` ADD CONSTRAINT `Refund_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refund` ADD CONSTRAINT `Refund_evidenceDocumentId_fkey` FOREIGN KEY (`evidenceDocumentId`) REFERENCES `Document`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Chargeback` ADD CONSTRAINT `Chargeback_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Chargeback` ADD CONSTRAINT `Chargeback_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Chargeback` ADD CONSTRAINT `Chargeback_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargebackEvidence` ADD CONSTRAINT `ChargebackEvidence_chargebackId_fkey` FOREIGN KEY (`chargebackId`) REFERENCES `Chargeback`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargebackEvidence` ADD CONSTRAINT `ChargebackEvidence_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinancialAdjustment` ADD CONSTRAINT `FinancialAdjustment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinancialAdjustment` ADD CONSTRAINT `FinancialAdjustment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Agent` ADD CONSTRAINT `Agent_adminUserId_fkey` FOREIGN KEY (`adminUserId`) REFERENCES `AdminUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerServiceCase` ADD CONSTRAINT `CustomerServiceCase_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerServiceCase` ADD CONSTRAINT `CustomerServiceCase_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerServiceCase` ADD CONSTRAINT `CustomerServiceCase_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CallRecord` ADD CONSTRAINT `CallRecord_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CallRecord` ADD CONSTRAINT `CallRecord_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CallRecord` ADD CONSTRAINT `CallRecord_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `MessageGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageRecipient` ADD CONSTRAINT `MessageRecipient_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageRecipient` ADD CONSTRAINT `MessageRecipient_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `AdminUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed the reference counters.
--
-- `nextVal` in src/lib/db/references.ts advances an existing row and refuses to
-- invent one, because a missing row means the application cannot know which
-- numbers have already been issued. The rows are therefore part of the schema
-- rather than of seeding: a database migrated but not seeded must still be able
-- to take a booking.
--
-- The starting values reproduce the Postgres sequences this replaces, which
-- used `START WITH 70000`, `START WITH 100000` and `START WITH 1`. A Postgres
-- sequence returns its START value on the first call, whereas this counter
-- returns `value + 1`, so each row is seeded one below the first number it
-- should hand out: the first booking is still MV70000 and the first payment
-- reference is still PAY-000001.
--
-- `INSERT IGNORE` keeps the statement safe to re-run against a database that
-- already has these rows.
INSERT IGNORE INTO `ReferenceSequence` (`kind`, `value`, `updatedAt`) VALUES
  ('booking_number', 69999, NOW(3)),
  ('customer_reference', 99999, NOW(3)),
  ('payment_reference', 0, NOW(3)),
  ('refund_reference', 0, NOW(3)),
  ('chargeback_reference', 0, NOW(3)),
  ('service_case', 0, NOW(3));
