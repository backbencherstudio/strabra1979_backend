export const PERSONAL_TO_GLOBAL_KEY: Record<string, string> = {
  // PM
  notif_pm_new_property_dashboard_assigned:
    'pm_new_property_dashboard_assigned',
  notif_pm_property_dashboard_access_request:
    'pm_property_dashboard_access_request',
  notif_pm_property_dashboard_update: 'pm_property_dashboard_update',
  // AV
  notif_av_new_property_dashboard_invitation:
    'av_new_property_dashboard_invitation',
  notif_av_access_request_update: 'av_access_request_update',
  notif_av_property_dashboard_update: 'av_property_dashboard_update',
  // OT
  notif_ot_new_inspection_assigned: 'ot_new_inspection_assigned',
  notif_ot_due_inspection: 'ot_due_inspection',
  notif_ot_incomplete_inspection_report: 'ot_incomplete_inspection_report',
  // Admin
  notif_admin_new_user_registration: 'admin_new_user_registration',
  notif_admin_due_inspection: 'admin_due_inspection',
  notif_admin_new_inspection_report_update:
    'admin_new_inspection_report_update',
};

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

export enum NotificationType {
  // Property Manager / Authorized Viewer
  ACCESS_REQUEST = 'access_request',
  ACCESS_APPROVED = 'access_approved',
  ACCESS_DECLINED = 'access_declined',
  DASHBOARD_ASSIGNED = 'dashboard_assigned',
  DASHBOARD_SHARED = 'dashboard_shared',
  DASHBOARD_UPDATED = 'dashboard_updated',

  // Operational Team
  DUE_INSPECTION = 'due_inspection',
  NEW_INSPECTION_ASSIGNED = 'new_inspection_assigned',

  // Admin
  NEW_USER_REGISTRATION = 'new_user_registration', // AV registered (auto-active)
  NEW_USER_APPROVAL_REQUEST = 'new_user_approval_request', // PM/OT registered (needs approval)
  INSPECTION_REPORT_UPDATE = 'inspection_report_update',

  // User receives after admin decision
  ACCOUNT_APPROVED = 'account_approved',
  ACCOUNT_DECLINED = 'account_declined',
}

// ─────────────────────────────────────────────────────────────────────────────
// WS EVENT MAP
// ─────────────────────────────────────────────────────────────────────────────

export const WS_EVENTS: Record<NotificationType, string> = {
  [NotificationType.ACCESS_REQUEST]: 'notification:access_request',
  [NotificationType.ACCESS_APPROVED]: 'notification:access_approved',
  [NotificationType.ACCESS_DECLINED]: 'notification:access_declined',
  [NotificationType.DASHBOARD_ASSIGNED]: 'notification:dashboard_assigned',
  [NotificationType.DASHBOARD_SHARED]: 'notification:dashboard_shared',
  [NotificationType.DASHBOARD_UPDATED]: 'notification:dashboard_updated',
  [NotificationType.DUE_INSPECTION]: 'notification:due_inspection',
  [NotificationType.NEW_INSPECTION_ASSIGNED]:
    'notification:new_inspection_assigned',
  [NotificationType.NEW_USER_REGISTRATION]:
    'notification:new_user_registration',
  [NotificationType.NEW_USER_APPROVAL_REQUEST]:
    'notification:new_user_approval_request',
  [NotificationType.INSPECTION_REPORT_UPDATE]:
    'notification:inspection_report_update',
  [NotificationType.ACCOUNT_APPROVED]: 'notification:account_approved',
  [NotificationType.ACCOUNT_DECLINED]: 'notification:account_declined',
};

// ─────────────────────────────────────────────────────────────────────────────
// PREFERENCE KEY MAP
// Maps NotificationType → the user.notif_* field name that gates it
// ─────────────────────────────────────────────────────────────────────────────

export const PREFERENCE_KEY_MAP: Partial<
  Record<NotificationType, string | ((role: string) => string | null)>
> = {
  // PM
  [NotificationType.DASHBOARD_ASSIGNED]:
    'notif_pm_new_property_dashboard_assigned',
  [NotificationType.ACCESS_REQUEST]:
    'notif_pm_property_dashboard_access_request',
  [NotificationType.DASHBOARD_UPDATED]: (role) =>
    role === 'PROPERTY_MANAGER'
      ? 'notif_pm_property_dashboard_update'
      : role === 'AUTHORIZED_VIEWER'
        ? 'notif_av_property_dashboard_update'
        : null,

  // AV
  [NotificationType.DASHBOARD_SHARED]:
    'notif_av_new_property_dashboard_invitation',
  [NotificationType.ACCESS_APPROVED]: 'notif_av_access_request_update',
  [NotificationType.ACCESS_DECLINED]: 'notif_av_access_request_update',

  // OT
  [NotificationType.NEW_INSPECTION_ASSIGNED]:
    'notif_ot_new_inspection_assigned',
  [NotificationType.DUE_INSPECTION]: 'notif_ot_due_inspection',

  // Admin
  [NotificationType.NEW_USER_REGISTRATION]: 'notif_admin_new_user_registration',
  [NotificationType.NEW_USER_APPROVAL_REQUEST]:
    'notif_admin_new_user_registration', // same toggle
  [NotificationType.INSPECTION_REPORT_UPDATE]:
    'notif_admin_new_inspection_report_update',

  // Account approved/declined — always delivered, no preference gate
  [NotificationType.ACCOUNT_APPROVED]: null,
  [NotificationType.ACCOUNT_DECLINED]: null,
};