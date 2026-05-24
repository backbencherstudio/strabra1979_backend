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
  AccessRequestStatus,
  ActivityCategory,
  ScheduledInspectionStatus,
} from 'prisma/generated/enums';
import { NotificationService } from '../notification/notification.service';
import appConfig from 'src/config/app.config';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class PropertyDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly mailService: MailService,
  ) {}

  // ═════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═════════════════════════════════════════════════════════════════════════

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

  private async _assertPropertyAccess(
    propertyId: string,
    userId: string,
    role: string,
  ) {
    // ADMIN → always allowed
    if (role === Role.ADMIN) return;

    // Step 1 — Get property owner (PM)
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { propertyManagerId: true },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    // Step 2 — PROPERTY_MANAGER owns this property
    if (role === Role.PROPERTY_MANAGER) {
      if (property.propertyManagerId !== userId) {
        throw new ForbiddenException('This property does not belong to you.');
      }
      return; // ✅ no PropertyAccess check needed
    }

    // Step 3 — AUTHORIZED_VIEWER must have access entry
    if (role === Role.AUTHORIZED_VIEWER) {
      const now = new Date();

      const access = await this.prisma.propertyAccess.findFirst({
        where: {
          propertyId,
          userId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });

      if (!access) {
        throw new ForbiddenException(
          'You do not have access to this property dashboard. Contact your admin.',
        );
      }

      return;
    }

    throw new ForbiddenException('Invalid role for this action.');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 1. CREATE PROPERTY + DASHBOARD
  // ═════════════════════════════════════════════════════════════════════════

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

      // ── Grant PropertyAccess to PM ─────────────────────────────────────
      if (pmUser) {
        await tx.propertyAccess.create({
          data: {
            propertyId: property.id,
            userId: pmUser.id,
            grantedBy: adminId,
            grantedAt: new Date(),
          },
        });
      }

      // ── Grant PropertyAccess to assignee ──────────────────────────────
      if (assignee) {
        await tx.propertyAccess.create({
          data: {
            propertyId: property.id,
            userId: assignee.id,
            grantedBy: adminId,
            grantedAt: new Date(),
          },
        });
      }

      // ── Schedule inspection ────────────────────────────────────────────
      let scheduled = null;
      if (dto.nextInspectionDate && assignee) {
        scheduled = await tx.scheduledInspection.create({
          data: {
            dashboardId: dashboard.id,
            assignedTo: assignee.id,
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

    if (pmUser) {
      await this.notifications.dashboardAssigned({
        propertyManagerId: pmUser.id,
        assignedById: adminId,
        propertyId: result.property.id,
        propertyName: result.property.name,
        dashboardId: result.dashboard.id,
        inspectionId: result.scheduled?.inspectionId,
      });
    }

    if (assignee && result.scheduled) {
      await this.notifications.newInspectionAssigned({
        operationalUserId: assignee.id,
        assignedById: adminId,
        propertyId: result.property.id,
        propertyName: result.property.name,
        dashboardId: result.dashboard.id,
        inspectionId: result.scheduled?.inspectionId,
      });
    }

    return {
      success: true,
      message: 'Property and dashboard created successfully',
      data: result,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. LIST PROPERTIES
  // ═════════════════════════════════════════════════════════════════════════

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
      view?: string;
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
      view = 'all',
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

    const orderBy = { [sortBy]: sortOrder };

    const dashboardSelect = {
      select: {
        id: true,
        updatedAt: true,
        propertyId: true,
        inspections: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: { id: true, overallScore: true, healthLabel: true },
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

    // ── ADMIN ─────────────────────────────────────────────────────────────
    if (requestingUserRole === Role.ADMIN) {
      const [properties, total] = await this.prisma.$transaction([
        this.prisma.property.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            propertyManager: {
              select: { id: true, username: true, email: true, avatar: true },
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

    // ── PROPERTY MANAGER ──────────────────────────────────────────────────
    if (requestingUserRole === Role.PROPERTY_MANAGER) {
      where.propertyManagerId = requestingUserId;

      const [properties, total] = await this.prisma.$transaction([
        this.prisma.property.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            propertyManager: {
              select: { id: true, username: true, email: true, avatar: true },
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

    // ── AUTHORIZED VIEWER ─────────────────────────────────────────────────
    if (requestingUserRole === Role.AUTHORIZED_VIEWER) {
      // Tab 1 — "My Properties": only properties this viewer has active access to
      if (view === 'assigned') {
        where.accesses = {
          some: {
            userId: requestingUserId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        };
      }
      // Tab 2 — "All Properties": no extra where filter, but each row gets viewerAccess shape

      const [properties, total] = await this.prisma.$transaction([
        this.prisma.property.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            propertyManager: {
              select: { id: true, username: true, email: true, avatar: true },
            },
            dashboard: dashboardSelect,
            accesses: {
              where: { userId: requestingUserId },
              select: {
                id: true,
                grantedAt: true,
                expiresAt: true,
                revokedAt: true,
              },
            },
            accessRequests: {
              where: { requesterId: requestingUserId },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, status: true, createdAt: true },
            },
          },
        }),
        this.prisma.property.count({ where }),
      ]);

      const total_pages = Math.ceil(total / limit);

      const data = properties.map((p) => {
        const access = p.accesses?.[0] ?? null;
        const request = p.accessRequests?.[0] ?? null;

        const isGranted =
          access &&
          !access.revokedAt &&
          (!access.expiresAt || access.expiresAt > new Date());

        return {
          ...mapProperties([p])[0],
          accesses: undefined,
          accessRequests: undefined,
          viewerAccess: {
            hasAccess: !!isGranted,
            accessId: access?.id ?? null,
            expiresAt: access?.expiresAt ?? null,
            pendingRequest:
              request?.status === AccessRequestStatus.PENDING ? request : null,
            lastRequest: request ?? null,
          },
        };
      });

      return {
        success: true,
        message: 'Properties retrieved successfully',
        data,
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

    // ── Fallback (should never reach here if guards are correct) ──────────
    return {
      success: true,
      data: [],
      meta: { total: 0, page, limit, total_pages: 0 },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. GET SINGLE DASHBOARD
  // ═════════════════════════════════════════════════════════════════════════

  async findOne(dashboardId: string, userId: string, userRole: string) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    // ── Access check for all non-admin roles ──────────────────────────────
    await this._assertPropertyAccess(propertyId, userId, userRole);

    return this.findOneByDashboard(dashboardId, userId);
  }

  async findOneByDashboard(dashboardId: string, userId: string) {
    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { id: dashboardId },
      include: {
        property: {
          include: {
            propertyManager: {
              select: { id: true, username: true, email: true, avatar: true },
            },
            accesses: {
              where: { userId },
              select: { expiresAt: true },
              take: 1,
            },
            activeTemplate: true,
          },
        },
        // FIX: Only get COMPLETED inspections for public view
        inspections: {
          where: {
            status: 'COMPLETE', // ← Add this filter
          },
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

    const accessExpiresAt = dashboard.property.accesses[0]?.expiresAt ?? null;

    // Also check if the user is the assigned inspector for any scheduled inspection
    // If they are, they should see their draft separately
    let draftInspection = null;

    const userRole = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (userRole?.role === 'OPERATIONAL') {
      // Check if this user has an active scheduled inspection for this dashboard
      const scheduled = await this.prisma.scheduledInspection.findFirst({
        where: {
          dashboardId,
          assignedTo: userId,
          status: { in: ['ASSIGNED', 'IN_PROGRESS', 'DUE'] },
        },
        select: { id: true },
      });

      if (scheduled) {
        draftInspection = await this.prisma.inspection.findFirst({
          where: {
            scheduledInspectionId: scheduled.id,
            inspectorId: userId,
            status: 'DRAFT',
          },
          include: { mediaFiles: true },
        });
      }
    }

    return {
      success: true,
      message: 'Dashboard retrieved successfully',
      data: {
        ...dashboard,
        property: {
          accessExpiresAt,
          ...dashboard.property,
          accesses: undefined,
        },
        // Return draft separately if it exists (for assigned inspector only)
        draftInspection: draftInspection
          ? {
              ...draftInspection,
              mediaFiles: draftInspection.mediaFiles.map((file) => ({
                ...file,
                url:
                  file.fileType === 'EMBED'
                    ? file.url
                    : this._resolveUrl(file.url),
              })),
            }
          : null,
        // Only return completed inspections here
        inspections: dashboard.inspections.map((inspection) => ({
          ...inspection,
          mediaFiles: inspection.mediaFiles.map((file) => ({
            ...file,
            url:
              file.fileType === 'EMBED' ? file.url : this._resolveUrl(file.url),
          })),
        })),
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 4. UPDATE PROPERTY DETAILS
  // ═════════════════════════════════════════════════════════════════════════

  async updateProperty(
    dashboardId: string,
    dto: UpdatePropertyDto,
    adminId: string,
  ) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    // ── Access check (Admin only route but guard it anyway) ───────────────
    await this._assertPropertyAccess(propertyId, adminId, Role.ADMIN);

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

  // ═════════════════════════════════════════════════════════════════════════
  // 5. SCHEDULE AN INSPECTION
  // ═════════════════════════════════════════════════════════════════════════

  async scheduleInspection(
    dashboardId: string,
    dto: ScheduleInspectionDto,
    requesterId: string,
    requesterRole: string,
  ) {
    const { propertyId, property } =
      await this._assertDashboardExists(dashboardId);

    await this._assertPropertyAccess(propertyId, requesterId, requesterRole);

    const assignee = await this.prisma.user.findFirst({
      where: { id: dto.assignedTo, role: Role.OPERATIONAL, isDeleted: false },
    });
    if (!assignee)
      throw new NotFoundException('Operational team member not found.');

    if (new Date(dto.scheduledAt) <= new Date())
      throw new BadRequestException('scheduledAt must be a future date/time.');

    const scheduled = await this.prisma.scheduledInspection.create({
      data: {
        dashboardId,
        assignedTo: dto.assignedTo,
        scheduledAt: new Date(dto.scheduledAt),
        createdBy: requesterId,
        status: ScheduledInspectionStatus.ASSIGNED,
      },
    });

    await this.prisma.propertyAccess.upsert({
      where: { propertyId_userId: { propertyId, userId: assignee.id } },
      create: {
        propertyId,
        userId: assignee.id,
        grantedBy: requesterId,
        grantedAt: new Date(),
      },
      update: {
        revokedAt: null,
        revokedBy: null,
      },
    });

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
      assignedById: requesterId,
      propertyId,
      propertyName: property.name,
      dashboardId,
      inspectionId: scheduled.inspectionId,
    });

    // ── Email notification ────────────────────────────────────────────────
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { username: true },
    });

    const formattedDate = new Date(dto.scheduledAt).toLocaleDateString(
      'en-US',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      },
    );

    const emailPayload = {
      assignedBy: requester?.username ?? 'Admin',
      propertyName: property.name,
      propertyAddress: property.address,
      scheduledAt: formattedDate,
      dashboardUrl: appConfig().app.client_app_url,
      platformName: appConfig().app.name ?? 'Platform',
    };

    // Email to assignee (operational)
    await this.mailService.sendInspectionAssigned({
      email: assignee.email,
      username: assignee.username ?? assignee.email,
      ...emailPayload,
    });

    // Email to property manager if assigned
    if (property.propertyManagerId) {
      const pm = await this.prisma.user.findUnique({
        where: { id: property.propertyManagerId },
        select: { email: true, username: true },
      });

      if (pm?.email) {
        await this.mailService.sendInspectionAssigned({
          email: pm.email,
          username: pm.username ?? pm.email,
          ...emailPayload,
        });
      }
    }

    return {
      success: true,
      message: 'Inspection scheduled successfully',
      data: scheduled,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 6. ASSIGN USER
  // ═════════════════════════════════════════════════════════════════════════

  async assignPropertyUser(
    dashboardId: string,
    dto: AssignPropertyUserDto,
    adminId: string,
  ) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, isDeleted: false },
    });
    if (!user) throw new NotFoundException('User not found.');

    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date())
      throw new BadRequestException('expiresAt must be a future date.');

    if (user.role === Role.PROPERTY_MANAGER) {
      const platformName = appConfig().app.name ?? 'Platform';
      const clientUrl = appConfig().app.client_app_url;

      // ── Fetch current property to get previous PM ────────────────────
      const currentProperty = await this.prisma.property.findUnique({
        where: { id: propertyId },
        select: {
          propertyManagerId: true,
          name: true,
          address: true,
        },
      });

      const previousPmId = currentProperty?.propertyManagerId;

      // ── Remove previous PM's access if different from new one ────────
      if (previousPmId && previousPmId !== dto.userId) {
        const previousPm = await this.prisma.user.findUnique({
          where: { id: previousPmId },
          select: { email: true, username: true },
        });

        // Revoke PropertyAccess
        await this.prisma.propertyAccess.updateMany({
          where: { propertyId, userId: previousPmId },
          data: {
            revokedAt: new Date(),
            revokedBy: adminId,
          },
        });

        // Clear propertyManagerId on property
        await this.prisma.property.update({
          where: { id: propertyId },
          data: { propertyManagerId: null },
        });

        // Notify previous PM by email
        if (previousPm?.email) {
          await this.mailService.sendDashboardUnassigned({
            email: previousPm.email,
            username: previousPm.username ?? previousPm.email,
            propertyName: currentProperty.name,
            propertyAddress: currentProperty.address,
            platformName,
          });
        }

        await this.prisma.activityLog.create({
          data: {
            category: ActivityCategory.USER_ACCESS,
            actor_role: Role.PROPERTY_MANAGER,
            message: `${previousPm?.username ?? previousPmId} was removed as property manager of ${currentProperty.name}`,
          },
        });
      }

      // ── Assign new PM ────────────────────────────────────────────────
      const updated = await this.prisma.property.update({
        where: { id: propertyId },
        data: { propertyManagerId: dto.userId },
      });

      await this.prisma.propertyAccess.upsert({
        where: { propertyId_userId: { propertyId, userId: dto.userId } },
        create: {
          propertyId,
          userId: dto.userId,
          grantedBy: adminId,
          grantedAt: new Date(),
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
        update: {
          revokedAt: null,
          revokedBy: null,
          grantedBy: adminId,
          grantedAt: new Date(),
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });

      const admin = await this.prisma.user.findUnique({
        where: { id: adminId },
        select: { username: true },
      });

      // ── Email new PM ─────────────────────────────────────────────────
      await this.mailService.sendDashboardAssigned({
        email: user.email,
        username: user.username ?? user.email,
        assignedBy: admin?.username ?? 'Admin',
        propertyName: updated.name,
        propertyAddress: currentProperty.address,
        dashboardUrl: `${clientUrl}`,
        platformName,
      });

      await this.prisma.activityLog.create({
        data: {
          category: ActivityCategory.USER_ACCESS,
          actor_role: Role.PROPERTY_MANAGER,
          message: `${user.username} was assigned to ${updated.name} dashboard`,
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
  }
  // ═════════════════════════════════════════════════════════════════════════
  // 7. GET ACCESS LIST
  // ═════════════════════════════════════════════════════════════════════════

  async getPropertyAccess(
    dashboardId: string,
    requesterId: string,
    requesterRole: string,
    page: number = 1,
    limit: number = 10,
    search?: string,
  ) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    // ── Access check ──────────────────────────────────────────────────────
    await this._assertPropertyAccess(propertyId, requesterId, requesterRole);

    const skip = (page - 1) * limit;

    // Build where clause for accesses
    const whereCondition: any = {
      propertyId,
      revokedAt: null,
    };

    // Add search filter if provided
    if (search) {
      whereCondition.user = {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    // Fetch property info and paginated accesses in parallel
    const [property, accesses, totalAccesses] = await Promise.all([
      this.prisma.property.findUnique({
        where: { id: propertyId },
        select: {
          id: true,
          name: true,
          propertyManager: {
            select: {
              id: true,
              username: true,
              email: true,
              avatar: true,
              role: true,
              access_expires_at: true,
            },
          },
        },
      }),
      this.prisma.propertyAccess.findMany({
        where: whereCondition,
        skip,
        take: limit,
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
      this.prisma.propertyAccess.count({ where: whereCondition }),
    ]);

    const totalPages = Math.ceil(totalAccesses / limit);

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
      meta: {
        total: totalAccesses,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 8. SET ACCESS EXPIRATION
  // ═════════════════════════════════════════════════════════════════════════

  async setAccessExpiration(
    dashboardId: string,
    dto: SetAccessExpirationDto,
    adminId: string,
  ) {
    const { propertyId } = await this._assertDashboardExists(dashboardId);

    // ── Access check (Admin only but guard it anyway) ─────────────────────
    await this._assertPropertyAccess(propertyId, adminId, Role.ADMIN);

    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, isDeleted: false },
    });
    if (!user) throw new NotFoundException('User not found.');

    // ── Update PropertyAccess row expiry (not User.access_expires_at) ─────
    const updated = await this.prisma.propertyAccess.update({
      where: { propertyId_userId: { propertyId, userId: dto.userId } },
      data: { expiresAt: new Date(dto.accessExpiresAt) },
    });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.USER_ACCESS,
        actor_role: Role.ADMIN,
        message: `${user.username} access expiration set to ${new Date(dto.accessExpiresAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      },
    });

    return {
      success: true,
      message: 'Access expiration updated.',
      data: updated,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 9. DELETE PROPERTY DASHBOARD
  // ═════════════════════════════════════════════════════════════════════════

  async deletePropertyDashboard(dashboardId: string, adminId: string) {
    // 1. Verify dashboard exists and fetch property details
    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { id: dashboardId },
      include: { property: true },
    });

    if (!dashboard) {
      throw new NotFoundException(`Dashboard "${dashboardId}" not found.`);
    }

    const propertyId = dashboard.propertyId;
    const propertyName = dashboard.property.name;

    // 2. Execute deletion in a transaction
    await this.prisma.$transaction(async (tx) => {
      // 2.1 Delete ScheduledInspections linked to this dashboard
      await tx.scheduledInspection.deleteMany({
        where: { dashboardId },
      });

      // 2.2 Delete InspectionFolderItems and Folders
      await tx.inspectionFolderItem.deleteMany({
        where: { folder: { dashboardId } },
      });
      await tx.inspectionFolder.deleteMany({
        where: { dashboardId },
      });

      // 2.3 Delete MediaFiles belonging to Inspections of this dashboard
      const inspections = await tx.inspection.findMany({
        where: { dashboardId },
        select: { id: true },
      });
      const inspectionIds = inspections.map((i) => i.id);
      if (inspectionIds.length) {
        await tx.mediaFile.deleteMany({
          where: { inspectionId: { in: inspectionIds } },
        });
      }

      // 2.4 Delete Inspections
      await tx.inspection.deleteMany({
        where: { dashboardId },
      });

      // 2.5 Delete PropertyDashboard
      await tx.propertyDashboard.delete({
        where: { id: dashboardId },
      });

      // 2.6 Delete dependent records linked to Property (not cascaded automatically)
      await tx.propertyAccess.deleteMany({
        where: { propertyId },
      });
      await tx.propertyAccessRequest.deleteMany({
        where: { propertyId },
      });
      await tx.pendingInvitation.deleteMany({
        where: { propertyId },
      });

      // 2.7 Finally delete the Property itself
      await tx.property.delete({
        where: { id: propertyId },
      });
    });

    // 3. Log activity
    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: Role.ADMIN,
        message: `Property "${propertyName}" and its dashboard were permanently deleted by ${adminId}`,
      },
    });

    return {
      success: true,
      message: 'Property dashboard and all related data deleted successfully.',
      data: {
        propertyId,
        propertyName,
        dashboardId,
      },
    };
  }

  private _resolveUrl(key: string): string {
    const isDevelopment = appConfig().app.node_env === 'development';

    if (isDevelopment) {
      // Development: use local MinIO IP
      const minioEndpoint =
        appConfig().fileSystems.s3.endpoint || 'http://192.168.7.68:9005';
      const bucket = appConfig().fileSystems.s3.bucket || 'uploads';
      return `${minioEndpoint}/${bucket}/${key}`;
    } else {
      // Production: use public domain with HTTPS
      const publicEndpoint =
        appConfig().fileSystems.s3.publicEndpoint ||
        'https://backend.roofwellnesshub.com';
      const bucket = appConfig().fileSystems.s3.bucket || 'uploads';
      return `${publicEndpoint}/${bucket}/${key}`;
    }
  }
}
