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

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — Authorized Viewer clicks "Request Access"
  // ─────────────────────────────────────────────────────────────────────────

  async requestAccess(
    propertyId: string,
    requesterId: string,
    dto: RequestPropertyAccessDto,
  ) {
    const property = await this._assertPropertyExists(propertyId);

    const existingAccess = await this.prisma.propertyAccess.findUnique({
      where: { propertyId_userId: { propertyId, userId: requesterId } },
    });
    if (existingAccess && !existingAccess.revokedAt) {
      throw new ConflictException(
        'You already have access to this property dashboard.',
      );
    }

    const existingRequest = await this.prisma.propertyAccessRequest.findUnique({
      where: { propertyId_requesterId: { propertyId, requesterId } },
    });
    if (existingRequest?.status === 'PENDING') {
      throw new ConflictException(
        'You already have a pending access request for this property.',
      );
    }

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

    // ── Notify PM (or admin fallback) ─────────────────────────────────────
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

  async getAllAccessRequests(filters: {
    propertyId?: string;
    status?: AccessRequestStatus;
    requesterId?: string;
  }) {
    const requests = await this.prisma.propertyAccessRequest.findMany({
      where: {
        ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.requesterId ? { requesterId: filters.requesterId } : {}),
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

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — Property Manager clicks Accept / Decline
  // ─────────────────────────────────────────────────────────────────────────

  async reviewAccessRequest(
    requestId: string,
    reviewerId: string,
    dto: ReviewAccessRequestDto,
  ) {
    const request = await this.prisma.propertyAccessRequest.findUnique({
      where: { id: requestId },
      include: { property: true, requester: true },
    });

    if (!request) throw new NotFoundException('Access request not found.');
    if (request.status !== 'PENDING') {
      throw new BadRequestException(
        `This request has already been ${request.status.toLowerCase()}.`,
      );
    }

    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId },
      select: { name: true, email: true },
    });

    await this._assertCanReview(reviewerId, request.propertyId);

    // ── APPROVED ──────────────────────────────────────────────────────────
    if (dto.action === 'APPROVED') {
      let dashboardId: string | null = null;

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
            propertyId_userId: {
              propertyId: request.propertyId,
              userId: request.requesterId,
            },
          },
          create: {
            propertyId: request.propertyId,
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

        const dashboard = await tx.propertyDashboard.findUnique({
          where: { propertyId: request.propertyId },
          select: { id: true },
        });
        dashboardId = dashboard?.id ?? null;

        await tx.activityLog.create({
          data: {
            category: ActivityCategory.USER_ACCESS,
            actor_role: request.requester.role,
            message: `${request.requester.name} access request for ${request.property.name} was approved`,
          },
        });
      });

      // ── Notify requester ───────────────────────────────────────────────
      await this.notifications.accessApproved({
        userId: request.requesterId,
        approvedBy: reviewerId,
        approverName: reviewer?.name ?? 'Admin',
        propertyId: request.propertyId,
        propertyName: request.property.name,
        dashboardId: dashboardId ?? request.propertyId,
      });

      return {
        message: 'Access approved.',
        requestId,
        propertyId: request.propertyId,
      };
    }

    // ── DECLINED ──────────────────────────────────────────────────────────
    if (dto.action === 'DECLINED') {
      if (!dto.declineReason) {
        throw new BadRequestException('A decline reason is required.');
      }

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

      // ── Notify requester ───────────────────────────────────────────────
      await this.notifications.accessDeclined({
        userId: request.requesterId,
        declinedBy: reviewerId,
        declinerName: reviewer?.name ?? 'Admin',
        propertyId: request.propertyId,
        propertyName: request.property.name,
      });

      return { message: 'Access declined.', requestId };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3 — Check dashboard access
  // ─────────────────────────────────────────────────────────────────────────

  async checkDashboardAccess(
    propertyId: string,
    userId: string,
    userRole: string,
  ): Promise<{ hasAccess: boolean; reason?: string }> {
    if (userRole === 'ADMIN') return { hasAccess: true };

    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { propertyManagerId: true },
    });
    if (property?.propertyManagerId === userId) return { hasAccess: true };

    const access = await this.prisma.propertyAccess.findUnique({
      where: { propertyId_userId: { propertyId, userId } },
    });

    if (!access) return { hasAccess: false, reason: 'NO_ACCESS' };
    if (access.revokedAt) return { hasAccess: false, reason: 'REVOKED' };
    if (access.expiresAt && access.expiresAt < new Date())
      return { hasAccess: false, reason: 'EXPIRED' };

    return { hasAccess: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Share dashboard directly via email/userId
  // ─────────────────────────────────────────────────────────────────────────

  async shareDashboard(
    propertyId: string,
    granterId: string,
    dto: ShareDashboardDto,
  ) {
    const property = await this._assertPropertyExists(propertyId);

    const targetUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: dto.emailOrUserId }, { email: dto.emailOrUserId }],
        isDeleted: false,
      },
    });

    if (!targetUser) {
      throw new NotFoundException(
        `No user found with email or ID "${dto.emailOrUserId}".`,
      );
    }

    const granter = await this.prisma.user.findUnique({
      where: { id: granterId },
      select: { name: true },
    });

    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { propertyId },
      select: { id: true },
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

    // ── Notify the invited user ────────────────────────────────────────────
    await this.notifications.dashboardShared({
      userId: targetUser.id,
      sharedById: granterId,
      sharerName: granter?.name ?? 'Admin',
      propertyId,
      propertyName: property.name,
      dashboardId: dashboard?.id ?? propertyId,
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

  // ─────────────────────────────────────────────────────────────────────────
  // Revoke access
  // ─────────────────────────────────────────────────────────────────────────

  async revokeAccess(
    propertyId: string,
    targetUserId: string,
    revokerId: string,
    dto: RevokeAccessDto,
  ) {
    const property = await this._assertPropertyExists(propertyId);

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { name: true, role: true },
    });

    const access = await this.prisma.propertyAccess.findUnique({
      where: { propertyId_userId: { propertyId, userId: targetUserId } },
    });

    if (!access || access.revokedAt) {
      throw new NotFoundException(
        'Active access record not found for this user.',
      );
    }

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

  // ─────────────────────────────────────────────────────────────────────────
  // Get dashboard access list
  // ─────────────────────────────────────────────────────────────────────────

  async getDashboardAccessList(propertyId: string) {
    await this._assertPropertyExists(propertyId);

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

  // ─────────────────────────────────────────────────────────────────────────
  // Get pending requests
  // ─────────────────────────────────────────────────────────────────────────

  async getPendingRequests(propertyId: string) {
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

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private async _assertPropertyExists(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property)
      throw new NotFoundException(`Property "${propertyId}" not found.`);
    return property;
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
}
