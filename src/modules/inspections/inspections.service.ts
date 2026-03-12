import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SubmitInspectionDto } from './dto/inspection.dto';
import {
  ActivityCategory,
  ScheduledInspectionStatus,
} from 'prisma/generated/enums';
import { NotificationService } from '../notification/notification.service';

interface ScoringCategory {
  key: string;
  label: string;
  maxPoints: number;
}
interface HeaderField {
  key: string;
  label: string;
  required: boolean;
}
interface MediaFieldSlot {
  key: string;
  type: string;
}
interface HealthTier {
  minScore: number;
  maxScore: number;
  remainingLifeMinYears: number;
  remainingLifeMaxYears: number;
}
interface HealthThreshold {
  good: HealthTier;
  fair: HealthTier;
  poor: HealthTier;
}
interface RepairConfig {
  statuses: string[];
}

@Injectable()
export class InspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ═════════════════════════════════════════════════════════════════════════
  // INSPECTION FORM
  // ═════════════════════════════════════════════════════════════════════════

  async getInspectionForm(dashboardId: string, userId: string, role: string) {
    const { dashboard, criteria } =
      await this._getCriteriaForDashboard(dashboardId);

    // ── Access check ──────────────────────────────────────────────────────
    await this._assertPropertyAccess(dashboard.property.id, userId, role);

    return {
      success: true,
      message: 'Inspection form loaded successfully',
      data: {
        dashboardId,
        criteriaId: criteria.id,
        form: {
          headerFields: criteria.headerFields,
          scoringCategories: criteria.scoringCategories,
          mediaFields: criteria.mediaFields,
          repairPlanningConfig: criteria.repairPlanningConfig,
          nteConfig: criteria.nteConfig,
          additionalNotesConfig: criteria.additionalNotesConfig,
          healthThresholdConfig: criteria.healthThresholdConfig,
        },
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SUBMIT INSPECTION
  // ═════════════════════════════════════════════════════════════════════════

  async submitInspection(
    dashboardId: string,
    scheduledInspectionId: string,
    inspectorId: string,
    inspectorRole: string,
    dto: SubmitInspectionDto,
    files: Express.Multer.File[],
  ) {
    const { dashboard, criteria } =
      await this._getCriteriaForDashboard(dashboardId);

    // ── Access check ──────────────────────────────────────────────────────
    await this._assertPropertyAccess(
      dashboard.property.id,
      inspectorId,
      inspectorRole,
    );

    // ── Validate scheduled inspection ─────────────────────────────────────
    const activeSchedule = await this.prisma.scheduledInspection.findUnique({
      where: { id: scheduledInspectionId },
    });

    if (!activeSchedule)
      throw new NotFoundException(
        `Scheduled inspection "${scheduledInspectionId}" not found.`,
      );
    if (activeSchedule.dashboardId !== dashboardId)
      throw new BadRequestException(
        'This scheduled inspection does not belong to the given dashboard.',
      );
    if (activeSchedule.assignedTo !== inspectorId)
      throw new ForbiddenException(
        'This scheduled inspection is not assigned to you.',
      );
    if (activeSchedule.status === ScheduledInspectionStatus.COMPLETE)
      throw new BadRequestException(
        'This scheduled inspection has already been completed.',
      );
    if (activeSchedule.status === ScheduledInspectionStatus.ASSIGNED)
      throw new BadRequestException(
        'You must start the inspection before submitting. Call the /start endpoint first.',
      );
    if (activeSchedule.status === ScheduledInspectionStatus.DUE)
      throw new BadRequestException(
        'This scheduled inspection is overdue. Contact your admin to reschedule.',
      );
    if (activeSchedule.status !== ScheduledInspectionStatus.IN_PROGRESS)
      throw new BadRequestException(
        'Scheduled inspection is not in a valid state for submission.',
      );

    const headerFields = criteria.headerFields as unknown as HeaderField[];
    const categories =
      criteria.scoringCategories as unknown as ScoringCategory[];
    const mediaSlots = criteria.mediaFields as unknown as MediaFieldSlot[];
    const repairConfig =
      criteria.repairPlanningConfig as unknown as RepairConfig;
    const thresholds =
      criteria.healthThresholdConfig as unknown as HealthThreshold;

    // ── Validations ───────────────────────────────────────────────────────
    for (const field of headerFields) {
      if (field.required && !dto.headerData?.[field.key])
        throw new BadRequestException(
          `Required header field "${field.label}" is missing.`,
        );
    }
    for (const category of categories) {
      const submitted = dto.scores?.[category.key];
      if (submitted !== undefined && submitted.score > category.maxPoints)
        throw new BadRequestException(
          `Score for "${category.label}" is ${submitted.score} — max allowed is ${category.maxPoints}.`,
        );
    }
    const { statuses } = repairConfig;
    for (const item of dto.repairItems ?? []) {
      if (!statuses.includes(item.status))
        throw new BadRequestException(
          `Repair status "${item.status}" is invalid. Allowed: ${statuses.join(', ')}.`,
        );
    }
    const validSlotKeys = mediaSlots.map((s) => s.key);
    for (const key of dto.mediaFieldKeys ?? []) {
      if (!validSlotKeys.includes(key))
        throw new BadRequestException(
          `mediaFieldKey "${key}" does not exist in criteria.mediaFields.`,
        );
    }
    if (
      dto.mediaFieldKeys &&
      dto.mediaFieldKeys.length !== (files ?? []).length
    )
      throw new BadRequestException(
        `mediaFieldKeys length (${dto.mediaFieldKeys.length}) must match files length (${(files ?? []).length}).`,
      );

    // ── Compute score + health ─────────────────────────────────────────────
    const overallScore = categories.reduce(
      (sum, cat) => sum + (dto.scores?.[cat.key]?.score ?? 0),
      0,
    );

    let healthLabel = 'Poor';
    let remainingLife = `${thresholds.poor.remainingLifeMinYears}-${thresholds.poor.remainingLifeMaxYears} Years`;

    if (overallScore >= thresholds.good.minScore) {
      healthLabel = 'Good';
      remainingLife = `${thresholds.good.remainingLifeMinYears}-${thresholds.good.remainingLifeMaxYears} Years`;
    } else if (overallScore >= thresholds.fair.minScore) {
      healthLabel = 'Fair';
      remainingLife = `${thresholds.fair.remainingLifeMinYears}-${thresholds.fair.remainingLifeMaxYears} Years`;
    }

    const repairItems = (dto.repairItems ?? []).map((item, i) => ({
      id: `repair_${Date.now()}_${i}`,
      title: item.title,
      status: item.status,
      description: item.description ?? '',
    }));

    // ── Create inspection row ──────────────────────────────────────────────
    const inspection = await this.prisma.inspection.create({
      data: {
        dashboardId,
        inspectorId,
        headerData: dto.headerData as any,
        scores: (dto.scores ?? {}) as any,
        repairItems: repairItems as any,
        nteValue: dto.nteValue ?? null,
        additionalComments: dto.additionalComments ?? null,
        overallScore,
        healthLabel,
        remainingLife,
        inspectedAt: dto.inspectedAt ? new Date(dto.inspectedAt) : new Date(),
      },
    });

    // ── Handle embed fields (tour3d etc.) ──────────────────────────────────
    const savedMediaFiles = [];

    for (const [mediaFieldKey, embedUrl] of Object.entries(
      dto.embedFields ?? {},
    )) {
      const slot = mediaSlots.find((s) => s.key === mediaFieldKey);
      if (!slot || slot.type !== 'embed') continue;

      const url = String(embedUrl); // ← cast to string to fix TS2322

      const mediaFile = await this.prisma.mediaFile.create({
        data: {
          inspectionId: inspection.id,
          fileName: mediaFieldKey,
          fileType: 'EMBED',
          url,
          size: null,
          mediaFieldKey,
          uploadedAt: new Date(),
        },
      });
      savedMediaFiles.push(mediaFile);
    }

    // ── Handle file uploads ────────────────────────────────────────────────
    for (let i = 0; i < (files ?? []).length; i++) {
      const file = files[i];
      const mediaFieldKey = dto.mediaFieldKeys?.[i] ?? 'mediaFiles';
      const url = `https://your-storage.example.com/inspections/${inspection.id}/${Date.now()}_${file.originalname}`;

      const mediaFile = await this.prisma.mediaFile.create({
        data: {
          inspectionId: inspection.id,
          fileName: file.originalname,
          fileType: this._resolveFileType(file.mimetype),
          url,
          size: file.size,
          mediaFieldKey,
          uploadedAt: new Date(),
        },
      });
      savedMediaFiles.push(mediaFile);
    }

    const propertyName = dashboard.property?.name ?? 'Unknown Property';
    const inspector = await this.prisma.user.findUnique({
      where: { id: inspectorId },
      select: { name: true, role: true },
    });

    // ── Mark schedule COMPLETE ─────────────────────────────────────────────
    await this.prisma.scheduledInspection.update({
      where: { id: activeSchedule.id },
      data: {
        status: ScheduledInspectionStatus.COMPLETE,
        inspectionId: inspection.id,
      },
    });

    // ── Activity log ───────────────────────────────────────────────────────
    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: inspector?.role ?? null,
        message: `${inspector?.name ?? 'Inspector'} submitted an inspection report for ${propertyName}`,
      },
    });

    // ── Notify admins ──────────────────────────────────────────────────────
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE', isDeleted: false },
      select: { id: true },
    });
    await this.notifications.inspectionReportUpdate({
      adminIds: admins.map((a) => a.id),
      inspectorId,
      inspectorName: inspector?.name ?? 'Inspector',
      propertyId: dashboard.property?.id ?? dashboardId,
      propertyName,
      inspectionId: inspection.id,
    });

    // ── Notify dashboard access holders ───────────────────────────────────
    const accesses = await this.prisma.propertyAccess.findMany({
      where: {
        propertyId: dashboard.property?.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { userId: true },
    });
    if (accesses.length) {
      await this.notifications.dashboardUpdated({
        userIds: accesses.map((a) => a.userId),
        updatedById: inspectorId,
        propertyId: dashboard.property?.id ?? dashboardId,
        propertyName,
        dashboardId,
        changeNote: 'New inspection report has been submitted',
      });
    }

    return {
      success: true,
      message: 'Inspection submitted successfully',
      data: {
        ...inspection,
        mediaFiles: savedMediaFiles,
        summary: { overallScore, healthLabel, remainingLife },
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // INSPECTION QUERIES
  // ═════════════════════════════════════════════════════════════════════════

  async findOne(inspectionId: string, userId: string, role: string) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        inspector: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        mediaFiles: true,
        dashboard: { include: { property: { select: { id: true } } } },
      },
    });
    if (!inspection) throw new NotFoundException('Inspection not found.');

    // ── Access check ──────────────────────────────────────────────────────
    await this._assertPropertyAccess(
      inspection.dashboard.property.id,
      userId,
      role,
    );

    return { success: true, message: 'Inspection retrieved', data: inspection };
  }

  async findAllForDashboard(dashboardId: string, userId: string, role: string) {
    const dashboard = await this._assertDashboardExists(dashboardId);

    // ── Access check ──────────────────────────────────────────────────────
    await this._assertPropertyAccess(dashboard.propertyId, userId, role);

    const scheduled = await this.prisma.scheduledInspection.findMany({
      where: { dashboardId },
      orderBy: { scheduledAt: 'desc' },
      include: {
        assignee: {
          select: { id: true, name: true, avatar: true, email: true },
        },
        dashboard: {
          include: {
            property: { select: { name: true, address: true } },
          },
        },
      },
    });

    return {
      success: true,
      message: 'Scheduled inspections retrieved',
      data: scheduled.map((s) => ({
        id: s.id,
        propertyName: s.dashboard.property.name,
        inspectionId: s.inspectionId ?? null,
        address: s.dashboard.property.address,
        date: s.scheduledAt,
        status: s.status,
        dashboardId: s.dashboardId,
        createdAt: s.createdAt,
      })),
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SCHEDULED INSPECTIONS
  // ═════════════════════════════════════════════════════════════════════════

  private async _markOverdue(userId?: string) {
    await this.prisma.scheduledInspection.updateMany({
      where: {
        status: ScheduledInspectionStatus.ASSIGNED,
        scheduledAt: { lt: new Date() },
        ...(userId && { assignedTo: userId }),
      },
      data: { status: ScheduledInspectionStatus.DUE },
    });
  }

  async getAssignedInspections(
    userId: string,
    role: string,
    filters: { status?: string; page: number; limit: number },
  ) {
    const { status, page, limit } = filters;
    const skip = (page - 1) * limit;

    await this._markOverdue(userId);

    const where: any = {
      assignedTo: userId,
      ...(status && { status }),
    };

    const [scheduled, total] = await this.prisma.$transaction([
      this.prisma.scheduledInspection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledAt: 'asc' },
        include: {
          dashboard: {
            include: {
              property: {
                select: { name: true, address: true, propertyType: true },
              },
            },
          },
        },
      }),
      this.prisma.scheduledInspection.count({ where }),
    ]);

    const total_pages = Math.ceil(total / limit);

    return {
      success: true,
      message: 'Assigned inspections retrieved',
      data: scheduled.map((s) => ({
        id: s.id,
        status: s.status,
        scheduledAt: s.scheduledAt,
        dashboardId: s.dashboardId,
        inspectionId: s.inspectionId ?? null,
        propertyName: s.dashboard.property.name,
        address: s.dashboard.property.address,
        propertyType: s.dashboard.property.propertyType,
        createdAt: s.createdAt,
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

  async getAllScheduled(filters: {
    status?: string;
    assignedTo?: string;
    dashboardId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page: number;
    limit: number;
  }) {
    const {
      status,
      assignedTo,
      dashboardId,
      dateFrom,
      dateTo,
      search,
      page,
      limit,
    } = filters;
    const skip = (page - 1) * limit;

    await this._markOverdue();

    const where: any = {
      ...(status && { status }),
      ...(assignedTo && { assignedTo }),
      ...(dashboardId && { dashboardId }),
      ...((dateFrom || dateTo) && {
        scheduledAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
      ...(search && {
        dashboard: {
          property: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { address: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      }),
    };

    const [scheduled, total] = await this.prisma.$transaction([
      this.prisma.scheduledInspection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledAt: 'desc' },
        include: {
          dashboard: {
            include: {
              property: {
                select: { name: true, address: true, propertyType: true },
              },
            },
          },
          assignee: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          creator: { select: { id: true, name: true } },
        },
      }),
      this.prisma.scheduledInspection.count({ where }),
    ]);

    const total_pages = Math.ceil(total / limit);

    return {
      success: true,
      message: 'Scheduled inspections retrieved',
      data: scheduled.map((s) => ({
        id: s.id,
        status: s.status,
        scheduledAt: s.scheduledAt,
        dashboardId: s.dashboardId,
        inspectionId: s.inspectionId ?? null,
        propertyName: s.dashboard.property.name,
        propertyType: s.dashboard.property.propertyType,
        address: s.dashboard.property.address,
        assignee: s.assignee,
        createdBy: s.creator,
        createdAt: s.createdAt,
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

  async getOneScheduled(
    scheduledInspectionId: string,
    userId: string,
    role: string,
  ) {
    const scheduled = await this.prisma.scheduledInspection.findUnique({
      where: { id: scheduledInspectionId },
      include: {
        dashboard: {
          include: {
            property: {
              select: {
                id: true,
                name: true,
                address: true,
                propertyType: true,
              },
            },
          },
        },
        assignee: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        creator: { select: { id: true, name: true } },
      },
    });

    if (!scheduled)
      throw new NotFoundException('Scheduled inspection not found.');

    // ── Access check ──────────────────────────────────────────────────────
    await this._assertPropertyAccess(
      scheduled.dashboard.property.id,
      userId,
      role,
    );

    return {
      success: true,
      message: 'Scheduled inspection retrieved',
      data: {
        id: scheduled.id,
        status: scheduled.status,
        scheduledAt: scheduled.scheduledAt,
        dashboardId: scheduled.dashboardId,
        inspectionId: scheduled.inspectionId ?? null,
        propertyName: scheduled.dashboard.property.name,
        propertyType: scheduled.dashboard.property.propertyType,
        address: scheduled.dashboard.property.address,
        assignee: scheduled.assignee,
        createdBy: scheduled.creator,
        createdAt: scheduled.createdAt,
      },
    };
  }

  async startInspection(
    scheduledInspectionId: string,
    operationalUserId: string,
  ) {
    const scheduled = await this.prisma.scheduledInspection.findUnique({
      where: { id: scheduledInspectionId },
      include: {
        dashboard: {
          include: {
            property: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!scheduled)
      throw new NotFoundException('Scheduled inspection not found.');
    if (scheduled.assignedTo !== operationalUserId)
      throw new ForbiddenException('This inspection is not assigned to you.');

    // ── Access check ──────────────────────────────────────────────────────
    await this._assertPropertyAccess(
      scheduled.dashboard.property.id,
      operationalUserId,
      'OPERATIONAL',
    );

    if (scheduled.status === 'COMPLETE')
      throw new BadRequestException('This inspection is already completed.');
    if (scheduled.status === 'IN_PROGRESS')
      throw new BadRequestException('This inspection is already in progress.');

    await this.prisma.scheduledInspection.update({
      where: { id: scheduledInspectionId },
      data: { status: 'IN_PROGRESS' },
    });

    return {
      success: true,
      message: 'Inspection started',
      data: { scheduledInspectionId, dashboardId: scheduled.dashboardId },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═════════════════════════════════════════════════════════════════════════

  private async _assertPropertyAccess(
    propertyId: string,
    userId: string,
    role: string,
  ) {
    // ADMIN always has access
    if (role === 'ADMIN') return;

    const now = new Date();
    const access = await this.prisma.propertyAccess.findFirst({
      where: {
        propertyId,
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });

    if (!access)
      throw new ForbiddenException(
        'You do not have access to this property dashboard. Contact your admin.',
      );
  }

  private async _assertDashboardExists(dashboardId: string) {
    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { id: dashboardId },
    });
    if (!dashboard)
      throw new NotFoundException(
        `PropertyDashboard "${dashboardId}" not found.`,
      );
    return dashboard;
  }

  private async _getCriteriaForDashboard(dashboardId: string) {
    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { id: dashboardId },
      include: {
        property: {
          include: { activeTemplate: { include: { criteria: true } } },
        },
      },
    });
    if (!dashboard)
      throw new NotFoundException(
        `PropertyDashboard "${dashboardId}" not found.`,
      );

    const criteria = dashboard.property?.activeTemplate?.criteria;
    if (!criteria)
      throw new BadRequestException(
        'This property has no active template or inspection criteria configured.',
      );

    return { dashboard, criteria };
  }

  private _resolveFileType(
    mimetype: string,
  ): 'PHOTO' | 'VIDEO' | 'PDF' | 'EMBED' {
    if (mimetype.startsWith('video')) return 'VIDEO';
    if (mimetype === 'application/pdf') return 'PDF';
    if (mimetype.startsWith('image')) return 'PHOTO';
    return 'PHOTO';
  }
}
