import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  RequestPropertyAccessDto,
  ReviewAccessRequestDto,
  ShareDashboardDto,
  RevokeAccessDto,
} from './dto/property-access.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccessRequestStatus, ActivityCategory } from 'prisma/generated/enums';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class PropertyAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ─── PRIVATE HELPERS ──────────────────────────────────────────────────────

  private async _assertDashboardExists(dashboardId: string) {
    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { id: dashboardId },
      include: { property: true },
    });
    if (!dashboard)
      throw new NotFoundException(`Dashboard "${dashboardId}" not found.`);
    return {
      dashboard,
      propertyId: dashboard.propertyId,
      property: dashboard.property,
    };
  }

  private async _assertCanReview(reviewerId: string, propertyId: string) {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId },
    });
    if (!reviewer) throw new NotFoundException('Reviewer not found.');
    if (reviewer.role === 'ADMIN') return;

    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (property?.propertyManagerId !== reviewerId) {
      throw new ForbiddenException(
        'You are not the Property Manager for this dashboard.',
      );
    }
  }

  private async _getAnyAdminId(): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE', isDeleted: false },
      select: { id: true },
    });
    return admin?.id ?? null;
  }

  // ─── CHECK ACCESS ─────────────────────────────────────────────────────────

  async checkDashboardAccess(
    dashboardId: string,
    userId: string,
    userRole: string,
  ) {
    const { propertyId, property } =
      await this._assertDashboardExists(dashboardId);

    if (userRole === 'ADMIN') return { hasAccess: true };
    if (property.propertyManagerId === userId) return { hasAccess: true };

    const access = await this.prisma.propertyAccess.findUnique({
      where: { propertyId_userId: { propertyId, userId } },
    });

    if (!access) return { hasAccess: false, reason: 'NO_ACCESS' };
    if (access.revokedAt) return { hasAccess: false, reason: 'REVOKED' };
    if (access.expiresAt && access.expiresAt < new Date())
      return { hasAccess: false, reason: 'EXPIRED' };

    return { hasAccess: true };
  }

  // ─── REQUEST ACCESS ───────────────────────────────────────────────────────

  async requestAccess(
    dashboardId: string,
    requesterId: string,
    dto: RequestPropertyAccessDto,
  ) {
    const { propertyId, property } =
      await this._assertDashboardExists(dashboardId);

    const existingAccess = await this.prisma.propertyAccess.findUnique({
      where: { propertyId_userId: { propertyId, userId: requesterId } },
    });
    if (existingAccess && !existingAccess.revokedAt)
      throw new ConflictException(
        'You already have access to this property dashboard.',
      );

    const existingRequest = await this.prisma.propertyAccessRequest.findUnique({
      where: { propertyId_requesterId: { propertyId, requesterId } },
    });
    if (existingRequest?.status === 'PENDING')
      throw new ConflictException(
        'You already have a pending access request for this property.',
      );

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { name: true, email: true, avatar: true },
    });

    const accessRequest = await this.prisma.propertyAccessRequest.upsert({
      where: { propertyId_requesterId: { propertyId, requesterId } },
      create: { propertyId, requesterId, status: 'PENDING' },
      update: {
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      },
    });

    const recipientId =
      property.propertyManagerId ?? (await this._getAnyAdminId());
    if (recipientId) {
      await this.notifications.accessRequested({
        propertyManagerId: recipientId,
        requesterId,
        requesterName: requester.name ?? requester.email ?? 'Unknown',
        requesterEmail: requester.email ?? '',
        requesterAvatar: requester.avatar ?? undefined,
        propertyId,
        propertyName: property.name,
      });
    }

    return accessRequest;
  }

  // ─── GET ALL ACCESS REQUESTS ──────────────────────────────────────────────

  async getAllAccessRequests(filters: {
    dashboardId?: string;
    status?: AccessRequestStatus;
    requesterId?: string;
  }) {
    // Resolve propertyId from dashboardId if provided
    let propertyId: string | undefined;
    if (filters.dashboardId) {
      const { propertyId: pid } = await this._assertDashboardExists(
        filters.dashboardId,
      );
      propertyId = pid;
    }

    const requests = await this.prisma.propertyAccessRequest.findMany({
      where: {
        ...(propertyId && { propertyId }),
        ...(filters.status && { status: filters.status }),
        ...(filters.requesterId && { requesterId: filters.requesterId }),
      },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            propertyType: true,
            status: true,
          },
        },
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
          },
        },
        reviewer: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      message: 'Access requests retrieved successfully',
      data: requests,
    };
  }

  // ─── REVIEW ACCESS REQUEST ────────────────────────────────────────────────

  async reviewAccessRequest(
    dashboardId: string,
    requestId: string,
    reviewerId: string,
    dto: ReviewAccessRequestDto,
  ) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    const request = await this.prisma.propertyAccessRequest.findUnique({
      where: { id: requestId },
      include: { property: true, requester: true },
    });

    if (!request) throw new NotFoundException('Access request not found.');
    if (request.propertyId !== propertyId)
      throw new BadRequestException(
        'This request does not belong to the given dashboard.',
      );
    if (request.status !== 'PENDING')
      throw new BadRequestException(
        `This request has already been ${request.status.toLowerCase()}.`,
      );

    await this._assertCanReview(reviewerId, propertyId);

    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId },
      select: { name: true, email: true },
    });

    // ── APPROVED ──────────────────────────────────────────────────────────
    if (dto.action === 'APPROVED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.propertyAccessRequest.update({
          where: { id: requestId },
          data: {
            status: 'APPROVED',
            reviewedBy: reviewerId,
            reviewedAt: new Date(),
          },
        });

        await tx.propertyAccess.upsert({
          where: {
            propertyId_userId: { propertyId, userId: request.requesterId },
          },
          create: {
            propertyId,
            userId: request.requesterId,
            grantedBy: reviewerId,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          },
          update: {
            grantedBy: reviewerId,
            grantedAt: new Date(),
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
            revokedAt: null,
            revokedBy: null,
          },
        });

        await tx.activityLog.create({
          data: {
            category: ActivityCategory.USER_ACCESS,
            actor_role: request.requester.role,
            message: `${request.requester.name} access request for ${request.property.name} was approved`,
          },
        });
      });

      await this.notifications.accessApproved({
        userId: request.requesterId,
        approvedBy: reviewerId,
        approverName: reviewer?.name ?? 'Admin',
        propertyId,
        propertyName: request.property.name,
        dashboardId,
      });

      return { message: 'Access approved.', requestId, dashboardId };
    }

    // ── DECLINED ──────────────────────────────────────────────────────────
    if (dto.action === 'DECLINED') {
      if (!dto.declineReason)
        throw new BadRequestException('A decline reason is required.');

      await this.prisma.propertyAccessRequest.update({
        where: { id: requestId },
        data: {
          status: 'DECLINED',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      });

      await this.prisma.activityLog.create({
        data: {
          category: ActivityCategory.USER_ACCESS,
          actor_role: request.requester.role,
          message: `${request.requester.name} access request for ${request.property.name} was declined`,
        },
      });

      await this.notifications.accessDeclined({
        userId: request.requesterId,
        declinedBy: reviewerId,
        declinerName: reviewer?.name ?? 'Admin',
        propertyId,
        propertyName: request.property.name,
      });

      return { message: 'Access declined.', requestId };
    }
  }

  // ─── SHARE DASHBOARD ──────────────────────────────────────────────────────

  async shareDashboard(
    dashboardId: string,
    granterId: string,
    dto: ShareDashboardDto,
  ) {
    const { propertyId, property } =
      await this._assertDashboardExists(dashboardId);

    const targetUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: dto.emailOrUserId }, { email: dto.emailOrUserId }],
        isDeleted: false,
      },
    });
    if (!targetUser)
      throw new NotFoundException(
        `No user found with email or ID "${dto.emailOrUserId}".`,
      );

    const granter = await this.prisma.user.findUnique({
      where: { id: granterId },
      select: { name: true },
    });

    const access = await this.prisma.propertyAccess.upsert({
      where: { propertyId_userId: { propertyId, userId: targetUser.id } },
      create: {
        propertyId,
        userId: targetUser.id,
        grantedBy: granterId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      update: {
        grantedBy: granterId,
        grantedAt: new Date(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        revokedAt: null,
        revokedBy: null,
      },
    });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.USER_ACCESS,
        actor_role: targetUser.role,
        message: `${targetUser.name} was given view access to ${property.name} dashboard`,
      },
    });

    await this.notifications.dashboardShared({
      userId: targetUser.id,
      sharedById: granterId,
      sharerName: granter?.name ?? 'Admin',
      propertyId,
      propertyName: property.name,
      dashboardId,
    });

    return {
      message: `Access granted to ${targetUser.email}.`,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        avatar: targetUser.avatar,
        expiresAt: access.expiresAt,
      },
    };
  }

  // ─── REVOKE ACCESS ────────────────────────────────────────────────────────

  async revokeAccess(
    dashboardId: string,
    targetUserId: string,
    revokerId: string,
    dto: RevokeAccessDto,
  ) {
    const { propertyId, property } =
      await this._assertDashboardExists(dashboardId);

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { name: true, role: true },
    });
    if (!targetUser) throw new NotFoundException('User not found.');

    const access = await this.prisma.propertyAccess.findUnique({
      where: { propertyId_userId: { propertyId, userId: targetUserId } },
    });
    if (!access || access.revokedAt)
      throw new NotFoundException(
        'Active access record not found for this user.',
      );

    await this.prisma.propertyAccess.update({
      where: { propertyId_userId: { propertyId, userId: targetUserId } },
      data: { revokedAt: new Date(), revokedBy: revokerId },
    });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.USER_ACCESS,
        actor_role: targetUser.role,
        message: `${targetUser.name} access to ${property.name} dashboard was revoked`,
      },
    });

    return { message: 'Access revoked.' };
  }

  // ─── GET ACCESS LIST ──────────────────────────────────────────────────────

  async getDashboardAccessList(dashboardId: string) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    return this.prisma.propertyAccess.findMany({
      where: {
        propertyId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
          },
        },
      },
      orderBy: { grantedAt: 'desc' },
    });
  }

  // ─── GET PENDING REQUESTS ─────────────────────────────────────────────────

  async getPendingRequests(dashboardId: string) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    return this.prisma.propertyAccessRequest.findMany({
      where: { propertyId, status: 'PENDING' },
      include: {
        requester: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
