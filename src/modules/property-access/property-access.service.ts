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
// import { NotificationService } from '../notification/notification.service';

@Injectable()
export class PropertyAccessService {
  constructor(
    private readonly prisma: PrismaService,
    // private readonly notifications: NotificationService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — Authorized Viewer clicks "Request Access" (Image 3)
  // ─────────────────────────────────────────────────────────────────────────

  async requestAccess(
    propertyId: string,
    requesterId: string,
    dto: RequestPropertyAccessDto,
  ) {
    const property = await this._assertPropertyExists(propertyId);

    // Guard: already has active access?
    const existingAccess = await this.prisma.propertyAccess.findUnique({
      where: { propertyId_userId: { propertyId, userId: requesterId } },
    });
    if (existingAccess && !existingAccess.revokedAt) {
      throw new ConflictException('You already have access to this property dashboard.');
    }

    // Guard: already has a pending request?
    const existingRequest = await this.prisma.propertyAccessRequest.findUnique({
      where: { propertyId_requesterId: { propertyId, requesterId } },
    });
    if (existingRequest?.status === 'PENDING') {
      throw new ConflictException(
        'You already have a pending access request for this property.',
      );
    }

    // Upsert: if previously declined, allow re-requesting
    const accessRequest = await this.prisma.propertyAccessRequest.upsert({
      where: { propertyId_requesterId: { propertyId, requesterId } },
      create: {
        propertyId,
        requesterId,
        status: 'PENDING',
      },
      update: {
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      },
    });

    // ── Notify the Property Manager (or Admin if no PM assigned) ─────────
    const recipientId = property.propertyManagerId ?? await this._getAnyAdminId();

    // if (recipientId) {
    //   await this.notifications.send({
    //     receiverId: recipientId,
    //     senderId: requesterId,
    //     type: 'property_access_requested',
    //     entityId: accessRequest.id,   // used to build Accept/Decline action buttons
    //     text: `Requested to View ${property.name} Property.`,
    //     metadata: {
    //       propertyId,
    //       propertyName: property.name,
    //       requestId: accessRequest.id,
    //       message: dto.message,
    //     },
    //   });
    // }

    return accessRequest;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — Property Manager clicks Accept / Decline (Image 2 notification)
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

    // Verify reviewer is allowed (PM of this property OR admin)
    await this._assertCanReview(reviewerId, request.propertyId);

    if (dto.action === 'APPROVED') {
      // Transaction: update request + create PropertyAccess row atomically
      await this.prisma.$transaction(async (tx) => {
        await tx.propertyAccessRequest.update({
          where: { id: requestId },
          data: {
            status: 'APPROVED',
            reviewedBy: reviewerId,
            reviewedAt: new Date(),
          },
        });

        // Upsert access — handles case where access was previously revoked
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
            revokedAt: null,  // clear any previous revocation
            revokedBy: null,
          },
        });

        await tx.auditLog.create({
          data: {
            user_id: reviewerId,
            property_id: request.propertyId,
            action: 'access_request_approved',
            entity_type: 'property_access_request',
            entity_id: requestId,
            metadata: {
              requesterId: request.requesterId,
              requesterEmail: request.requester.email,
              expiresAt: dto.expiresAt ?? null,
            },
          },
        });
      });

      // Notify the requester their access was approved
    //   await this.notifications.send({
    //     receiverId: request.requesterId,
    //     senderId: reviewerId,
    //     type: 'access_request_approved',
    //     entityId: request.propertyId,
    //     text: `Your access request for ${request.property.name} has been approved.`,
    //     metadata: {
    //       propertyId: request.propertyId,
    //       propertyName: request.property.name,
    //     },
    //   });

