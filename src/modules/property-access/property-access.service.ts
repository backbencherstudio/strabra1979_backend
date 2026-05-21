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
import { Role } from 'src/common/guard/role/role.enum';
import appConfig from 'src/config/app.config';
import { MailService } from 'src/mail/mail.service';
import { randomBytes } from 'crypto';

@Injectable()
export class PropertyAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly mailService: MailService,
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
      select: { username: true, email: true, avatar: true },
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
        requesterName: requester.username ?? requester.email ?? 'Unknown',
        requesterEmail: requester.email ?? '',
        requesterAvatar: requester.avatar ?? undefined,
        dashboardId,
        propertyName: property.name,
        requestId: accessRequest.id,
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
            username: true,
            email: true,
            avatar: true,
            role: true,
          },
        },
        reviewer: {
          select: { id: true, username: true, email: true, role: true },
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
      select: { username: true, email: true },
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
            message: `${request.requester.username} access request for ${request.property.name} was approved`,
          },
        });
      });

      await this.notifications.accessApproved({
        userId: request.requesterId,
        approvedBy: reviewerId,
        approverName: reviewer?.username ?? 'Admin',
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
          message: `${request.requester.username} access request for ${request.property.name} was declined`,
        },
      });

      await this.notifications.accessDeclined({
        userId: request.requesterId,
        declinedBy: reviewerId,
        declinerName: reviewer?.username ?? 'Admin',
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

    const granter = await this.prisma.user.findUnique({
      where: { id: granterId },
      select: { username: true, first_name: true, last_name: true },
    });

    const granterName =
      `${granter?.first_name ?? ''} ${granter?.last_name ?? ''}`.trim() ||
      granter?.username ||
      'A team member';

    const platformName = appConfig().app.name ?? 'RoofWellness';

    // ── Check if target is an existing user ──────────────────────────
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: dto.emailOrUserId }, { email: dto.emailOrUserId }],
        isDeleted: false,
      },
    });

    // ── PATH A: User exists → grant access immediately ────────────────
    if (existingUser) {
      const access = await this.prisma.propertyAccess.upsert({
        where: { propertyId_userId: { propertyId, userId: existingUser.id } },
        create: {
          propertyId,
          userId: existingUser.id,
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
          actor_role: existingUser.role,
          message: `${existingUser.username} was given view access to ${property.name} dashboard`,
        },
      });

      await this.notifications.dashboardShared({
        userId: existingUser.id,
        sharedById: granterId,
        sharerName: granterName,
        propertyId,
        propertyName: property.name,
        dashboardId,
      });

      return {
        success: true,
        type: 'existing_user',
        message: `Access granted to ${existingUser.email}.`,
        user: {
          id: existingUser.id,
          name: existingUser.username,
          email: existingUser.email,
          avatar: existingUser.avatar,
          expiresAt: access.expiresAt,
        },
      };
    }

    // ── PATH B: No user found → send invite email ─────────────────────
    // Validate it looks like an email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(dto.emailOrUserId)) {
      throw new NotFoundException(
        `No user found with ID "${dto.emailOrUserId}". To invite by email, provide a valid email address.`,
      );
    }

    const inviteEmail = dto.emailOrUserId.toLowerCase().trim();

    // Upsert pending invitation (reset token if already invited)
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.pendingInvitation.upsert({
      where: {
        email_propertyId: { email: inviteEmail, propertyId },
      },
      create: {
        email: inviteEmail,
        propertyId,
        invitedBy: granterId,
        token,
        expiresAt,
      },
      update: {
        invitedBy: granterId,
        token,
        expiresAt,
        acceptedAt: null,
        acceptedBy: null,
      },
    });

    const signupLink = `${appConfig().app.client_app_url}/signup?invite=${token}&email=${encodeURIComponent(inviteEmail)}`;

    await this.mailService
      .sendDashboardInvitation({
        email: inviteEmail,
        inviterName: granterName,
        propertyName: property.name,
        propertyAddress: property.address,
        signupLink,
        platformName,
      })
      .catch((error) => {
        console.error(
          `Failed to send dashboard invitation to ${inviteEmail}:`,
          error,
        );
      });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.USER_ACCESS,
        actor_role: Role.AUTHORIZED_VIEWER,
        message: `${inviteEmail} was invited to ${property.name} dashboard (pending signup)`,
      },
    });

    return {
      success: true,
      type: 'pending_invitation',
      message: `Invitation sent to ${inviteEmail}. They will get access once they sign up.`,
      email: inviteEmail,
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

    // Get revoker details
    const revoker = await this.prisma.user.findUnique({
      where: { id: revokerId },
      select: {
        first_name: true,
        last_name: true,
        email: true,
        username: true,
      },
    });

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        role: true,
        email: true,
        first_name: true,
        last_name: true,
      },
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
        message: `${targetUser.username} access to ${property.name} dashboard was revoked by ${revoker?.username || revokerId}`,
      },
    });

    // Send email notification to the user whose access was revoked
    const platformName = appConfig().app.name ?? 'Platform';
    const revokerName = revoker
      ? `${revoker.first_name} ${revoker.last_name}`.trim()
      : revoker?.username || 'Administrator';
    const userName =
      targetUser.username ||
      `${targetUser.first_name} ${targetUser.last_name}`.trim() ||
      targetUser.email;

    await this.mailService.sendAccessRevoked({
      email: targetUser.email,
      username: userName,
      propertyName: property.name,
      propertyAddress: property.address,
      revokedBy: revokerName,
      platformName,
      reason: dto.reason,
    });

    return { message: 'Access revoked.' };
  }

  // ─── GET ACCESS LIST ──────────────────────────────────────────────────────

  async getDashboardAccessList(dashboardId: string) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    const [property, accessList] = await Promise.all([
      this.prisma.property.findUnique({
        where: { id: propertyId },
        select: {
          id: true,
          address: true,
          propertyType: true,
          propertyManager: {
            select: {
              id: true,
              username: true,
              email: true,
              avatar: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.propertyAccess.findMany({
        where: {
          propertyId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          // Exclude the PM from the access array — they're shown separately above
          user: {
            role: { in: [Role.AUTHORIZED_VIEWER, Role.OPERATIONAL] },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              avatar: true,
              role: true,
            },
          },
        },
        orderBy: { grantedAt: 'desc' },
      }),
    ]);

    return {
      success: true,
      message: 'Access list retrieved successfully',
      data: {
        propertyId: property.id,
        address: property.address,
        propertyType: property.propertyType,
        dashboardId,
        propertyManager: property.propertyManager ?? null,
        accessList: accessList.map((a) => ({
          accessId: a.id,
          grantedAt: a.grantedAt,
          expiresAt: a.expiresAt ?? null,
          user: a.user,
        })),
      },
    };
  }

  // ─── GET PENDING REQUESTS ─────────────────────────────────────────────────

  async getPendingRequests(dashboardId: string) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    return this.prisma.propertyAccessRequest.findMany({
      where: { propertyId, status: 'PENDING' },
      include: {
        requester: {
          select: { id: true, username: true, email: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
