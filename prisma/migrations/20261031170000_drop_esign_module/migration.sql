-- Removes the e-signature module from the database.
--
-- The feature's code was reverted earlier; these tables, enum values and
-- seeded rows were deliberately left behind at the time. They are dropped here
-- so the database matches `schema.prisma` again — without this, the next
-- `prisma migrate dev` sees drift and offers to reset the whole database.
--
-- DESTRUCTIVE: every signing request, signature, evidence row and audit trail
-- is deleted, along with the two documents that used the e-signature
-- categories. None of it can be recovered.

-- --------------------------------------------------------------------------
-- Seeded rows that referenced the module
-- --------------------------------------------------------------------------

-- Notification rows recording e-sign sends. Written by the module, meaningless
-- without it.
DELETE FROM `Notification` WHERE `eventType` LIKE 'ESIGN%';

-- Role grants first: RolePermission points at Permission.
DELETE rp FROM `RolePermission` rp
  JOIN `Permission` p ON p.`id` = rp.`permissionId`
 WHERE p.`key` LIKE 'esign.%';

DELETE FROM `Permission` WHERE `key` LIKE 'esign.%';

DELETE FROM `BusinessSetting` WHERE `key` = 'esign_evidence_retention_days';

-- --------------------------------------------------------------------------
-- The module's own tables
-- --------------------------------------------------------------------------
--
-- Children before the parent: each of these holds a foreign key to
-- ESignRequest, and ESignDocument also points at Document.

DROP TABLE IF EXISTS `ESignEmailLog`;
DROP TABLE IF EXISTS `ESignAuditEvent`;
DROP TABLE IF EXISTS `ESignDocument`;
DROP TABLE IF EXISTS `ESignTechnicalEvidence`;
DROP TABLE IF EXISTS `ESignSignature`;
DROP TABLE IF EXISTS `ESignRequest`;

-- --------------------------------------------------------------------------
-- Documents filed under the e-signature categories
-- --------------------------------------------------------------------------
--
-- These have to go before the enum is narrowed: MySQL cannot keep a row whose
-- stored value is no longer one of the permitted ones. `currentVersionId` is
-- cleared first because Document points at DocumentVersion and the two would
-- otherwise deadlock on each other's foreign key.

UPDATE `Document` SET `currentVersionId` = NULL
 WHERE `category` IN ('BOOKING_AGREEMENT', 'SIGNED_AGREEMENT');

DELETE v FROM `DocumentVersion` v
  JOIN `Document` d ON d.`id` = v.`documentId`
 WHERE d.`category` IN ('BOOKING_AGREEMENT', 'SIGNED_AGREEMENT');

DELETE FROM `Document`
 WHERE `category` IN ('BOOKING_AGREEMENT', 'SIGNED_AGREEMENT');

-- AlterTable
-- Back to the nine categories the application knows about.
ALTER TABLE `Document` MODIFY `category` ENUM('BOOKING_CONFIRMATION', 'FLIGHT_ITINERARY', 'E_TICKET', 'CRUISE_CONFIRMATION', 'INVOICE', 'RECEIPT', 'REFUND_EVIDENCE', 'CHARGEBACK_EVIDENCE', 'GENERAL_ATTACHMENT') NOT NULL;