      return { message: 'Access approved.', requestId, propertyId: request.propertyId };
    }

    // ── DECLINED ─────────────────────────────────────────────────────────
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

      await this.prisma.auditLog.create({
        data: {
          user_id: reviewerId,
          property_id: request.propertyId,
          action: 'access_request_declined',
          entity_type: 'property_access_request',
          entity_id: requestId,
          metadata: { reason: dto.declineReason, requesterId: request.requesterId },
        },
      });

      // Notify the requester they were declined
    //   await this.notifications.send({
    //     receiverId: request.requesterId,
    //     senderId: reviewerId,
    //     type: 'access_request_declined',
    //     entityId: request.propertyId,
    //     text: `Your access request for ${request.property.name} was declined.`,
    //     metadata: {
    //       propertyId: request.propertyId,
    //       propertyName: request.property.name,
    //       reason: dto.declineReason,
    //     },
    //   });

      return { message: 'Access declined.', requestId };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3 — Check if user can enter a dashboard (called on dashboard load)
  // ─────────────────────────────────────────────────────────────────────────

  async checkDashboardAccess(
    propertyId: string,
    userId: string,
    userRole: string,
  ): Promise<{ hasAccess: boolean; reason?: string }> {
    // Admins always have access
    if (userRole === 'ADMIN') return { hasAccess: true };

    // Property Manager of this property always has access
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { propertyManagerId: true },
    });
    if (property?.propertyManagerId === userId) return { hasAccess: true };

    // Check PropertyAccess table
    const access = await this.prisma.propertyAccess.findUnique({
      where: { propertyId_userId: { propertyId, userId } },
    });

    if (!access) {
      return { hasAccess: false, reason: 'NO_ACCESS' };
    }

    if (access.revokedAt) {
      return { hasAccess: false, reason: 'REVOKED' };
    }

    if (access.expiresAt && access.expiresAt < new Date()) {
      return { hasAccess: false, reason: 'EXPIRED' };
    }

    return { hasAccess: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Share dashboard directly via email/userId (Image 1 — Share modal)
  // ─────────────────────────────────────────────────────────────────────────

  async shareDashboard(
    propertyId: string,
    granterId: string,
    dto: ShareDashboardDto,
  ) {
    const property = await this._assertPropertyExists(propertyId);

    // Resolve user by email or id
    const targetUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { id: dto.emailOrUserId },
          { email: dto.emailOrUserId },
        ],
        isDeleted: false,
      },
    });

    if (!targetUser) {
      throw new NotFoundException(
        `No user found with email or ID "${dto.emailOrUserId}".`,
      );
    }

    // Upsert access (grant or re-grant)
    const access = await this.prisma.propertyAccess.upsert({
      where: {
        propertyId_userId: { propertyId, userId: targetUser.id },
      },
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

    await this.prisma.auditLog.create({
      data: {
        user_id: granterId,
        property_id: propertyId,
        action: 'dashboard_shared',
        entity_type: 'property_access',
        entity_id: access.id,
        metadata: {
          sharedWithUserId: targetUser.id,
          sharedWithEmail: targetUser.email,
          expiresAt: dto.expiresAt ?? null,
        },
      },
    });

    // Notify the invited user
    // await this.notifications.send({
    //   receiverId: targetUser.id,
    //   senderId: granterId,
    //   type: 'new_property_dashboard_invitation',
    //   entityId: propertyId,
    //   text: `You've been given access to ${property.name}.`,
    //   metadata: { propertyId, propertyName: property.name },
    // });

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
  // Revoke access (Image 1 — "Remove" button in share list)
  // ─────────────────────────────────────────────────────────────────────────

  async revokeAccess(
    propertyId: string,
    targetUserId: string,
    revokerId: string,
    dto: RevokeAccessDto,
  ) {
    await this._assertPropertyExists(propertyId);

    const access = await this.prisma.propertyAccess.findUnique({
      where: { propertyId_userId: { propertyId, userId: targetUserId } },
    });

    if (!access || access.revokedAt) {
      throw new NotFoundException('Active access record not found for this user.');
    }

    await this.prisma.propertyAccess.update({
      where: { propertyId_userId: { propertyId, userId: targetUserId } },
      data: { revokedAt: new Date(), revokedBy: revokerId },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: revokerId,
        property_id: propertyId,
        action: 'access_revoked',
        entity_type: 'property_access',
        entity_id: access.id,
        metadata: { revokedUserId: targetUserId, reason: dto.reason ?? null },
      },
    });

    return { message: 'Access revoked.' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Get all users with access to a property (Image 1 — "Who has view access")
  // ─────────────────────────────────────────────────────────────────────────

  async getDashboardAccessList(propertyId: string) {
    await this._assertPropertyExists(propertyId);

    return this.prisma.propertyAccess.findMany({
      where: {
        propertyId,
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
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
  // Get all pending requests for a property (for PM notification badge)
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
    if (!property) throw new NotFoundException(`Property "${propertyId}" not found.`);
    return property;
  }

  private async _assertCanReview(reviewerId: string, propertyId: string) {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId },
    });
    if (!reviewer) throw new NotFoundException('Reviewer not found.');

    if (reviewer.role === 'ADMIN') return; // Admins can always review

    // Property Manager can only review requests for their own properties
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