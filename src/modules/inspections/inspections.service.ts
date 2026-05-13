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
  UploadStatus,
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
  ) {
    const { dashboard, criteria } =
      await this._getCriteriaForDashboard(dashboardId);

    // ── Access check ──────────────────────────────────────────────────────
    await this._assertPropertyAccess(
      dashboard.property.id,
      inspectorId,
      inspectorRole,
    );

    // ── Validate scheduled inspection (unchanged) ─────────────────────────
    const activeSchedule = await this.prisma.scheduledInspection.findUnique({
      where: { id: scheduledInspectionId },
    });
    if (!activeSchedule)
      throw new NotFoundException(
        `Scheduled inspection "${scheduledInspectionId}" not found.`,
      );
    if (activeSchedule.dashboardId !== dashboardId)
      throw new BadRequestException(
        'Scheduled inspection does not belong to this dashboard.',
      );
    if (activeSchedule.assignedTo !== inspectorId)
      throw new ForbiddenException('This inspection is not assigned to you.');
    if (activeSchedule.status === ScheduledInspectionStatus.COMPLETE)
      throw new BadRequestException('Already completed.');
    if (activeSchedule.status === ScheduledInspectionStatus.ASSIGNED)
      throw new BadRequestException('Call /start endpoint first.');
    if (activeSchedule.status === ScheduledInspectionStatus.DUE)
      throw new BadRequestException('Inspection overdue. Contact admin.');
    if (activeSchedule.status !== ScheduledInspectionStatus.IN_PROGRESS)
      throw new BadRequestException('Invalid state for submission.');

    // ── Extract criteria configs (unchanged) ──────────────────────────────
    const headerFields = criteria.headerFields as unknown as HeaderField[];
    const categories =
      criteria.scoringCategories as unknown as ScoringCategory[];
    const mediaSlots = criteria.mediaFields as unknown as MediaFieldSlot[];
    const repairConfig =
      criteria.repairPlanningConfig as unknown as RepairConfig;
    const thresholds =
      criteria.healthThresholdConfig as unknown as HealthThreshold;

    // ── Header & score validations (unchanged) ────────────────────────────
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

    // ── Validate media sessions ───────────────────────────────────────────
    const validSlotKeys = mediaSlots.map((s) => s.key);
    for (const sess of dto.mediaSessions ?? []) {
      if (!validSlotKeys.includes(sess.mediaFieldKey))
        throw new BadRequestException(
          `Invalid mediaFieldKey: ${sess.mediaFieldKey}`,
        );
      const session = await this.prisma.uploadSession.findFirst({
        where: {
          id: sess.sessionId,
          userId: inspectorId,
          status: UploadStatus.COMPLETED,
          expiresAt: { gt: new Date() },
        },
      });
      if (!session)
        throw new BadRequestException(
          `Invalid or expired upload session: ${sess.sessionId}`,
        );
    }

    // ── Compute score & health (unchanged) ─────────────────────────────────
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

    // ── Transaction: create inspection, link embed fields & sessions ───────
    const { inspection, savedMediaFiles } = await this.prisma.$transaction(
      async (tx) => {
        // 1. Create inspection
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

        // 2. Embed fields (unchanged)
        for (const [mediaFieldKey, embedUrl] of Object.entries(
          dto.embedFields ?? {},
        )) {
          const slot = mediaSlots.find((s) => s.key === mediaFieldKey);
          if (!slot || slot.type !== 'embed') continue;
          const mf = await tx.mediaFile.create({
            data: {
              inspectionId: inspection.id,
              fileName: mediaFieldKey,
              fileType: 'EMBED',
              url: String(embedUrl),
              size: null,
              mediaFieldKey,
            },
          });
          savedMediaFiles.push(mf);
        }

        // 3. Convert upload sessions to MediaFile rows
        for (const sess of dto.mediaSessions ?? []) {
          const session = await tx.uploadSession.findUnique({
            where: { id: sess.sessionId },
          });
          if (!session) continue; // should not happen after validation
          const mf = await tx.mediaFile.create({
            data: {
              inspectionId: inspection.id,
              fileName: session.fileName,
              fileType: this._resolveFileType(session.mimeType),
              url: session.key, // store MinIO key, generate signed URL when serving
              size: session.fileSize,
              mediaFieldKey: sess.mediaFieldKey,
            },
          });
          savedMediaFiles.push(mf);
          // Mark session as assigned (so it cannot be reused)
          await tx.uploadSession.update({
            where: { id: sess.sessionId },
            data: {
              status: UploadStatus.ASSIGNED,
              inspectionId: inspection.id,
              mediaFieldKey: sess.mediaFieldKey,
            },
          });
        }

        // 4. Mark schedule COMPLETE
        await tx.scheduledInspection.update({
          where: { id: activeSchedule.id },
          data: {
            status: ScheduledInspectionStatus.COMPLETE,
            inspectionId: inspection.id,
          },
        });

        // 5. Clear nextInspectionDate
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

    // ── Notifications (unchanged) ─────────────────────────────────────────
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
      dashboardId,
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
        inspectionId: inspection.id,
        dashboardId,
        changeNote: 'New inspection report has been submitted',
      });
    }

    // Return with signed URLs for media files (implement `_getSignedUrl` helper)
    return {
      success: true,
      message: 'Inspection submitted successfully',
      data: {
        ...inspection,
        mediaFiles: savedMediaFiles.map((file) => ({
          ...file,
          url:
            file.fileType === 'EMBED' ? file.url : this._getSignedUrl(file.url),
        })),
        summary: { overallScore, healthLabel, remainingLife },
      },
    };
  }

  // ── Service method ────────────────────────────────────────────────────────────

  async updateInspection(
    inspectionId: string,
    adminId: string,
    dto: UpdateInspectionDto,
  ) {
    // ── Find inspection with related data ─────────────────────────────────
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

    const criteria = inspection.dashboard.property?.activeTemplate?.criteria;
    const mediaSlots = (criteria?.mediaFields ??
      []) as unknown as MediaFieldSlot[];
    const validSlotKeys = mediaSlots.map((s) => s.key);

    // ── Validate media sessions (new files) ───────────────────────────────
    for (const sess of dto.mediaSessions ?? []) {
      if (!validSlotKeys.includes(sess.mediaFieldKey))
        throw new BadRequestException(
          `Invalid mediaFieldKey: ${sess.mediaFieldKey}`,
        );

      const session = await this.prisma.uploadSession.findFirst({
        where: {
          id: sess.sessionId,
          // userId: adminId, // admin or the original inspector? Use adminId for update
          status: 'COMPLETED',
          expiresAt: { gt: new Date() },
        },
      });

      console.log(session)
      if (!session)
        throw new BadRequestException(
          `Invalid or expired upload session: ${sess.sessionId}`,
        );
    }

    // ── Recompute score + health if scores changed ────────────────────────
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

    // ── Transaction: remove files, update embed fields, add new sessions ───
    const { updated, savedMediaFiles } = await this.prisma.$transaction(
      async (tx) => {
        // 1. Remove requested media files
        if (dto.removeMediaFileIds?.length) {
          await tx.mediaFile.deleteMany({
            where: {
              id: { in: dto.removeMediaFileIds },
              inspectionId, // safety — only this inspection's files
            },
          });
        }

        const savedMediaFiles = [];

        // 2. Upsert embed fields
        for (const [mediaFieldKey, embedUrl] of Object.entries(
          dto.embedFields ?? {},
        )) {
          const slot = mediaSlots.find((s) => s.key === mediaFieldKey);
          if (!slot || slot.type !== 'embed') continue;

          const existingEmbed = await tx.mediaFile.findFirst({
            where: { inspectionId, mediaFieldKey },
          });

          let mediaFile;
          if (existingEmbed) {
            mediaFile = await tx.mediaFile.update({
              where: { id: existingEmbed.id },
              data: { url: String(embedUrl), uploadedAt: new Date() },
            });
          } else {
            mediaFile = await tx.mediaFile.create({
              data: {
                inspectionId,
                fileName: mediaFieldKey,
                fileType: 'EMBED',
                url: String(embedUrl),
                size: null,
                mediaFieldKey,
              },
            });
          }
          savedMediaFiles.push(mediaFile);
        }

        // 3. Add new file media from upload sessions
        for (const sess of dto.mediaSessions ?? []) {
          const session = await tx.uploadSession.findUnique({
            where: { id: sess.sessionId },
          });
          if (!session) continue; // already validated

          const mediaFile = await tx.mediaFile.create({
            data: {
              inspectionId,
              fileName: session.fileName,
              fileType: this._resolveFileType(session.mimeType),
              url: session.key, // store MinIO key
              size: session.fileSize,
              mediaFieldKey: sess.mediaFieldKey,
            },
          });
          savedMediaFiles.push(mediaFile);

          // Mark session as assigned
          await tx.uploadSession.update({
            where: { id: sess.sessionId },
            data: {
              status: 'ASSIGNED',
              inspectionId,
              mediaFieldKey: sess.mediaFieldKey,
            },
          });
        }

        // 4. Update inspection row
        const updated = await tx.inspection.update({
          where: { id: inspectionId },
          data: {
            ...(dto.headerData && { headerData: dto.headerData }),
            ...(dto.scores && { scores: dto.scores }),
            ...(repairItems && { repairItems }),
            ...(dto.nteValue !== undefined && { nteValue: dto.nteValue }),
            ...(dto.additionalComments !== undefined && {
              additionalComments: dto.additionalComments,
            }),
            ...(dto.scores && { overallScore, healthLabel, remainingLife }),
          },
          include: { mediaFiles: true },
        });

        // 5. Activity log
        const propertyName =
          inspection.dashboard.property?.name ?? 'Unknown Property';
        await tx.activityLog.create({
          data: {
            category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
            actor_role: 'ADMIN',
            message: `Inspection report for ${propertyName} was updated before publishing`,
          },
        });

        return { updated, savedMediaFiles };
      },
    );

    return {
      success: true,
      message: 'Inspection updated successfully',
      data: {
        ...updated,
        mediaFiles: updated.mediaFiles.map((file) => ({
          ...file,
          url:
            file.fileType === 'EMBED' ? file.url : this._getSignedUrl(file.url),
        })),
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // INSPECTION QUERIES
  // ═════════════════════════════════════════════════════════════════════════

  async getPropertyInfo(dashboardId: string, userId: string, role: string) {
    const dashboard = await this.prisma.propertyDashboard.findUnique({
      where: { id: dashboardId },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
            propertyType: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!dashboard)
      throw new NotFoundException(
        `PropertyDashboard "${dashboardId}" not found.`,
      );

    await this._assertPropertyAccess(dashboard.property.id, userId, role);

    return {
      success: true,
      message: 'Property info retrieved successfully',
      data: {
        dashboardId: dashboard.id,
        property: dashboard.property,
      },
    };
  }

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
    filters: { status?: string; search?: string; page: number; limit: number },
  ) {
    const { status, search, page, limit } = filters;
    const skip = (page - 1) * limit;

    await this._markOverdue(userId);

    const where: any = {
      assignedTo: userId,
      ...(status && { status }),
      // Add search condition
      ...(search && {
        OR: [
          {
            dashboard: {
              property: {
                name: {
                  contains: search,
                  mode: 'insensitive', // Case-insensitive search
                },
              },
            },
          },
          {
            dashboard: {
              property: {
                address: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      }),
    };

    const [scheduled, total] = await this.prisma.$transaction([
      this.prisma.scheduledInspection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
        scheduledInspectionId: s.id,
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
        ...(search && { search }), // Include search term in meta if provided
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
    // 1️⃣ Fetch minimal property first for access check
    const accessCheck = await this.prisma.scheduledInspection.findUnique({
      where: { id: scheduledInspectionId },
      select: {
        dashboard: {
          select: {
            property: { select: { id: true } },
          },
        },
      },
    });

    if (!accessCheck)
      throw new NotFoundException('Scheduled inspection not found.');

    await this._assertPropertyAccess(
      accessCheck.dashboard.property.id,
      userId,
      role,
    );

    // 2️⃣ Fetch actual data (minimal fields only)
    const scheduled = await this.prisma.scheduledInspection.findUnique({
      where: { id: scheduledInspectionId },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        dashboardId: true,
        createdAt: true,

        assignee: {
          select: { id: true, username: true, email: true, avatar: true },
        },

        creator: {
          select: { id: true, username: true },
        },

        dashboard: {
          select: {
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

        inspection: {
          select: {
            id: true,
            inspectedAt: true,
            overallScore: true,
            healthLabel: true,
            remainingLife: true,
            headerData: true,
            scores: true,
            repairItems: true,
            nteValue: true,
            additionalComments: true,
            inspector: {
              select: {
                id: true,
                username: true,
                email: true,
                avatar: true,
              },
            },
            mediaFiles: {
              orderBy: { uploadedAt: 'asc' },
              select: {
                id: true,
                fileName: true,
                fileType: true,
                url: true,
                mediaFieldKey: true,
                uploadedAt: true,
              },
            },
          },
        },
      },
    });

    // 3️⃣ Group media by slot
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
        id: scheduled.id,
        status: scheduled.status,
        scheduledAt: scheduled.scheduledAt,
        dashboardId: scheduled.dashboardId,
        createdAt: scheduled.createdAt,
        assignee: scheduled.assignee,
        createdBy: scheduled.creator,

        property: scheduled.dashboard.property,

        inspection: scheduled.inspection
          ? {
              ...scheduled.inspection,
              media: mediaBySlot,
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
    // ADMIN → always allowed
    if (role === 'ADMIN') return;

    // 1️⃣ Check property ownership first
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        propertyManagerId: true,
        dashboard: { select: { id: true } },
      },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    // 2️⃣ PROPERTY_MANAGER → must own this property
    if (role === 'PROPERTY_MANAGER') {
      if (property.propertyManagerId !== userId) {
        throw new ForbiddenException('This property does not belong to you.');
      }
      return;
    }

    // 3️⃣ AUTHORIZED_VIEWER → must have valid access entry
    if (role === 'AUTHORIZED_VIEWER') {
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

    // 4️⃣ OPERATIONAL → must have an active scheduled inspection on this dashboard
    if (role === 'OPERATIONAL') {
      if (!property.dashboard) {
        throw new NotFoundException('Property dashboard not found.');
      }

      const assignedInspection =
        await this.prisma.scheduledInspection.findFirst({
          where: {
            dashboardId: property.dashboard.id,
            assignedTo: userId,
            status: {
              in: [
                ScheduledInspectionStatus.ASSIGNED,
                ScheduledInspectionStatus.DUE,
                ScheduledInspectionStatus.IN_PROGRESS,
                ScheduledInspectionStatus.COMPLETE,
              ],
            },
          },
        });

      if (!assignedInspection) {
        throw new ForbiddenException(
          'You do not have an active scheduled inspection for this property.',
        );
      }

      return;
    }

    // 5️⃣ Any other role → deny
    throw new ForbiddenException('Invalid role for this action.');
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

  private _getSignedUrl(key: string): string {
    // key is relative path inside public folder, e.g. '/public/storage/inspections/...'
    const baseUrl = appConfig().app.url;
    return `${baseUrl}${key}`;
  }
}
