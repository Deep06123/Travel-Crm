-- Multiple sending identities, configured by an administrator instead of by
-- editing the server's environment and redeploying.
--
-- `passwordCipher` holds AES-256-GCM ciphertext, never a password. It is TEXT
-- rather than VARCHAR because the stored form is `v1.<iv>.<tag>.<payload>` in
-- base64url and grows with the secret; nothing indexes it.
CREATE TABLE `MailAccount` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `fromEmail` VARCHAR(191) NOT NULL,
    `fromName` VARCHAR(191) NULL,
    `replyTo` VARCHAR(191) NULL,
    `host` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 587,
    `secure` BOOLEAN NOT NULL DEFAULT false,
    `username` VARCHAR(191) NULL,
    `passwordCipher` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `verifiedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MailAccount_label_key`(`label`),
    INDEX `MailAccount_isActive_label_idx`(`isActive`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Which identity sent a given message. Nullable, so every existing row stays
-- valid: those were sent from the `SMTP_*` environment configuration, which
-- is still the fallback when no account is configured.
ALTER TABLE `Notification` ADD COLUMN `mailAccountId` VARCHAR(191) NULL;

CREATE INDEX `Notification_mailAccountId_idx` ON `Notification`(`mailAccountId`);

-- SET NULL rather than CASCADE: deleting an account must not erase the record
-- of what it sent.
ALTER TABLE `Notification`
    ADD CONSTRAINT `Notification_mailAccountId_fkey`
    FOREIGN KEY (`mailAccountId`) REFERENCES `MailAccount`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
