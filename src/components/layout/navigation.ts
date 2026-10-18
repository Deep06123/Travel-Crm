import { PERMISSIONS, type PermissionKey } from "@/lib/permissions/catalog";

/**
 * Sidebar structure, mirroring the module grouping of the reference CRM.
 *
 * `permission` controls whether an item is rendered. That is presentation only
 * — hiding a link is a convenience, and every page behind it performs its own
 * server-side check.
 *
 * `plannedInPhase` marks a module whose page has not been built yet. The whole
 * intended structure stays visible so the shape of the application is legible,
 * but an unbuilt entry is rendered as a non-navigable label carrying its phase
 * number rather than a link that would 404. Remove the field when the page
 * lands — that is the only change needed to make the entry live.
 */

export interface NavItem {
  label: string;
  href: string;
  permission: PermissionKey;
  /** Lucide icon name, resolved in the client component. */
  icon: string;
  /** Set while the destination does not exist yet. */
  plannedInPhase?: number;
}

export interface NavSection {
  /** Omitted for the first group, which needs no heading. */
  heading?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    items: [
      {
        label: "Dashboard",
        href: "/admin",
        permission: PERMISSIONS.BOOKING_VIEW,
        icon: "LayoutDashboard",
      },
    ],
  },
  {
    heading: "Bookings",
    items: [
      {
        label: "All Bookings",
        href: "/admin/bookings",
        permission: PERMISSIONS.BOOKING_VIEW,
        icon: "Ticket",
      },
      {
        label: "Create Flight Booking",
        href: "/admin/bookings/new/flight",
        permission: PERMISSIONS.BOOKING_CREATE,
        icon: "Plane",
      },
      {
        label: "Create Cruise Booking",
        href: "/admin/bookings/new/cruise",
        permission: PERMISSIONS.BOOKING_CREATE,
        icon: "Ship",
      },
      {
        label: "High Priority",
        href: "/admin/high-priority",
        permission: PERMISSIONS.BOOKING_VIEW,
        icon: "Flame",
        plannedInPhase: 5,
      },
      {
        label: "Refund & Void",
        href: "/admin/refunds",
        permission: PERMISSIONS.REFUND_VIEW,
        icon: "Undo2",
      },
    ],
  },
  {
    heading: "Customers",
    items: [
      {
        label: "Customers",
        href: "/admin/customers",
        permission: PERMISSIONS.CUSTOMER_VIEW,
        icon: "Users",
      },
      {
        label: "Latest Comments",
        href: "/admin/comments",
        permission: PERMISSIONS.COMMENT_VIEW,
        icon: "MessageSquare",
        plannedInPhase: 5,
      },
      {
        label: "Customer Service",
        href: "/admin/customer-service",
        permission: PERMISSIONS.SERVICE_CASE_VIEW,
        icon: "Headset",
        plannedInPhase: 5,
      },
      {
        label: "Call Management",
        href: "/admin/call-management",
        permission: PERMISSIONS.CALL_VIEW,
        icon: "Phone",
        plannedInPhase: 5,
      },
    ],
  },
  {
    heading: "Finance",
    items: [
      {
        label: "Payments",
        href: "/admin/payments",
        permission: PERMISSIONS.PAYMENT_VIEW,
        icon: "CreditCard",
      },
      {
        label: "Chargebacks",
        href: "/admin/chargebacks",
        permission: PERMISSIONS.CHARGEBACK_VIEW,
        icon: "ShieldAlert",
      },
      {
        label: "Documents",
        href: "/admin/documents",
        permission: PERMISSIONS.DOCUMENT_VIEW,
        icon: "FileText",
      },
    ],
  },
  {
    heading: "Reports",
    items: [
      {
        label: "Booking Report",
        href: "/admin/reports/bookings",
        permission: PERMISSIONS.REPORT_BOOKINGS,
        icon: "ChartPie",
        plannedInPhase: 6,
      },
      {
        label: "Financial Report",
        href: "/admin/reports/financial",
        permission: PERMISSIONS.REPORT_FINANCIAL,
        icon: "ChartLine",
        plannedInPhase: 6,
      },
      {
        label: "Agent Performance",
        href: "/admin/reports/agents",
        permission: PERMISSIONS.REPORT_PERFORMANCE,
        icon: "UsersRound",
        plannedInPhase: 6,
      },
      {
        label: "Supplier Performance",
        href: "/admin/reports/suppliers",
        permission: PERMISSIONS.REPORT_PERFORMANCE,
        icon: "Building2",
        plannedInPhase: 6,
      },
    ],
  },
  {
    heading: "Messaging",
    items: [
      {
        label: "Inbox",
        href: "/admin/messages",
        permission: PERMISSIONS.MESSAGE_VIEW,
        icon: "Inbox",
        plannedInPhase: 6,
      },
      {
        label: "Compose",
        href: "/admin/messages/compose",
        permission: PERMISSIONS.MESSAGE_SEND,
        icon: "PenLine",
        plannedInPhase: 6,
      },
      {
        label: "Sent",
        href: "/admin/messages/sent",
        permission: PERMISSIONS.MESSAGE_VIEW,
        icon: "Send",
        plannedInPhase: 6,
      },
      {
        label: "Groups",
        href: "/admin/messages/groups",
        permission: PERMISSIONS.MESSAGE_GROUP_MANAGE,
        icon: "UsersRound",
        plannedInPhase: 6,
      },
      {
        label: "Notifications",
        href: "/admin/notifications",
        permission: PERMISSIONS.NOTIFICATION_VIEW,
        icon: "Bell",
        plannedInPhase: 6,
      },
    ],
  },
  {
    heading: "Administration",
    items: [
      {
        label: "Agents",
        href: "/admin/agents",
        permission: PERMISSIONS.AGENT_VIEW,
        icon: "IdCard",
        plannedInPhase: 5,
      },
      {
        label: "Suppliers",
        href: "/admin/suppliers",
        permission: PERMISSIONS.SUPPLIER_VIEW,
        icon: "Building2",
        plannedInPhase: 5,
      },
      {
        label: "MCO Suppliers",
        href: "/admin/mco-suppliers",
        permission: PERMISSIONS.SUPPLIER_VIEW,
        icon: "Landmark",
        plannedInPhase: 5,
      },
      {
        label: "TFN Management",
        href: "/admin/tfn",
        permission: PERMISSIONS.TFN_VIEW,
        icon: "PhoneCall",
        plannedInPhase: 5,
      },
      {
        label: "Settings",
        href: "/admin/settings",
        permission: PERMISSIONS.SETTINGS_VIEW,
        icon: "Settings",
        plannedInPhase: 5,
      },
      {
        label: "Audit Logs",
        href: "/admin/audit-logs",
        permission: PERMISSIONS.AUDIT_LOG_VIEW,
        icon: "ScrollText",
        plannedInPhase: 5,
      },
    ],
  },
];
