import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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
import {
  ActivityCategory,
  ScheduledInspectionStatus,
} from 'prisma/generated/enums';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class PropertyDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ─── PRIVATE HELPER — resolve dashboard + property in one shot ────────────

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

  // ─── 1. CREATE PROPERTY + DASHBOARD ──────────────────────────────────────

  async createProperty(dto: CreatePropertyDto, adminId: string) {
    const template = await this.prisma.dashboardTemplate.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!template)
      throw new BadRequestException(
        'No active dashboard template found. Please create a template first.',
      );

    let pmUser = null;
    if (dto.propertyManagerId) {
      pmUser = await this.prisma.user.findFirst({
        where: {
          id: dto.propertyManagerId,
          role: Role.PROPERTY_MANAGER,
          isDeleted: false,
        },
      });
      if (!pmUser)
        throw new NotFoundException(
          `Property Manager with id "${dto.propertyManagerId}" not found.`,
        );
    }

    // ── Validate assignee if nextInspectionDate + assignedTo given ────────
    let assignee = null;
    if (dto.nextInspectionDate && dto.assignedTo) {
      assignee = await this.prisma.user.findFirst({
        where: { id: dto.assignedTo, role: Role.OPERATIONAL, isDeleted: false },
      });
      if (!assignee)
        throw new NotFoundException(
          `Operational team member "${dto.assignedTo}" not found.`,
        );
    }

    if (
      dto.nextInspectionDate &&
      new Date(dto.nextInspectionDate) <= new Date()
    )
      throw new BadRequestException(
        'nextInspectionDate must be a future date.',
      );

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
          activeTemplateId: template.id,
        },
      });

      const dashboard = await tx.propertyDashboard.create({
        data: {
          propertyId: property.id,
          templateId: template.id,
          templateSnapshot: template.sections,
        },
      });

      // ── Schedule inspection if nextInspectionDate + assignedTo provided ──
      let scheduled = null;
      if (dto.nextInspectionDate && dto.assignedTo) {
        scheduled = await tx.scheduledInspection.create({
          data: {
            dashboardId: dashboard.id,
            assignedTo: dto.assignedTo,
            scheduledAt: new Date(dto.nextInspectionDate),
            createdBy: adminId,
            status: ScheduledInspectionStatus.ASSIGNED,
          },
        });

        await tx.activityLog.create({
          data: {
            category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
            actor_role: Role.ADMIN,
            message: `Inspection scheduled for ${property.name} on ${new Date(dto.nextInspectionDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`,
          },
        });
      }

      await tx.activityLog.create({
        data: {
          category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
          actor_role: Role.ADMIN,
          message: `${property.name} property dashboard created`,
        },
      });

      return { property, dashboard, scheduled };
    });

    // ── Notify PM if assigned ─────────────────────────────────────────────
    if (pmUser) {
      await this.notifications.dashboardAssigned({
        propertyManagerId: pmUser.id,
        assignedById: adminId,
        propertyId: result.property.id,
        propertyName: result.property.name,
        dashboardId: result.dashboard.id,
      });
    }

    // ── Notify assignee of scheduled inspection ───────────────────────────
    if (assignee && result.scheduled) {
      await this.notifications.newInspectionAssigned({
        operationalUserId: assignee.id,
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

  // ─── 2. LIST PROPERTIES ───────────────────────────────────────────────────

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

    const where: any = {
      ...(status ? { status } : { status: { not: 'ARCHIVED' } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...((dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
    };

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

    const mapProperties = (properties: any[]) =>
      properties.map((p) => ({
        ...p,
        dashboard: p.dashboard
          ? {
              ...p.dashboard,
              latestInspection: p.dashboard.inspections[0] ?? null,
              inspections: undefined,
            }
          : null,
      }));

    if (
      requestingUserRole === Role.ADMIN ||
      requestingUserRole === Role.PROPERTY_MANAGER
    ) {
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
        data: mapProperties(properties),
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

  // ─── 3. GET SINGLE DASHBOARD — role-aware ─────────────────────────────────

  async findOne(dashboardId: string, userId: string, userRole: string) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    // Authorized Viewers must have explicit access
    if (userRole === Role.AUTHORIZED_VIEWER) {
      const access = await this.prisma.propertyAccess.findFirst({
        where: { propertyId, userId, revokedAt: null },
      });
      if (!access)
        throw new ForbiddenException(
          `You do not have access to this dashboard.`,
        );
    }

    return this.findOneByDashboard(dashboardId);
  }

  // ─── 3b. GET BY DASHBOARD ID (internal — used by findOne + other modules) ─

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
        folders: {
          include: {
            items: { select: { inspectionId: true } },
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

  // ─── 4. UPDATE PROPERTY DETAILS ───────────────────────────────────────────

  async updateProperty(
    dashboardId: string,
    dto: UpdatePropertyDto,
    adminId: string,
  ) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

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

    const accesses = await this.prisma.propertyAccess.findMany({
      where: { propertyId, revokedAt: null },
      select: { userId: true },
    });

    if (accesses.length) {
      await this.notifications.dashboardUpdated({
        userIds: accesses.map((a) => a.userId),
        updatedById: adminId,
        propertyId,
        propertyName: updated.name,
        dashboardId,
        changeNote: 'Property details have been updated',
      });
    }

    return {
      success: true,
      message: 'Property updated successfully',
      data: updated,
    };
  }

  // ─── 5. SCHEDULE AN INSPECTION ────────────────────────────────────────────

  async scheduleInspection(
    dashboardId: string,
    dto: ScheduleInspectionDto,
    adminId: string,
  ) {
    const { propertyId, property } =
      await this._assertDashboardExists(dashboardId);

    // ── Validate assignee is OPERATIONAL role ──────────────────────────────
    const assignee = await this.prisma.user.findFirst({
      where: { id: dto.assignedTo, role: Role.OPERATIONAL, isDeleted: false },
    });
    if (!assignee)
      throw new NotFoundException('Operational team member not found.');

    if (new Date(dto.scheduledAt) <= new Date())
      throw new BadRequestException('scheduledAt must be a future date/time.');

    // ── Create scheduled inspection ────────────────────────────────────────
    const scheduled = await this.prisma.scheduledInspection.create({
      data: {
        dashboardId,
        assignedTo: dto.assignedTo,
        scheduledAt: new Date(dto.scheduledAt),
        createdBy: adminId,
        status: ScheduledInspectionStatus.ASSIGNED,
      },
    });

    // ── Also update property.nextInspectionDate for the card display ───────
    await this.prisma.property.update({
      where: { id: propertyId },
      data: { nextInspectionDate: new Date(dto.scheduledAt) },
    });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: Role.ADMIN,
        message: `Inspection scheduled for ${property.name} on ${new Date(dto.scheduledAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      },
    });

    await this.notifications.newInspectionAssigned({
      operationalUserId: assignee.id,
      assignedById: adminId,
      propertyId,
      propertyName: property.name,
      dashboardId,
    });

    return {
      success: true,
      message: 'Inspection scheduled successfully',
      data: scheduled,
    };
  }

  // ─── 6. ASSIGN USER ───────────────────────────────────────────────────────

  async assignPropertyUser(
    dashboardId: string,
    dto: AssignPropertyUserDto,
    adminId: string,
  ) {
    const { propertyId, property } =
      await this._assertDashboardExists(dashboardId);

    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, isDeleted: false },
    });
    if (!user) throw new NotFoundException('User not found.');

    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date())
      throw new BadRequestException('expiresAt must be a future date.');

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

      await this.notifications.dashboardAssigned({
        propertyManagerId: user.id,
        assignedById: adminId,
        propertyId,
        propertyName: updated.name,
        dashboardId,
      });

      return {
        success: true,
        message: 'Property Manager assigned successfully',
        data: updated,
      };
    }

    // ── Other roles (AV, Operational etc.) ────────────────────────────────
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

    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { name: true },
    });

    await this.notifications.dashboardShared({
      userId: user.id,
      sharedById: adminId,
      sharerName: admin?.name ?? 'Admin',
      propertyId,
      propertyName: property.name,
      dashboardId,
    });

    return {
      success: true,
      message: dto.expiresAt
        ? `Access granted — expires ${new Date(dto.expiresAt).toDateString()}`
        : 'User access granted successfully',
      data: access,
    };
  }

  // ─── 7. GET ACCESS LIST ───────────────────────────────────────────────────

  async getPropertyAccess(dashboardId: string) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

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

  // ─── 8. SET ACCESS EXPIRATION ─────────────────────────────────────────────

  async setAccessExpiration(
    dashboardId: string,
    dto: SetAccessExpirationDto,
    adminId: string,
  ) {
    await this._assertDashboardExists(dashboardId);

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
}
