import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SubmitInspectionDto } from './dto/inspection.dto';
import { ActivityCategory } from 'prisma/generated/enums';
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

  // ─────────────────────────────────────────────────────────────────────────
  // FIND ALL
  // ─────────────────────────────────────────────────────────────────────────

  async findAll(filters: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
  }) {
    const { page, limit, status, search } = filters;
    const skip = (page - 1) * limit;

    const where: any = {
      ...(status && { status }),
      ...(search && {
        OR: [
          {
            dashboard: {
              property: { name: { contains: search, mode: 'insensitive' } },
            },
          },
          {
            dashboard: {
              property: { address: { contains: search, mode: 'insensitive' } },
            },
          },
          { inspector: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [inspections, total] = await this.prisma.$transaction([
      this.prisma.inspection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          overallScore: true,
          healthLabel: true,
          inspectedAt: true,
          createdAt: true,
          inspector: { select: { id: true, name: true, avatar: true } },
          dashboard: {
            select: {
              property: {
                select: { name: true, address: true, propertyType: true },
              },
            },
          },
        },
      }),
      this.prisma.inspection.count({ where }),
    ]);

    const total_pages = Math.ceil(total / limit);

    return {
      success: true,
      message: 'Inspections fetched successfully',
      data: inspections.map((i) => ({
        id: i.id,
        status: i.status,
        overallScore: i.overallScore,
        healthLabel: i.healthLabel,
        inspectedAt: i.inspectedAt,
        createdAt: i.createdAt,
        inspector: i.inspector,
        property: {
          name: i.dashboard?.property?.name,
          address: i.dashboard?.property?.address,
          propertyType: i.dashboard?.property?.propertyType,
        },
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

  // ─────────────────────────────────────────────────────────────────────────
  // GET FORM
  // ─────────────────────────────────────────────────────────────────────────

  async getInspectionForm(dashboardId: string) {
    const { criteria } = await this._getCriteriaForDashboard(dashboardId);

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

  // ─────────────────────────────────────────────────────────────────────────
  // SUBMIT INSPECTION
  // ─────────────────────────────────────────────────────────────────────────

  async submitInspection(
    dashboardId: string,
    inspectorId: string,
    dto: SubmitInspectionDto,
    files: Express.Multer.File[],
  ) {
    const { dashboard, criteria } =
      await this._getCriteriaForDashboard(dashboardId);

    const headerFields = criteria.headerFields as unknown as HeaderField[];
    const categories =
      criteria.scoringCategories as unknown as ScoringCategory[];
    const mediaSlots = criteria.mediaFields as unknown as MediaFieldSlot[];
    const repairConfig =
      criteria.repairPlanningConfig as unknown as RepairConfig;
    const thresholds =
      criteria.healthThresholdConfig as unknown as HealthThreshold;

    // ── Validations ──────────────────────────────────────────────────────────
    for (const field of headerFields) {
      if (field.required && !dto.headerData?.[field.key]) {
        throw new BadRequestException(
          `Required header field "${field.label}" is missing.`,
        );
      }
    }

    for (const category of categories) {
      const submitted = dto.scores?.[category.key];
      if (submitted !== undefined && submitted.score > category.maxPoints) {
        throw new BadRequestException(
          `Score for "${category.label}" is ${submitted.score} — max allowed is ${category.maxPoints}.`,
        );
      }
    }

    const { statuses } = repairConfig;
    for (const item of dto.repairItems ?? []) {
      if (!statuses.includes(item.status)) {
        throw new BadRequestException(
          `Repair status "${item.status}" is invalid. Allowed: ${statuses.join(', ')}.`,
        );
      }
    }

    const validSlotKeys = mediaSlots.map((s) => s.key);
    for (const key of dto.mediaFieldKeys ?? []) {
      if (!validSlotKeys.includes(key)) {
        throw new BadRequestException(
          `mediaFieldKey "${key}" does not exist in criteria.mediaFields.`,
        );
      }
    }

    // ── Compute score + health ────────────────────────────────────────────────
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

    // ── Create inspection row ─────────────────────────────────────────────────
    const inspection = await this.prisma.inspection.create({
      data: {
        dashboardId,
        inspectorId,
        status: 'SUBMITTED',
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

    // ── Upload files ──────────────────────────────────────────────────────────
    const mediaFiles = [];
    for (let i = 0; i < (files ?? []).length; i++) {
      const file = files[i];
      const mediaFieldKey = dto.mediaFieldKeys?.[i] ?? 'mediaFiles';
      const slot = mediaSlots.find((s) => s.key === mediaFieldKey);
      const url = `https://your-storage.example.com/inspections/${inspection.id}/${Date.now()}_${file.originalname}`;

      const mediaFile = await this.prisma.mediaFile.create({
        data: {
          inspectionId: inspection.id,
          fileName: file.originalname,
          fileType: this._resolveFileType(file.mimetype),
          url,
          size: file.size,
          mediaFieldKey,
          category:
            slot?.type === 'embed'
              ? 'tour'
              : mediaFieldKey === 'aerialMap'
                ? 'aerial'
                : file.mimetype.startsWith('video')
                  ? 'video'
                  : 'photo',
          uploadedAt: new Date(),
        },
      });

      mediaFiles.push(mediaFile);
    }

    // ── Fetch property + inspector name for log/notification ─────────────────
    const propertyName = dashboard.property?.name ?? 'Unknown Property';

    const inspector = await this.prisma.user.findUnique({
      where: { id: inspectorId },
      select: { name: true, role: true },
    });

    // ── Activity log ──────────────────────────────────────────────────────────
    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: inspector?.role ?? null,
        message: `${inspector?.name ?? 'Inspector'} submitted an inspection report for ${propertyName}`,
      },
    });

    // ── Notify admins ─────────────────────────────────────────────────────────
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

    // ── Notify users with dashboard access (dashboard updated) ────────────────
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
        mediaFiles,
        summary: { overallScore, healthLabel, remainingLife },
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIND ONE
  // ─────────────────────────────────────────────────────────────────────────

  async findOne(inspectionId: string) {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        inspector: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        mediaFiles: true,
      },
    });
    if (!inspection) throw new NotFoundException('Inspection not found.');

    return { success: true, message: 'Inspection retrieved', data: inspection };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIND ALL FOR DASHBOARD
  // ─────────────────────────────────────────────────────────────────────────

  async findAllForDashboard(dashboardId: string) {
    await this._assertDashboardExists(dashboardId);

    const inspections = await this.prisma.inspection.findMany({
      where: { dashboardId },
      include: {
        inspector: { select: { id: true, name: true, avatar: true } },
        mediaFiles: {
          select: {
            id: true,
            fileName: true,
            fileType: true,
            url: true,
            mediaFieldKey: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      message: 'Inspections retrieved',
      data: inspections,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

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
    if (!criteria) {
      throw new BadRequestException(
        'This property has no active template or inspection criteria configured.',
      );
    }

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
