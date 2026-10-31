import { AdminRole } from "@/generated/prisma/enums";

/**
 * The complete catalogue of capabilities in the CRM.
 *
 * A permission key is the unit every server-side check works in. Roles are
 * coarse labels; what a role may actually do is the set of keys granted to it
 * in the RolePermission table. Seeding writes `DEFAULT_ROLE_PERMISSIONS` into
 * that table, after which grants can be tuned at runtime without a deploy.
 */

export const PERMISSION_CATEGORIES = {
  BOOKINGS: "Bookings",
  CUSTOMERS: "Customers",
  DOCUMENTS: "Documents",
  FINANCE: "Finance",
  OPERATIONS: "Operations",
  MESSAGING: "Messaging",
  REPORTS: "Reports",
  ADMINISTRATION: "Administration",
} as const;

export type PermissionCategory =
  (typeof PERMISSION_CATEGORIES)[keyof typeof PERMISSION_CATEGORIES];

export interface PermissionDefinition {
  key: string;
  description: string;
  category: PermissionCategory;
}

const { BOOKINGS, CUSTOMERS, DOCUMENTS, FINANCE, OPERATIONS, MESSAGING, REPORTS, ADMINISTRATION } =
  PERMISSION_CATEGORIES;

export const PERMISSIONS = {
  // --- Bookings -------------------------------------------------------------
  BOOKING_VIEW: "booking.view",
  BOOKING_CREATE: "booking.create",
  BOOKING_UPDATE: "booking.update",
  BOOKING_CHANGE_STATUS: "booking.changeStatus",
  BOOKING_MCO_UPDATE: "booking.mcoUpdate",
  /// Emailing the customer an authorization link. Separate from `message.send`
  /// because it mints a token that shows booking detail to whoever opens it,
  /// which an ordinary customer email does not.
  BOOKING_SIGNATURE_SEND: "booking.signature.send",
  BOOKING_CANCEL: "booking.cancel",
  /// Erasing the record outright, as opposed to cancelling it. Only for a
  /// booking that should never have existed.
  BOOKING_DELETE: "booking.delete",
  BOOKING_ASSIGN: "booking.assign",
  BOOKING_SET_PRIORITY: "booking.setPriority",
  BOOKING_EXPORT: "booking.export",

  PASSENGER_VIEW: "passenger.view",
  /// Passport numbers, dates of birth and other restricted traveller detail.
  PASSENGER_VIEW_SENSITIVE: "passenger.viewSensitive",
  PASSENGER_MANAGE: "passenger.manage",

  COMMENT_VIEW: "comment.view",
  COMMENT_CREATE: "comment.create",

  FOLLOW_UP_VIEW: "followUp.view",
  FOLLOW_UP_MANAGE: "followUp.manage",

  // --- Customers ------------------------------------------------------------
  CUSTOMER_VIEW: "customer.view",
  CUSTOMER_CREATE: "customer.create",
  CUSTOMER_UPDATE: "customer.update",
  CUSTOMER_EXPORT: "customer.export",

  // --- Documents ------------------------------------------------------------
  DOCUMENT_VIEW: "document.view",
  DOCUMENT_UPLOAD: "document.upload",
  DOCUMENT_VERIFY: "document.verify",
  DOCUMENT_DELETE: "document.delete",

  // --- Finance --------------------------------------------------------------
  PAYMENT_VIEW: "payment.view",
  PAYMENT_RECORD: "payment.record",
  PAYMENT_RECONCILE: "payment.reconcile",

  REFUND_VIEW: "refund.view",
  REFUND_REQUEST: "refund.request",
  REFUND_APPROVE: "refund.approve",
  REFUND_PROCESS: "refund.process",

  CHARGEBACK_VIEW: "chargeback.view",
  CHARGEBACK_MANAGE: "chargeback.manage",

  ADJUSTMENT_CREATE: "adjustment.create",

  // --- Operations -----------------------------------------------------------
  AGENT_VIEW: "agent.view",
  AGENT_MANAGE: "agent.manage",

  SUPPLIER_VIEW: "supplier.view",
  SUPPLIER_MANAGE: "supplier.manage",

  TFN_VIEW: "tfn.view",
  TFN_MANAGE: "tfn.manage",

  SERVICE_CASE_VIEW: "serviceCase.view",
  SERVICE_CASE_MANAGE: "serviceCase.manage",

  CALL_VIEW: "call.view",
  CALL_LOG: "call.log",

  // --- Messaging ------------------------------------------------------------
  MESSAGE_VIEW: "message.view",
  MESSAGE_SEND: "message.send",
  MESSAGE_GROUP_MANAGE: "messageGroup.manage",
  NOTIFICATION_VIEW: "notification.view",

  // --- Reports --------------------------------------------------------------
  REPORT_BOOKINGS: "report.bookings",
  REPORT_FINANCIAL: "report.financial",
  REPORT_OPERATIONAL: "report.operational",
  REPORT_PERFORMANCE: "report.performance",
  REPORT_EXPORT: "report.export",

  // --- Administration -------------------------------------------------------
  ADMIN_USER_VIEW: "adminUser.view",
  ADMIN_USER_MANAGE: "adminUser.manage",
  ROLE_PERMISSION_MANAGE: "rolePermission.manage",
  SETTINGS_VIEW: "settings.view",
  SETTINGS_MANAGE: "settings.manage",
  AUDIT_LOG_VIEW: "auditLog.view",
  BOOKING_TYPE_MANAGE: "bookingType.manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  { key: PERMISSIONS.BOOKING_VIEW, description: "View bookings and booking details", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_CREATE, description: "Create flight and cruise bookings", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_UPDATE, description: "Edit booking details", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_CHANGE_STATUS, description: "Move a booking through its lifecycle", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_MCO_UPDATE, description: "Move a booking's MCO through its settlement cycle", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_SIGNATURE_SEND, description: "Email the customer an authorization and e-signature link", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_CANCEL, description: "Cancel a booking", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_DELETE, description: "Permanently delete a booking created in error", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_ASSIGN, description: "Assign a booking to an agent", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_SET_PRIORITY, description: "Change booking priority and escalation", category: BOOKINGS },
  { key: PERMISSIONS.BOOKING_EXPORT, description: "Export booking records to CSV", category: BOOKINGS },
  { key: PERMISSIONS.PASSENGER_VIEW, description: "View passenger names and ticket numbers", category: BOOKINGS },
  { key: PERMISSIONS.PASSENGER_VIEW_SENSITIVE, description: "View passport details and dates of birth", category: BOOKINGS },
  { key: PERMISSIONS.PASSENGER_MANAGE, description: "Add and edit passengers", category: BOOKINGS },
  { key: PERMISSIONS.COMMENT_VIEW, description: "Read booking comments", category: BOOKINGS },
  { key: PERMISSIONS.COMMENT_CREATE, description: "Add booking comments", category: BOOKINGS },
  { key: PERMISSIONS.FOLLOW_UP_VIEW, description: "View follow-up tasks", category: BOOKINGS },
  { key: PERMISSIONS.FOLLOW_UP_MANAGE, description: "Create, assign and resolve follow-ups", category: BOOKINGS },

  { key: PERMISSIONS.CUSTOMER_VIEW, description: "View customer profiles", category: CUSTOMERS },
  { key: PERMISSIONS.CUSTOMER_CREATE, description: "Create customers", category: CUSTOMERS },
  { key: PERMISSIONS.CUSTOMER_UPDATE, description: "Edit customer details", category: CUSTOMERS },
  { key: PERMISSIONS.CUSTOMER_EXPORT, description: "Export customer records to CSV", category: CUSTOMERS },

  { key: PERMISSIONS.DOCUMENT_VIEW, description: "View and download documents", category: DOCUMENTS },
  { key: PERMISSIONS.DOCUMENT_UPLOAD, description: "Upload documents", category: DOCUMENTS },
  { key: PERMISSIONS.DOCUMENT_VERIFY, description: "Mark documents verified or rejected", category: DOCUMENTS },
  { key: PERMISSIONS.DOCUMENT_DELETE, description: "Remove documents", category: DOCUMENTS },

  { key: PERMISSIONS.PAYMENT_VIEW, description: "View payment records", category: FINANCE },
  { key: PERMISSIONS.PAYMENT_RECORD, description: "Record and update payments", category: FINANCE },
  { key: PERMISSIONS.PAYMENT_RECONCILE, description: "Set payment reconciliation status", category: FINANCE },
  { key: PERMISSIONS.REFUND_VIEW, description: "View refunds and voids", category: FINANCE },
  { key: PERMISSIONS.REFUND_REQUEST, description: "Raise a refund or void request", category: FINANCE },
  { key: PERMISSIONS.REFUND_APPROVE, description: "Approve or reject refund requests", category: FINANCE },
  { key: PERMISSIONS.REFUND_PROCESS, description: "Execute an approved refund", category: FINANCE },
  { key: PERMISSIONS.CHARGEBACK_VIEW, description: "View chargeback cases", category: FINANCE },
  { key: PERMISSIONS.CHARGEBACK_MANAGE, description: "Manage chargeback cases and evidence", category: FINANCE },
  { key: PERMISSIONS.ADJUSTMENT_CREATE, description: "Record financial adjustments", category: FINANCE },

  { key: PERMISSIONS.AGENT_VIEW, description: "View agent profiles", category: OPERATIONS },
  { key: PERMISSIONS.AGENT_MANAGE, description: "Create and edit agent profiles", category: OPERATIONS },
  { key: PERMISSIONS.SUPPLIER_VIEW, description: "View suppliers and MCO suppliers", category: OPERATIONS },
  { key: PERMISSIONS.SUPPLIER_MANAGE, description: "Manage suppliers and MCO suppliers", category: OPERATIONS },
  { key: PERMISSIONS.TFN_VIEW, description: "View toll-free number configuration", category: OPERATIONS },
  { key: PERMISSIONS.TFN_MANAGE, description: "Manage toll-free number configuration", category: OPERATIONS },
  { key: PERMISSIONS.SERVICE_CASE_VIEW, description: "View customer service cases", category: OPERATIONS },
  { key: PERMISSIONS.SERVICE_CASE_MANAGE, description: "Create and resolve service cases", category: OPERATIONS },
  { key: PERMISSIONS.CALL_VIEW, description: "View logged call activity", category: OPERATIONS },
  { key: PERMISSIONS.CALL_LOG, description: "Log call activity", category: OPERATIONS },

  { key: PERMISSIONS.MESSAGE_VIEW, description: "Read internal messages", category: MESSAGING },
  { key: PERMISSIONS.MESSAGE_SEND, description: "Compose and send internal messages", category: MESSAGING },
  { key: PERMISSIONS.MESSAGE_GROUP_MANAGE, description: "Manage message groups", category: MESSAGING },
  { key: PERMISSIONS.NOTIFICATION_VIEW, description: "View notification delivery history", category: MESSAGING },

  { key: PERMISSIONS.REPORT_BOOKINGS, description: "View booking reports", category: REPORTS },
  { key: PERMISSIONS.REPORT_FINANCIAL, description: "View financial reports", category: REPORTS },
  { key: PERMISSIONS.REPORT_OPERATIONAL, description: "View operational reports", category: REPORTS },
  { key: PERMISSIONS.REPORT_PERFORMANCE, description: "View agent and supplier performance", category: REPORTS },
  { key: PERMISSIONS.REPORT_EXPORT, description: "Export report data", category: REPORTS },

  { key: PERMISSIONS.ADMIN_USER_VIEW, description: "View administrator accounts", category: ADMINISTRATION },
  { key: PERMISSIONS.ADMIN_USER_MANAGE, description: "Create, edit and deactivate administrators", category: ADMINISTRATION },
  { key: PERMISSIONS.ROLE_PERMISSION_MANAGE, description: "Change which permissions a role holds", category: ADMINISTRATION },
  { key: PERMISSIONS.SETTINGS_VIEW, description: "View business settings", category: ADMINISTRATION },
  { key: PERMISSIONS.SETTINGS_MANAGE, description: "Change business settings", category: ADMINISTRATION },
  { key: PERMISSIONS.AUDIT_LOG_VIEW, description: "Read the audit log", category: ADMINISTRATION },
  { key: PERMISSIONS.BOOKING_TYPE_MANAGE, description: "Manage booking types", category: ADMINISTRATION },
];

