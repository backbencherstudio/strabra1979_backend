import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  CreatePropertyDto,
  ScheduleInspectionDto,
  SetAccessExpirationDto,
  UpdatePropertyDto,
  AssignPropertyUserDto,
} from './dto/property-dashboard.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { Role } from 'src/common/guard/role/role.enum';

@Injectable()
export class PropertyDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── 1. CREATE PROPERTY + DASHBOARD ────────────────────────────────────────

  async createProperty(dto: CreatePropertyDto, adminId: string) {
    // Resolve template
    let template = dto.templateId
      ? await this.prisma.dashboardTemplate.findFirst({
          where: { id: dto.templateId, status: 'ACTIVE' },
        })
      : await this.prisma.dashboardTemplate.findFirst({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        });

    if (!template) {
      throw new BadRequestException(
        'No active dashboard template found. Please create a template first.',
      );
    }

    // Validate property manager if provided
    if (dto.propertyManagerId) {
      const pm = await this.prisma.user.findFirst({
        where: {
          id: dto.propertyManagerId,
          role: Role.PROPERTY_MANAGER,
          isDeleted: false,
        },
      });
      if (!pm) {
        throw new NotFoundException(
          `Property Manager with id "${dto.propertyManagerId}" not found.`,
        );
      }
    }

    // Create property + dashboard in a transaction so either both succeed or neither does
    const result = await this.prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          name: dto.name,
          address: dto.address,
          propertyType: dto.propertyType ?? null,
          nextInspectionDate: dto.nextInspectionDate
            ? new Date(dto.nextInspectionDate)
            : null,
          propertyManagerId: dto.propertyManagerId ?? null,
          activeTemplateId: dto.templateId ?? null,
        },
      });

      // Freeze a snapshot of the template sections at creation time
      // so future template edits never break this dashboard's layout
      const dashboard = await tx.propertyDashboard.create({
        data: {
          propertyId: property.id,
          templateId: dto.templateId ?? null,
          templateSnapshot: dto.templateId ?? null,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          user_id: adminId,
          property_id: property.id,
          action: 'property_created',
          entity_type: 'property',
          entity_id: property.id,
          metadata: {
            propertyName: property.name,
            templateId: dto.templateId ?? null,
          },
        },
      });

      return { property, dashboard };
    });

    return {
      success: true,
      message: 'Property and dashboard created successfully',
      data: result,
    };
  }

  // ─── 2. LIST PROPERTIES ─────────────────────────────────────────────────────

  async findAll(requestingUserId: string, requestingUserRole: string) {
    // Admins see every property; other roles see only their assigned ones
    if (requestingUserRole === Role.ADMIN) {
      const result = await this.prisma.property.findMany({
        where: { status: { not: 'ARCHIVED' } },
        include: {
          propertyManager: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
              inspections: true,
            },
          },
          dashboard: { select: { id: true, updatedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        message: 'Properties retrieved successfully',
        data: result,
      };
    }

    if (requestingUserRole === Role.PROPERTY_MANAGER) {
      const result = await this.prisma.property.findMany({
        where: {
          propertyManagerId: requestingUserId,
          status: { not: 'ARCHIVED' },
        },
        include: {
          propertyManager: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          dashboard: { select: { id: true, updatedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        message: 'Properties retrieved successfully',
        data: result,
      };
    }

    // AUTHORIZED_VIEWER / OPERATIONAL — needs a PropertyAccess join table (future)
    // For now, return empty so the API doesn't throw
    return [];
  }

  // ─── 3. GET SINGLE PROPERTY + DASHBOARD ─────────────────────────────────────

  async findOne(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        propertyManager: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        dashboard: {
          include: {
            inspections: {
              orderBy: { createdAt: 'desc' },
              take: 1, // latest inspection for health snapshot
              include: { mediaFiles: true },
            },
            documents: {
              where: { isArchived: false },
              orderBy: { uploadedAt: 'desc' },
            },
          },
        },
        activeTemplate: true,
      },
    });

    if (!property)
      throw new NotFoundException(`Property "${propertyId}" not found.`);

    return {
      success: true,
      message: 'Property and dashboard retrieved successfully',
      data: property,
    };
  }

  // ─── 4. UPDATE PROPERTY ──────────────────────────────────────────────────────

  async updateProperty(
    propertyId: string,
    dto: UpdatePropertyDto,
    adminId: string,
  ) {
    await this._assertPropertyExists(propertyId);

    const updated = await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.address && { address: dto.address }),
        ...(dto.propertyType !== undefined && {
          propertyType: dto.propertyType,
        }),
        ...(dto.nextInspectionDate !== undefined && {
          nextInspectionDate: dto.nextInspectionDate
            ? new Date(dto.nextInspectionDate)
            : null,
        }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: adminId,
        property_id: propertyId,
        action: 'property_updated',
        entity_type: 'property',
        entity_id: propertyId,
        metadata: dto as object,
      },
    });

    return {
      success: true,
      message: 'Property updated successfully',
      data: updated,
    };
  }

  // ─── 5. SCHEDULE AN INSPECTION ───────────────────────────────────────────────

  async scheduleInspection(
    propertyId: string,
    dto: ScheduleInspectionDto,
    adminId: string,
  ) {
    await this._assertPropertyExists(propertyId);

    const updated = await this.prisma.property.update({
      where: { id: propertyId },
      data: { nextInspectionDate: new Date(dto.scheduledAt) },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: adminId,
        property_id: propertyId,
        action: 'inspection_scheduled',
        entity_type: 'property',
        entity_id: propertyId,
        metadata: { scheduledAt: dto.scheduledAt },
      },
    });

    return {
      success: true,
      message: 'Inspection scheduled successfully',
      data: updated,
    };
  }

  // ─── 6. ASSIGN / CHANGE PROPERTY MANAGER ────────────────────────────────────

  async assignPropertyUser(
    propertyId: string,
    dto: AssignPropertyUserDto,
    adminId: string,
  ) {
    await this._assertPropertyExists(propertyId);

    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, isDeleted: false },
    });
    if (!user) throw new NotFoundException('User not found.');

    // Guard: expiry must be in the future if provided
    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date()) {
      throw new BadRequestException('expiresAt must be a future date.');
    }

    if (user.role === Role.PROPERTY_MANAGER) {
      // expiresAt not applicable for Property Manager — they are assigned on the property directly
      const updated = await this.prisma.property.update({
        where: { id: propertyId },
        data: { propertyManagerId: dto.userId },
      });

      await this.prisma.auditLog.create({
        data: {
          user_id: adminId,
          property_id: propertyId,
          action: 'property_manager_assigned',
          entity_type: 'property',
          entity_id: propertyId,
          metadata: {
            assignedUserId: dto.userId,
            assignedUserName: user.name,
            assignedUserRole: user.role,
          },
        },
      });

      return {
        success: true,
        message: 'Property Manager assigned successfully',
        data: updated,
      };
    } else {
      const access = await this.prisma.propertyAccess.upsert({
        where: { propertyId_userId: { propertyId, userId: dto.userId } },
        create: {
          propertyId,
          userId: dto.userId,
          grantedBy: adminId,
          grantedAt: new Date(),
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null, // ← new
          revokedAt: null,
        },
        update: {
          grantedBy: adminId,
          grantedAt: new Date(),
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null, // ← new
          revokedAt: null,
          revokedBy: null,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          user_id: adminId,
          property_id: propertyId,
          action: 'property_access_granted',
          entity_type: 'property',
          entity_id: propertyId,
          metadata: {
            assignedUserId: dto.userId,
            assignedUserName: user.name,
            assignedUserRole: user.role,
            expiresAt: dto.expiresAt ?? null,
          },
        },
      });

      return {
        success: true,
        message: dto.expiresAt
          ? `Access granted — expires ${new Date(dto.expiresAt).toDateString()}`
          : 'User access granted successfully',
        data: access,
      };
    }
  }

  // ─── 7. GET PROPERTY ACCESS LIST ────────────────────────────────────────────

  async getPropertyAccess(propertyId: string) {
    await this._assertPropertyExists(propertyId);

    const [property, accesses] = await Promise.all([
      // Property manager (assigned directly on property)
      this.prisma.property.findUnique({
        where: { id: propertyId },
        select: {
          id: true,
          name: true,
          propertyManager: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
              role: true,
              access_expires_at: true,
            },
          },
        },
      }),

      // All users granted access via PropertyAccess join table
      this.prisma.propertyAccess.findMany({
        where: {
          propertyId,
          revokedAt: null, // only active (non-revoked) access
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
      }),
    ]);

    return {
      success: true,
      message: 'Property access retrieved successfully',
      data: {
        id: property.id,
        name: property.name,
        propertyManager: property.propertyManager ?? null,
        accesses: accesses.map((a) => ({
          id: a.id,
          grantedAt: a.grantedAt,
          expiresAt: a.expiresAt ?? null,
          user: a.user,
        })),
      },
    };
  }

  // ─── 10. SET ACCESS EXPIRATION DATE ──────────────────────────────────────────

  async setAccessExpiration(
    propertyId: string,
    dto: SetAccessExpirationDto,
    adminId: string,
  ) {
    await this._assertPropertyExists(propertyId);

    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, isDeleted: false },
    });
    if (!user) throw new NotFoundException('User not found.');

    const updatedUser = await this.prisma.user.update({
      where: { id: dto.userId },
      data: { access_expires_at: new Date(dto.accessExpiresAt) },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: adminId,
        property_id: propertyId,
        action: 'user_access_expiration_set',
        entity_type: 'user',
        entity_id: dto.userId,
        metadata: { newExpiry: dto.accessExpiresAt },
      },
    });

    return {
      success: true,
      message: 'Access expiration updated.',
      user: updatedUser,
    };
  }
  // ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

  private async _assertPropertyExists(propertyId: string) {
    const exists = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!exists)
      throw new NotFoundException(`Property "${propertyId}" not found.`);
    return exists;
  }
}
