import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SubmitInspectionDto, UpdateInspectionDto } from './dto/inspection.dto';
import {
  ActivityCategory,
  ScheduledInspectionStatus,
} from 'prisma/generated/enums';
import { NotificationService } from '../notification/notification.service';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';

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

    // ── Track uploaded file paths for cleanup on failure ──────────────────
    const uploadedPaths: string[] = [];

    try {
      // ── Upload files to disk BEFORE transaction ────────────────────────
      // (files must be on disk before DB rows reference them)
      const preparedFiles: {
        file: Express.Multer.File;
        mediaFieldKey: string;
        storagePath: string;
      }[] = [];

      for (let i = 0; i < (files ?? []).length; i++) {
        const file = files[i];
        const mediaFieldKey = dto.mediaFieldKeys?.[i] ?? 'mediaFiles';
        const sanitizedName = this._sanitizeFileName(file.originalname);
        const fileName = `${Date.now()}_${sanitizedName}`;
        const storagePath = `/inspections/pending/${fileName}`;

        await SojebStorage.disk('local').put(storagePath, file.buffer);
        uploadedPaths.push(storagePath); // track for cleanup

        preparedFiles.push({ file, mediaFieldKey, storagePath });
      }

      // ── Run everything in a single transaction ─────────────────────────
      const { inspection, savedMediaFiles } = await this.prisma.$transaction(
        async (tx) => {
          // 1. Create inspection row
          const inspection = await tx.inspection.create({
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
              inspectedAt: dto.inspectedAt
                ? new Date(dto.inspectedAt)
                : new Date(),
            },
          });

          const savedMediaFiles = [];

          // 2. Save embed fields
          for (const [mediaFieldKey, embedUrl] of Object.entries(
            dto.embedFields ?? {},
          )) {
            const slot = mediaSlots.find((s) => s.key === mediaFieldKey);
            if (!slot || slot.type !== 'embed') continue;

            const mediaFile = await tx.mediaFile.create({
              data: {
                inspectionId: inspection.id,
                fileName: mediaFieldKey,
                fileType: 'EMBED',
                url: String(embedUrl),
                size: null,
                mediaFieldKey,
                uploadedAt: new Date(),
              },
            });
            savedMediaFiles.push(mediaFile);
          }

          // 3. Save file media rows (files already uploaded to disk)
          for (const { file, mediaFieldKey, storagePath } of preparedFiles) {
            // Move file from pending to final inspection folder
            const sanitizedName = this._sanitizeFileName(file.originalname);
            const fileName = `${Date.now()}_${sanitizedName}`;
            const finalPath = `/inspections/${inspection.id}/${fileName}`;

            await SojebStorage.disk('local').put(finalPath, file.buffer);
            uploadedPaths.push(finalPath); // track final path too

            const mediaFile = await tx.mediaFile.create({
              data: {
                inspectionId: inspection.id,
                fileName: file.originalname,
                fileType: this._resolveFileType(file.mimetype),
                url: finalPath,
                size: file.size,
                mediaFieldKey,
                uploadedAt: new Date(),
              },
            });
            savedMediaFiles.push(mediaFile);
          }

          // 4. Mark schedule COMPLETE
          await tx.scheduledInspection.update({
            where: { id: activeSchedule.id },
            data: {
              status: ScheduledInspectionStatus.COMPLETE,
              inspectionId: inspection.id,
            },
          });

          // 5. Clear nextInspectionDate on property
          await tx.property.update({
            where: { id: dashboard.property.id },
            data: { nextInspectionDate: null },
          });

          // 6. Activity log
          const inspector = await tx.user.findUnique({
            where: { id: inspectorId },
            select: { username: true, role: true },
          });

          await tx.activityLog.create({
            data: {
              category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
              actor_role: inspector?.role ?? null,
              message: `${inspector?.username ?? 'Inspector'} submitted an inspection report for ${dashboard.property?.name ?? 'Unknown Property'}`,
            },
          });

          return { inspection, savedMediaFiles };
        },
      );

      // ── Outside transaction — notifications (non-critical) ────────────
      const propertyName = dashboard.property?.name ?? 'Unknown Property';

      const inspector = await this.prisma.user.findUnique({
        where: { id: inspectorId },
        select: { username: true, role: true },
      });

      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', status: 'ACTIVE', isDeleted: false },
        select: { id: true },
      });

      await this.notifications.inspectionReportUpdate({
        adminIds: admins.map((a) => a.id),
        inspectorId,
        inspectorName: inspector?.username ?? 'Inspector',
        propertyId: dashboard.property?.id ?? dashboardId,
        propertyName,
        inspectionId: inspection.id,
      });

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
          mediaFiles: savedMediaFiles.map((file) => ({
            ...file,
            url:
              file.fileType === 'EMBED' ? file.url : this._resolveUrl(file.url),
          })),
          summary: { overallScore, healthLabel, remainingLife },
        },
      };
    } catch (error) {
      // ── Cleanup uploaded files if anything failed ──────────────────────
      for (const path of uploadedPaths) {
        try {
          await SojebStorage.disk('local').delete(path);
        } catch {
          // silently ignore cleanup errors
        }
      }

      throw error; // re-throw original error
    }
  }

  // ── Service method ────────────────────────────────────────────────────────────

  async updateInspection(
    inspectionId: string,
    adminId: string,
    dto: UpdateInspectionDto,
    files: Express.Multer.File[],
  ) {
    // ── Find inspection ────────────────────────────────────────────────────
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        scheduledInspection: true,
        mediaFiles: true,
        dashboard: {
          include: {
            property: {
              include: { activeTemplate: { include: { criteria: true } } },
            },
          },
        },
      },
    });

    if (!inspection)
      throw new NotFoundException(`Inspection "${inspectionId}" not found.`);

    // ── Only allow editing COMPLETE inspections (not yet published) ────────
    if (
      inspection.scheduledInspection?.status !==
      ScheduledInspectionStatus.COMPLETE
    )
      throw new BadRequestException(
        `Only COMPLETE inspections can be edited. Current status: ${inspection.scheduledInspection?.status ?? 'unknown'}.`,
      );

    // ── Validate media field keys if new files are being added ─────────────
    const criteria = inspection.dashboard.property?.activeTemplate?.criteria;
    const mediaSlots = (criteria?.mediaFields ??
      []) as unknown as MediaFieldSlot[];

    if (dto.mediaFieldKeys && dto.mediaFieldKeys.length !== files.length)
      throw new BadRequestException(
        `mediaFieldKeys length (${dto.mediaFieldKeys.length}) must match files length (${files.length}).`,
      );

    const validSlotKeys = mediaSlots.map((s) => s.key);
    for (const key of dto.mediaFieldKeys ?? []) {
      if (!validSlotKeys.includes(key))
        throw new BadRequestException(
          `mediaFieldKey "${key}" does not exist in criteria.mediaFields.`,
        );
    }

    // ── Recompute score + health if scores changed ─────────────────────────
    let overallScore = inspection.overallScore;
    let healthLabel = inspection.healthLabel;
    let remainingLife = inspection.remainingLife;

    if (dto.scores && criteria) {
      const categories =
        criteria.scoringCategories as unknown as ScoringCategory[];
      const thresholds =
        criteria.healthThresholdConfig as unknown as HealthThreshold;

      overallScore = categories.reduce(
        (sum, cat) =>
          sum +
          (dto.scores?.[cat.key]?.score ??
            (inspection.scores as any)?.[cat.key]?.score ??
            0),
        0,
      );

      healthLabel = 'Poor';
      remainingLife = `${thresholds.poor.remainingLifeMinYears}-${thresholds.poor.remainingLifeMaxYears} Years`;

      if (overallScore >= thresholds.good.minScore) {
        healthLabel = 'Good';
        remainingLife = `${thresholds.good.remainingLifeMinYears}-${thresholds.good.remainingLifeMaxYears} Years`;
      } else if (overallScore >= thresholds.fair.minScore) {
        healthLabel = 'Fair';
        remainingLife = `${thresholds.fair.remainingLifeMinYears}-${thresholds.fair.remainingLifeMaxYears} Years`;
      }
    }

    const repairItems = dto.repairItems
      ? dto.repairItems.map((item, i) => ({
          id: `repair_${Date.now()}_${i}`,
          title: item.title,
          status: item.status,
          description: item.description ?? '',
        }))
      : undefined;

    // ── Remove requested media files ───────────────────────────────────────
    if (dto.removeMediaFileIds?.length) {
      await this.prisma.mediaFile.deleteMany({
        where: {
          id: { in: dto.removeMediaFileIds },
          inspectionId: inspectionId, // safety — only delete files belonging to this inspection
        },
      });
    }

    // ── Upload new files ───────────────────────────────────────────────────
    const newMediaFiles = [];

    for (const [mediaFieldKey, embedUrl] of Object.entries(
      dto.embedFields ?? {},
    )) {
      const slot = mediaSlots.find((s) => s.key === mediaFieldKey);
      if (!slot || slot.type !== 'embed') continue;

      const mf = await this.prisma.mediaFile.create({
        data: {
          inspectionId: inspectionId,
          fileName: mediaFieldKey,
          fileType: 'EMBED',
          url: String(embedUrl),
          size: null,
          mediaFieldKey,
          uploadedAt: new Date(),
        },
      });
      newMediaFiles.push(mf);
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const mediaFieldKey = dto.mediaFieldKeys?.[i] ?? 'mediaFiles';

      // Save file to local storage
      const fileName = `${Date.now()}_${file.originalname}`;
      const storagePath = `/inspections/${inspectionId}/${fileName}`;

      await SojebStorage.disk('local').put(storagePath, file.buffer);

      const mf = await this.prisma.mediaFile.create({
        data: {
          inspectionId: inspectionId,
          fileName: file.originalname,
          fileType: this._resolveFileType(file.mimetype),
          url: storagePath, // ← save relative path only
          size: file.size,
          mediaFieldKey,
          uploadedAt: new Date(),
        },
      });
      newMediaFiles.push(mf);
    }

    // ── Update inspection row ──────────────────────────────────────────────
    const updated = await this.prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        ...(dto.headerData && { headerData: dto.headerData }),
        ...(dto.scores && { scores: dto.scores }),
        ...(repairItems && { repairItems: repairItems }),
        ...(dto.nteValue !== undefined && { nteValue: dto.nteValue }),
        ...(dto.additionalComments !== undefined && {
          additionalComments: dto.additionalComments,
        }),
        ...(dto.scores && { overallScore, healthLabel, remainingLife }),
      },
      include: { mediaFiles: true },
    });

    // ── Activity log ───────────────────────────────────────────────────────
    const propertyName =
      inspection.dashboard.property?.name ?? 'Unknown Property';
    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: 'ADMIN',
        message: `Inspection report for ${propertyName} was updated before publishing`,
      },
    });

    return {
      success: true,
      message: 'Inspection updated successfully',
      data: {
        ...updated,
        mediaFiles: updated.mediaFiles.map((file) => ({
          ...file,
          url:
            file.fileType === 'EMBED' ? file.url : this._resolveUrl(file.url),
        })),
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
          select: { id: true, username: true, email: true, avatar: true },
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

    return {
      success: true,
      message: 'Inspection retrieved',
      data: {
        ...inspection,
        mediaFiles: inspection.mediaFiles.map((file) => ({
          ...file,
          url:
            file.fileType === 'EMBED' ? file.url : this._resolveUrl(file.url),
        })),
      },
    };
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
          select: { id: true, username: true, avatar: true, email: true },
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
                select: {
                  name: true,
                  address: true,
                  propertyType: true,
                  nextInspectionDate: true,
                },
              },
            },
          },
          assignee: {
            select: { id: true, username: true, email: true, avatar: true },
          },
          creator: { select: { id: true, username: true } },
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
        nextInspectionDate: s.dashboard.property.nextInspectionDate,
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
          select: { id: true, username: true, email: true, avatar: true },
        },
        creator: { select: { id: true, username: true } },
        inspection: {
          include: {
            mediaFiles: {
              orderBy: { uploadedAt: 'asc' },
            },
            inspector: {
              select: { id: true, username: true, email: true, avatar: true },
            },
          },
        },
      },
    });

    if (!scheduled)
      throw new NotFoundException('Scheduled inspection not found.');

    await this._assertPropertyAccess(
      scheduled.dashboard.property.id,
      userId,
      role,
    );

    // ── Group media files by slot key ──────────────────────────────────────
    const mediaBySlot: Record<string, any[]> = {};
    for (const mf of scheduled.inspection?.mediaFiles ?? []) {
      const key = mf.mediaFieldKey ?? 'mediaFiles';
      mediaBySlot[key] ??= [];
      mediaBySlot[key].push({
        ...mf,
        url: mf.fileType === 'EMBED' ? mf.url : this._resolveUrl(mf.url),
      });
    }

    return {
      success: true,
      message: 'Scheduled inspection retrieved',
      data: {
        // ── Schedule info ────────────────────────────────────────────────
        id: scheduled.id,
        status: scheduled.status,
        scheduledAt: scheduled.scheduledAt,
        dashboardId: scheduled.dashboardId,
        createdAt: scheduled.createdAt,
        assignee: scheduled.assignee,
        createdBy: scheduled.creator,

        // ── Property info ────────────────────────────────────────────────
        property: {
          id: scheduled.dashboard.property.id,
          name: scheduled.dashboard.property.name,
          address: scheduled.dashboard.property.address,
          propertyType: scheduled.dashboard.property.propertyType,
        },

        // ── Filled inspection (null if not yet submitted) ─────────────────
        inspection: scheduled.inspection
          ? {
              id: scheduled.inspection.id,
              inspectedAt: scheduled.inspection.inspectedAt,
              overallScore: scheduled.inspection.overallScore,
              healthLabel: scheduled.inspection.healthLabel,
              remainingLife: scheduled.inspection.remainingLife,
              headerData: scheduled.inspection.headerData,
              scores: scheduled.inspection.scores,
              repairItems: scheduled.inspection.repairItems,
              nteValue: scheduled.inspection.nteValue,
              additionalComments: scheduled.inspection.additionalComments,
              inspector: scheduled.inspection.inspector,
              // ── Media grouped by slot ──────────────────────────────────
              media: mediaBySlot,
              // ── Raw media list (if frontend prefers flat) ──────────────
              mediaFiles: scheduled.inspection.mediaFiles.map((file) => ({
                ...file,
                url:
                  file.fileType === 'EMBED'
                    ? file.url
                    : this._resolveUrl(file.url),
              })),
            }
          : null,
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

  // ── In inspections.service.ts — add these two methods ────────────────────────

  async deleteInspection(scheduledInspectionId: string, adminId: string) {
    // ── Find scheduled inspection with all related data ───────────────────
    const scheduled = await this.prisma.scheduledInspection.findUnique({
      where: { id: scheduledInspectionId },
      include: {
        inspection: {
          include: {
            mediaFiles: true,
            folderItems: true,
          },
        },
        dashboard: {
          include: {
            property: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!scheduled)
      throw new NotFoundException(
        `Scheduled inspection "${scheduledInspectionId}" not found.`,
      );

    const propertyName =
      scheduled.dashboard.property?.name ?? 'Unknown Property';
    const hasInspection = !!scheduled.inspection;

    // ── Delete in correct order (respect FK constraints) ──────────────────
    await this.prisma.$transaction(async (tx) => {
      if (hasInspection) {
        const inspectionId = scheduled.inspection.id;

        // 1. Remove folder item references
        await tx.inspectionFolderItem.deleteMany({
          where: { inspectionId },
        });

        // 2. Remove media files
        await tx.mediaFile.deleteMany({
          where: { inspectionId },
        });

        // 3. Delete the inspection
        await tx.inspection.delete({
          where: { id: inspectionId },
        });
      }

      // 4. Delete the scheduled inspection
      await tx.scheduledInspection.delete({
        where: { id: scheduledInspectionId },
      });
    });

    // ── Activity log ───────────────────────────────────────────────────────
    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: 'ADMIN',
        message: hasInspection
          ? `Inspection report and schedule for ${propertyName} has been deleted`
          : `Scheduled inspection for ${propertyName} has been deleted`,
      },
    });

    return {
      success: true,
      message: hasInspection
        ? 'Scheduled inspection and inspection report deleted successfully'
        : 'Scheduled inspection deleted successfully',
      data: {
        deletedScheduledInspectionId: scheduledInspectionId,
        deletedInspectionId: scheduled.inspection?.id ?? null,
        deletedMediaFilesCount: scheduled.inspection?.mediaFiles.length ?? 0,
      },
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

  private _resolveUrl(path: string): string {
    const appUrl = appConfig().app.url;
    return `${appUrl}/public/storage${path}`;
  }

  private _sanitizeFileName(originalName: string): string {
    return originalName
      .replace(/\s+/g, '_') // spaces → underscore
      .replace(/[^a-zA-Z0-9._-]/g, '') // remove special chars except . _ -
      .toLowerCase(); // lowercase for consistency
  }
}