const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_DEFINITIONS.map(
  (definition) => definition.key as PermissionKey,
);

/** Every capability that only reads data. The baseline for READ_ONLY. */
const READ_ONLY_KEYS: PermissionKey[] = [
  PERMISSIONS.BOOKING_VIEW,
  PERMISSIONS.PASSENGER_VIEW,
  PERMISSIONS.COMMENT_VIEW,
  PERMISSIONS.FOLLOW_UP_VIEW,
  PERMISSIONS.CUSTOMER_VIEW,
  PERMISSIONS.DOCUMENT_VIEW,
  PERMISSIONS.PAYMENT_VIEW,
  PERMISSIONS.REFUND_VIEW,
  PERMISSIONS.CHARGEBACK_VIEW,
  PERMISSIONS.AGENT_VIEW,
  PERMISSIONS.SUPPLIER_VIEW,
  PERMISSIONS.TFN_VIEW,
  PERMISSIONS.SERVICE_CASE_VIEW,
  PERMISSIONS.CALL_VIEW,
  PERMISSIONS.NOTIFICATION_VIEW,
  PERMISSIONS.REPORT_BOOKINGS,
  PERMISSIONS.REPORT_OPERATIONAL,
];

/**
 * Starting grants per role, written to RolePermission by the seed.
 *
 * The split follows the operational separation the business already runs on:
 * operations staff move bookings and paperwork but cannot approve money back
 * out; finance handles money but does not edit itineraries; support reads the
 * booking record to answer the phone but changes neither.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<AdminRole, PermissionKey[]> = {
  [AdminRole.SUPER_ADMIN]: ALL_PERMISSION_KEYS,

  [AdminRole.OPERATIONS]: [
    PERMISSIONS.BOOKING_VIEW,
    PERMISSIONS.BOOKING_CREATE,
    PERMISSIONS.BOOKING_UPDATE,
    PERMISSIONS.BOOKING_CHANGE_STATUS,
    PERMISSIONS.BOOKING_MCO_UPDATE,
    PERMISSIONS.BOOKING_SIGNATURE_SEND,
    PERMISSIONS.BOOKING_CANCEL,
    PERMISSIONS.BOOKING_ASSIGN,
    PERMISSIONS.BOOKING_SET_PRIORITY,
    PERMISSIONS.BOOKING_EXPORT,
    PERMISSIONS.PASSENGER_VIEW,
    PERMISSIONS.PASSENGER_VIEW_SENSITIVE,
    PERMISSIONS.PASSENGER_MANAGE,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_CREATE,
    PERMISSIONS.FOLLOW_UP_VIEW,
    PERMISSIONS.FOLLOW_UP_MANAGE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_CREATE,
    PERMISSIONS.CUSTOMER_UPDATE,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_VERIFY,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.REFUND_VIEW,
    PERMISSIONS.REFUND_REQUEST,
    PERMISSIONS.SUPPLIER_VIEW,
    PERMISSIONS.TFN_VIEW,
    PERMISSIONS.AGENT_VIEW,
    PERMISSIONS.SERVICE_CASE_VIEW,
    PERMISSIONS.SERVICE_CASE_MANAGE,
    PERMISSIONS.CALL_VIEW,
    PERMISSIONS.CALL_LOG,
    PERMISSIONS.MESSAGE_VIEW,
    PERMISSIONS.MESSAGE_SEND,
    PERMISSIONS.NOTIFICATION_VIEW,
    PERMISSIONS.REPORT_BOOKINGS,
    PERMISSIONS.REPORT_OPERATIONAL,
    PERMISSIONS.REPORT_EXPORT,
  ],

  [AdminRole.FINANCE]: [
    PERMISSIONS.BOOKING_VIEW,
    // Settling an MCO against a supplier is finance work, which is why this is
    // its own capability rather than riding on BOOKING_UPDATE: finance does not
    // edit itineraries but does have to move this field.
    PERMISSIONS.BOOKING_MCO_UPDATE,
    PERMISSIONS.PASSENGER_VIEW,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_CREATE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_VERIFY,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.PAYMENT_RECORD,
    PERMISSIONS.PAYMENT_RECONCILE,
    PERMISSIONS.REFUND_VIEW,
    PERMISSIONS.REFUND_REQUEST,
    PERMISSIONS.REFUND_APPROVE,
    PERMISSIONS.REFUND_PROCESS,
    PERMISSIONS.CHARGEBACK_VIEW,
    PERMISSIONS.CHARGEBACK_MANAGE,
    PERMISSIONS.ADJUSTMENT_CREATE,
    PERMISSIONS.SUPPLIER_VIEW,
    PERMISSIONS.MESSAGE_VIEW,
    PERMISSIONS.MESSAGE_SEND,
    PERMISSIONS.NOTIFICATION_VIEW,
    PERMISSIONS.REPORT_BOOKINGS,
    PERMISSIONS.REPORT_FINANCIAL,
    PERMISSIONS.REPORT_OPERATIONAL,
    PERMISSIONS.REPORT_PERFORMANCE,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.BOOKING_EXPORT,
  ],

  [AdminRole.SUPPORT]: [
    PERMISSIONS.BOOKING_VIEW,
    PERMISSIONS.BOOKING_SIGNATURE_SEND,
    PERMISSIONS.PASSENGER_VIEW,
    PERMISSIONS.COMMENT_VIEW,
    PERMISSIONS.COMMENT_CREATE,
    PERMISSIONS.FOLLOW_UP_VIEW,
    PERMISSIONS.FOLLOW_UP_MANAGE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_CREATE,
    PERMISSIONS.CUSTOMER_UPDATE,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.REFUND_VIEW,
    PERMISSIONS.SERVICE_CASE_VIEW,
    PERMISSIONS.SERVICE_CASE_MANAGE,
    PERMISSIONS.CALL_VIEW,
    PERMISSIONS.CALL_LOG,
    PERMISSIONS.MESSAGE_VIEW,
    PERMISSIONS.MESSAGE_SEND,
    PERMISSIONS.NOTIFICATION_VIEW,
    PERMISSIONS.REPORT_OPERATIONAL,
  ],

  [AdminRole.READ_ONLY]: READ_ONLY_KEYS,
};
