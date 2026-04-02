import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationGateway } from './notification.gateway';
import {
  NotificationType,
  PERSONAL_TO_GLOBAL_KEY,
  PREFERENCE_KEY_MAP,
  WS_EVENTS,
} from './notification.const';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationGateway,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CORE — save to DB + fire WebSocket
  // ─────────────────────────────────────────────────────────────────────────

  private async send(params: {
    type: NotificationType;
    receiverId: string;
    senderId?: string;
    entityId?: string;
    text: string;
    metadata?: Record<string, any>;
  }) {
    // ── Fetch receiver with all notif preference fields ──────────────────
    const receiver = await this.prisma.user.findUnique({
      where: { id: params.receiverId },
      select: {
        role: true,
        notif_pm_new_property_dashboard_assigned: true,
        notif_pm_property_dashboard_access_request: true,
        notif_pm_property_dashboard_update: true,
        notif_av_new_property_dashboard_invitation: true,
        notif_av_access_request_update: true,
        notif_av_property_dashboard_update: true,
        notif_ot_new_inspection_assigned: true,
        notif_ot_due_inspection: true,
        notif_ot_incomplete_inspection_report: true,
        notif_admin_new_user_registration: true,
        notif_admin_due_inspection: true,
        notif_admin_new_inspection_report_update: true,
      },
    });
    if (!receiver) return;

    // ── Resolve the preference key for this notification type ────────────
    const prefKeyEntry = PREFERENCE_KEY_MAP[params.type];
    const personalKey =
      typeof prefKeyEntry === 'function'
        ? prefKeyEntry(receiver.role)
        : (prefKeyEntry ?? null);

    // ── GATE 1: Check admin global settings ──────────────────────────────
    // Maps the user's personal notif_ key → the global settings field name
    const globalKey = personalKey
      ? (PERSONAL_TO_GLOBAL_KEY[personalKey] ?? null)
      : null;

    if (globalKey) {
      const globalSettings =
        await this.prisma.userLevelNotificationSettings.findFirst({
          select: { [globalKey]: true },
        });

      // If global settings exist and this type is disabled globally → stop
      if (globalSettings && globalSettings[globalKey] === false) return;
    }

    // ── GATE 2: Check user's personal preference ─────────────────────────
    if (personalKey && receiver[personalKey] === false) return;

    // ── Both gates passed → persist + emit ───────────────────────────────
    const event = await this.prisma.notificationEvent.create({
      data: { type: params.type, text: params.text, status: 1 },
    });

    const notification = await this.prisma.notification.create({
      data: {
        sender_id: params.senderId ?? null,
        receiver_id: params.receiverId,
        notification_event_id: event.id,
        entity_id: params.entityId ?? null,
        status: 1,
      },
      include: {
        notification_event: true,
        sender: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
            avatar: true,
            email: true,
          },
        },
      },
    });

    this.gateway.sendToUser(params.receiverId, WS_EVENTS[params.type], {
      notificationId: notification.id,
      type: params.type,
      text: params.text,
      entityId: params.entityId,
      metadata: params.metadata ?? {},
      sender: notification.sender,
      isRead: false,
      createdAt: notification.created_at,
    });

    await this._emitUnreadCount(params.receiverId);
    return notification;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── PROPERTY MANAGER / AUTHORIZED VIEWER ─────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  async accessRequested(params: {
    propertyManagerId: string;
    requesterId: string;
    requesterName: string;
    requesterEmail: string;
    requesterAvatar?: string;
    propertyId: string;
    propertyName: string;
  }) {
    return this.send({
      type: NotificationType.ACCESS_REQUEST,
      receiverId: params.propertyManagerId,
      senderId: params.requesterId,
      entityId: params.propertyId,
      text: `Requested to View **${params.propertyName}** Property.`,
      metadata: {
        requesterId: params.requesterId,
        requesterName: params.requesterName,
        requesterEmail: params.requesterEmail,
        requesterAvatar: params.requesterAvatar,
        propertyId: params.propertyId,
        propertyName: params.propertyName,
        hasActions: true,
        actions: {
          accept: {
            label: 'Accept',
            endpoint: `PATCH /properties/${params.propertyId}/access/requests/${params.requesterId}/approve`,
          },
          decline: {
            label: 'Decline',
            endpoint: `PATCH /properties/${params.propertyId}/access/requests/${params.requesterId}/decline`,
          },
        },
      },
    });
  }

  async accessApproved(params: {
    userId: string;
    approvedBy: string;
    approverName: string;
    propertyId: string;
    propertyName: string;
    dashboardId: string;
  }) {
    return this.send({
      type: NotificationType.ACCESS_APPROVED,
      receiverId: params.userId,
      senderId: params.approvedBy,
      entityId: params.propertyId,
      text: `**${params.approverName}** accepted your request to view **${params.propertyName}** Property.`,
      metadata: {
        propertyId: params.propertyId,
        propertyName: params.propertyName,
        dashboardId: params.dashboardId,
        link: {
          label: 'View Dashboard',
          href: `/dashboard/${params.dashboardId}`,
        },
      },
    });
  }

  async accessDeclined(params: {
    userId: string;
    declinedBy: string;
    declinerName: string;
    propertyId: string;
    propertyName: string;
  }) {
    return this.send({
      type: NotificationType.ACCESS_DECLINED,
      receiverId: params.userId,
      senderId: params.declinedBy,
      entityId: params.propertyId,
      text: `**${params.declinerName}** declined your request to view **${params.propertyName}** Property.`,
      metadata: {
        propertyId: params.propertyId,
        propertyName: params.propertyName,
      },
    });
  }

  async dashboardAssigned(params: {
    propertyManagerId: string;
    assignedById: string;
    propertyId: string;
    propertyName: string;
    dashboardId: string;
  }) {
    return this.send({
      type: NotificationType.DASHBOARD_ASSIGNED,
      receiverId: params.propertyManagerId,
      senderId: params.assignedById,
      entityId: params.propertyId,
      text: `You've been assigned to a new property dashboard by an admin.`,
      metadata: {
        propertyId: params.propertyId,
        propertyName: params.propertyName,
        dashboardId: params.dashboardId,
        link: {
          label: 'View Dashboard',
          href: `/dashboard/${params.dashboardId}`,
        },
      },
    });
  }

  async dashboardShared(params: {
    userId: string;
    sharedById: string;
    sharerName: string;
    propertyId: string;
    propertyName: string;
    dashboardId: string;
  }) {
    return this.send({
      type: NotificationType.DASHBOARD_SHARED,
      receiverId: params.userId,
      senderId: params.sharedById,
      entityId: params.propertyId,
      text: `You've been invited to a new property dashboard by **${params.sharerName}**.`,
      metadata: {
        propertyId: params.propertyId,
        propertyName: params.propertyName,
        dashboardId: params.dashboardId,
        link: {
          label: 'View Dashboard',
          href: `/dashboard/${params.dashboardId}`,
        },
      },
    });
  }

  async dashboardUpdated(params: {
    userIds: string[];
    updatedById: string;
    propertyId: string;
    propertyName: string;
    dashboardId: string;
    changeNote?: string;
  }) {
    for (const userId of params.userIds) {
      await this.send({
        type: NotificationType.DASHBOARD_UPDATED,
        receiverId: userId,
        senderId: params.updatedById,
        entityId: params.propertyId,
        text: `${params.changeNote ?? 'New files have been uploaded'} to **${params.propertyName}**.`,
        metadata: {
          propertyId: params.propertyId,
          propertyName: params.propertyName,
          dashboardId: params.dashboardId,
          link: {
            label: 'View Dashboard',
            href: `/dashboard/${params.dashboardId}`,
          },
        },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── OPERATIONAL TEAM ─────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  async dueInspection(params: {
    operationalUserId: string;
    propertyId: string;
    propertyName: string;
    dashboardId: string;
    dueDate?: string;
  }) {
    return this.send({
      type: NotificationType.DUE_INSPECTION,
      receiverId: params.operationalUserId,
      entityId: params.propertyId,
      text: `**${params.propertyName}** inspection is due.`,
      metadata: {
        propertyId: params.propertyId,
        propertyName: params.propertyName,
        dashboardId: params.dashboardId,
        dueDate: params.dueDate,
        link: {
          label: 'Start Inspection',
          href: `/inspections/property/${params.dashboardId}/form`,
        },
      },
    });
  }

  async newInspectionAssigned(params: {
    operationalUserId: string;
    assignedById: string;
    propertyId: string;
    propertyName: string;
    dashboardId: string;
  }) {
    return this.send({
      type: NotificationType.NEW_INSPECTION_ASSIGNED,
      receiverId: params.operationalUserId,
      senderId: params.assignedById,
      entityId: params.propertyId,
      text: `You've been assigned to a new property inspection.`,
      metadata: {
        propertyId: params.propertyId,
        propertyName: params.propertyName,
        dashboardId: params.dashboardId,
        link: {
          label: 'Start Inspection',
          href: `/inspections/property/${params.dashboardId}/form`,
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── ADMIN ─────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  // AV registered → auto-active → simple info notification
  async newUserRegistration(params: {
    adminIds: string[];
    newUserId: string;
    userName: string;
    userRole: string;
  }) {
    for (const adminId of params.adminIds) {
      console.log({ sendigto: adminId });
      await this.send({
        type: NotificationType.NEW_USER_REGISTRATION,
        receiverId: adminId,
        senderId: params.newUserId,
        entityId: params.newUserId,
        text: `**${params.userName}** registered as a **${params.userRole}**.`,
        metadata: {
          userId: params.newUserId,
          userName: params.userName,
          userRole: params.userRole,
          link: { label: 'View', href: `/users/${params.newUserId}` },
        },
      });
    }
  }

  // PM / OPERATIONAL registered → deactivated → admins get Accept/Decline
  async newUserApprovalRequest(params: {
    adminIds: string[];
    newUserId: string;
    userName: string;
    userRole: string;
  }) {
    for (const adminId of params.adminIds) {
      await this.send({
        type: NotificationType.NEW_USER_APPROVAL_REQUEST,
        receiverId: adminId,
        senderId: params.newUserId,
        entityId: params.newUserId,
        text: `**${params.userName}** registered as a **${params.userRole}** and is awaiting approval.`,
        metadata: {
          userId: params.newUserId,
          userName: params.userName,
          userRole: params.userRole,
          hasActions: true,
          actions: {
            accept: {
              label: 'Accept',
              endpoint: `PATCH /users/${params.newUserId}/approve`,
            },
            decline: {
              label: 'Decline',
              endpoint: `PATCH /users/${params.newUserId}/decline`,
            },
          },
        },
      });
    }
  }

  // User notified after admin approves their account
  async accountApproved(params: {
    userId: string;
    approvedById: string;
    approverName: string;
    userRole: string;
  }) {
    return this.send({
      type: NotificationType.ACCOUNT_APPROVED,
      receiverId: params.userId,
      senderId: params.approvedById,
      entityId: params.userId,
      text: `**${params.approverName}** approved your account. You can now log in as a **${params.userRole}**.`,
      metadata: {
        link: { label: 'Go to Dashboard', href: `/dashboard` },
      },
    });
  }

  // User notified after admin declines their account
  async accountDeclined(params: {
    userId: string;
    declinedById: string;
    declinerName: string;
  }) {
    return this.send({
      type: NotificationType.ACCOUNT_DECLINED,
      receiverId: params.userId,
      senderId: params.declinedById,
      entityId: params.userId,
      text: `Your account registration was declined.`,
      metadata: {},
    });
  }

  async inspectionReportUpdate(params: {
    adminIds: string[];
    inspectorId: string;
    inspectorName: string;
    propertyId: string;
    propertyName: string;
    inspectionId: string;
  }) {
    for (const adminId of params.adminIds) {
      await this.send({
        type: NotificationType.INSPECTION_REPORT_UPDATE,
        receiverId: adminId,
        senderId: params.inspectorId,
        entityId: params.inspectionId,
        text: `**${params.propertyName}** inspection report was added.`,
        metadata: {
          propertyId: params.propertyId,
          propertyName: params.propertyName,
          inspectionId: params.inspectionId,
          link: {
            label: 'View Report',
            href: `/inspections/${params.inspectionId}`,
          },
        },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MARK AS READ
  // ─────────────────────────────────────────────────────────────────────────

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, receiver_id: userId },
    });
    if (!notification)
      return { success: false, message: 'Notification not found' };

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read_at: new Date(), status: 0 },
    });

    await this._emitUnreadCount(userId);
    return { success: true };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { receiver_id: userId, read_at: null },
      data: { read_at: new Date(), status: 0 },
    });

    this.gateway.sendToUser(userId, 'notification:unread_count', { count: 0 });
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET NOTIFICATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async getNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { receiver_id: userId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          notification_event: true,
          sender: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
              avatar: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.notification.count({ where: { receiver_id: userId } }),
      this.prisma.notification.count({
        where: { receiver_id: userId, read_at: null },
      }),
    ]);

    return {
      success: true,
      message: 'Notifications fetched successfully',
      data: notifications,
      meta: {
        total,
        unreadCount,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private async _emitUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { receiver_id: userId, read_at: null },
    });
    this.gateway.sendToUser(userId, 'notification:unread_count', { count });
  }
}
