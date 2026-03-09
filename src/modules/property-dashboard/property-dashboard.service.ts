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
import { ActivityCategory } from 'prisma/generated/enums';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class PropertyDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ─── 1. CREATE PROPERTY + DASHBOARD ────────────────────────────────────────

  async createProperty(dto: CreatePropertyDto, adminId: string) {
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

    let pmUser = null;
    if (dto.propertyManagerId) {
      pmUser = await this.prisma.user.findFirst({
        where: {
          id: dto.propertyManagerId,
          role: Role.PROPERTY_MANAGER,
          isDeleted: false,
        },
      });
      if (!pmUser) {
        throw new NotFoundException(
          `Property Manager with id "${dto.propertyManagerId}" not found.`,
        );
      }
    }

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

      const dashboard = await tx.propertyDashboard.create({
        data: {
          propertyId: property.id,
          templateId: dto.templateId ?? null,
          templateSnapshot: dto.templateId ?? null,
        },
      });

      await tx.activityLog.create({
        data: {
          category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
          actor_role: Role.ADMIN,
          message: `${property.name} property dashboard created`,
        },
      });

      return { property, dashboard };
    });

    // ── Notify PM if assigned at creation time ─────────────────────────────
    if (pmUser && result.dashboard) {
      await this.notifications.dashboardAssigned({
        propertyManagerId: pmUser.id,
        assignedById: adminId,
        propertyId: result.property.id,
        propertyName: result.property.name,
        dashboardId: result.dashboard.id,
      });
    }

    return {
      success: true,
      message: 'Property and dashboard created successfully',
      data: result,
    };
  }

  // ─── 2. LIST PROPERTIES ─────────────────────────────────────────────────────

  async findAll(
    requestingUserId: string,
    requestingUserRole: string,
    filters: {
      page: number;
      limit: number;
      search?: string;
      status?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      dateFrom,
      dateTo,
    } = filters;

    const skip = (page - 1) * limit;

    // ── Base where clause ────────────────────────────────────────────────────
    const where: any = {
      ...(status ? { status } : { status: { not: 'ARCHIVED' } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom && { gte: new Date(dateFrom) }),
              ...(dateTo && { lte: new Date(dateTo) }),
            },
          }
        : {}),
    };

    // ── Role-based scope ─────────────────────────────────────────────────────
    if (requestingUserRole === Role.PROPERTY_MANAGER) {
      where.propertyManagerId = requestingUserId;
    }

    const orderBy = { [sortBy]: sortOrder };

    const dashboardSelect = {
      select: {
        id: true,
        updatedAt: true,
        propertyId: true,
        inspections: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: { overallScore: true, healthLabel: true },
        },
      },
    };

    // ── Admin ────────────────────────────────────────────────────────────────
    if (requestingUserRole === Role.ADMIN) {
      const [properties, total] = await this.prisma.$transaction([
        this.prisma.property.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            propertyManager: {
              select: { id: true, name: true, email: true, avatar: true },
            },
            dashboard: dashboardSelect,
          },
        }),
        this.prisma.property.count({ where }),
      ]);

      const total_pages = Math.ceil(total / limit);

      return {
        success: true,
        message: 'Properties retrieved successfully',
        data: properties.map((p) => ({
          ...p,
          dashboard: p.dashboard
            ? {
                ...p.dashboard,
                latestInspection: p.dashboard.inspections[0] ?? null,
                inspections: undefined,
              }
            : null,
        })),
        meta: {
          total,
          page,
          limit,
          total_pages,
          has_next_page: page < total_pages,
          has_prev_page: page > 1,
        },
      };
    }

    // ── Property Manager ─────────────────────────────────────────────────────
    if (requestingUserRole === Role.PROPERTY_MANAGER) {
      const [properties, total] = await this.prisma.$transaction([
        this.prisma.property.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            propertyManager: {
              select: { id: true, name: true, email: true, avatar: true },
            },
            dashboard: dashboardSelect,
          },
        }),
        this.prisma.property.count({ where }),
      ]);

      const total_pages = Math.ceil(total / limit);

      return {
        success: true,
        message: 'Properties retrieved successfully',
        data: properties.map((p) => ({
          ...p,
          dashboard: p.dashboard
            ? {
                ...p.dashboard,
                latestInspection: p.dashboard.inspections[0] ?? null,
                inspections: undefined,
              }
            : null,
        })),
        meta: {
          total,
          page,
          limit,
          total_pages,
          has_next_page: page < total_pages,
          has_prev_page: page > 1,
        },
      };
    }

    return {
      success: true,
      data: [],
      meta: { total: 0, page, limit, total_pages: 0 },
    };
  }

  // ─── GET SINGLE PROPERTY + DASHBOARD ──────────────────────────────────────────

  async findOne(propertyId: string) {
    // ── Resolve dashboardId from propertyId ───────────────────────────────────
    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { propertyId },
      select: { id: true },
    });

    if (!dashboard)
      throw new NotFoundException(
        `No dashboard found for property "${propertyId}".`,
      );

    return this.findOneByDashboard(dashboard.id);
  }

  // ─── GET BY DASHBOARD ID (primary — used by all downstream routes) ─────────

  async findOneByDashboard(dashboardId: string) {
    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { id: dashboardId },
      include: {
        property: {
          include: {
            propertyManager: {
              select: { id: true, name: true, email: true, avatar: true },
            },
            activeTemplate: true,
          },
        },
        inspections: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { mediaFiles: true },
        },
        documents: {
          where: { isArchived: false },
          orderBy: { uploadedAt: 'desc' },
        },
        folders: {
          include: {
            items: {
              select: { inspectionId: true },
            },
          },
        },
      },
    });

    if (!dashboard)
      throw new NotFoundException(`Dashboard "${dashboardId}" not found.`);

    return {
      success: true,
      message: 'Dashboard retrieved successfully',
      data: dashboard,
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

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: Role.ADMIN,
        message: `${updated.name} property details updated`,
      },
    });

    // ── Notify all users with access to this property ──────────────────────
    const accesses = await this.prisma.propertyAccess.findMany({
      where: { propertyId, revokedAt: null },
      select: { userId: true },
    });

    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { propertyId },
      select: { id: true },
    });

    if (accesses.length && dashboard) {
      await this.notifications.dashboardUpdated({
        userIds: accesses.map((a) => a.userId),
        updatedById: adminId,
        propertyId,
        propertyName: updated.name,
        dashboardId: dashboard.id,
        changeNote: 'Property details have been updated',
      });
    }

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

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: Role.ADMIN,
        message: `Inspection scheduled for ${updated.name} on ${new Date(dto.scheduledAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`,
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

    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { name: true },
    });
    if (!property) throw new NotFoundException('Property not found.');

    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date()) {
      throw new BadRequestException('expiresAt must be a future date.');
    }

    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { propertyId },
      select: { id: true },
    });

    // ── Property Manager ───────────────────────────────────────────────────
    if (user.role === Role.PROPERTY_MANAGER) {
      const updated = await this.prisma.property.update({
        where: { id: propertyId },
        data: { propertyManagerId: dto.userId },
      });

      await this.prisma.activityLog.create({
        data: {
          category: ActivityCategory.USER_ACCESS,
          actor_role: Role.PROPERTY_MANAGER,
          message: `${user.name} was assigned to ${updated.name} dashboard`,
        },
      });

      // ── Notify the PM ────────────────────────────────────────────────────
      if (dashboard) {
        await this.notifications.dashboardAssigned({
          propertyManagerId: user.id,
          assignedById: adminId,
          propertyId,
          propertyName: updated.name,
          dashboardId: dashboard.id,
        });
      }

      return {
        success: true,
        message: 'Property Manager assigned successfully',
        data: updated,
      };
    }

    // ── Other roles (Authorized Viewer, Operational, etc.) ─────────────────
    const access = await this.prisma.propertyAccess.upsert({
      where: { propertyId_userId: { propertyId, userId: dto.userId } },
      create: {
        propertyId,
        userId: dto.userId,
        grantedBy: adminId,
        grantedAt: new Date(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        revokedAt: null,
      },
      update: {
        grantedBy: adminId,
        grantedAt: new Date(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        revokedAt: null,
        revokedBy: null,
      },
    });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.USER_ACCESS,
        actor_role: user.role,
        message: dto.expiresAt
          ? `${user.name} was given view access to ${property.name} dashboard until ${new Date(dto.expiresAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : `${user.name} was given view access to ${property.name} dashboard`,
      },
    });

    // ── Notify the user ──────────────────────────────────────────────────────
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { name: true },
    });

    if (dashboard) {
      await this.notifications.dashboardShared({
        userId: user.id,
        sharedById: adminId,
        sharerName: admin?.name ?? 'Admin',
        propertyId,
        propertyName: property.name,
        dashboardId: dashboard.id,
      });
    }

    return {
      success: true,
      message: dto.expiresAt
        ? `Access granted — expires ${new Date(dto.expiresAt).toDateString()}`
        : 'User access granted successfully',
      data: access,
    };
  }

  // ─── 7. GET PROPERTY ACCESS LIST ────────────────────────────────────────────

  async getPropertyAccess(propertyId: string) {
    await this._assertPropertyExists(propertyId);

    const [property, accesses] = await Promise.all([
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
      this.prisma.propertyAccess.findMany({
        where: { propertyId, revokedAt: null },
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

  // ─── 8. SET ACCESS EXPIRATION DATE ──────────────────────────────────────────

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

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.USER_ACCESS,
        actor_role: Role.ADMIN,
        message: `${user.name} access expiration set to ${new Date(dto.accessExpiresAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`,
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
