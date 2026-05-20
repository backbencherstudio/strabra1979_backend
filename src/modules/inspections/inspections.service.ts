import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  SaveDraftInspectionDto,
  SubmitInspectionDto,
  UpdateInspectionDto,
} from './dto/inspection.dto';
import {
  ActivityCategory,
  ScheduledInspectionStatus,
  UploadStatus,
} from 'prisma/generated/enums';
import { NotificationService } from '../notification/notification.service';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';
import { HealthThresholdConfigDto } from '../admin/inspection-criteria/dto/inspection-criteria.dto';

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
        'Scheduled inspection does not belong to this dashboard.',
      );
    if (activeSchedule.assignedTo !== inspectorId)
      throw new ForbiddenException('This inspection is not assigned to you.');
    if (activeSchedule.status === 'COMPLETE')
      throw new BadRequestException('Already completed.');
    if (activeSchedule.status === 'ASSIGNED')
      throw new BadRequestException('Call /start endpoint first.');
    if (activeSchedule.status === 'DUE')
      throw new BadRequestException('Inspection overdue. Contact admin.');
    if (activeSchedule.status !== 'IN_PROGRESS')
      throw new BadRequestException('Invalid state for submission.');

    // ── Check for existing draft ──────────────────────────────────────────
    const existingDraft = await this.prisma.inspection.findFirst({
      where: {
        scheduledInspectionId,
        inspectorId,
        status: 'DRAFT',
      },
      include: {
        mediaFiles: true,
      },
    });

    // ── Extract criteria configs ─────────────────────────────────────────
    const headerFields = criteria.headerFields as unknown as HeaderField[];
    const categories =
      criteria.scoringCategories as unknown as ScoringCategory[];
    const mediaSlots = criteria.mediaFields as unknown as MediaFieldSlot[];
    const repairConfig =
      criteria.repairPlanningConfig as unknown as RepairConfig;
    const healthThresholdConfig =
      criteria.healthThresholdConfig as unknown as HealthThresholdConfigDto;

    // ── Get the roof system type from headerData ──────────────────────────
    const roofSystemType = dto.headerData?.roofSystemType || 'Multiple';

    // ── Validate required header fields ───────────────────────────────────
    for (const field of headerFields) {
      if (field.required && !dto.headerData?.[field.key])
        throw new BadRequestException(
          `Required header field "${field.label}" is missing.`,
        );
    }

    // ── Calculate total possible score and validate submitted scores ──────
    const totalPossibleScore = categories.reduce(
      (sum, cat) => sum + cat.maxPoints,
      0,
    );

    let actualScore = 0;
    const categoryScores: Record<string, { score: number; notes?: string }> =
      {};

    for (const category of categories) {
      const submitted = dto.scores?.[category.key];

      if (submitted !== undefined && submitted !== null) {
        if (submitted.score > category.maxPoints) {
          throw new BadRequestException(
            `Score for "${category.label}" is ${submitted.score} — max allowed is ${category.maxPoints}.`,
          );
        }
        if (submitted.score < 0) {
          throw new BadRequestException(
            `Score for "${category.label}" cannot be negative.`,
          );
        }

        actualScore += submitted.score;
        categoryScores[category.key] = {
          score: submitted.score,
          notes: submitted.notes || '',
        };
      } else {
        categoryScores[category.key] = {
          score: 0,
          notes: '',
        };
      }
    }

    const overallScorePercentage =
      totalPossibleScore > 0
        ? Number(((actualScore / totalPossibleScore) * 100).toFixed(2))
        : 0;

    // ── Validate repair items statuses ────────────────────────────────────
    const { statuses } = repairConfig;
    for (const item of dto.repairItems ?? []) {
      if (!statuses.includes(item.status))
        throw new BadRequestException(
          `Repair status "${item.status}" is invalid. Allowed: ${statuses.join(', ')}.`,
        );
    }

    // ── Validate media sessions (BEFORE transaction) ──────────────────────
    const validSlotKeys = mediaSlots.map((s) => s.key);

    // Get existing file URLs from draft to skip validation
    const existingFileUrls = new Set(
      existingDraft?.mediaFiles
        .filter((mf) => mf.fileType !== 'EMBED')
        .map((mf) => mf.url) ?? [],
    );

    for (const sess of dto.mediaSessions ?? []) {
      if (!validSlotKeys.includes(sess.mediaFieldKey))
        throw new BadRequestException(
          `Invalid mediaFieldKey: ${sess.mediaFieldKey}`,
        );

      // First, get the session to check its file URL
      const session = await this.prisma.uploadSession.findUnique({
        where: { id: sess.sessionId },
      });

      if (!session) {
        throw new BadRequestException(
          `Upload session not found: ${sess.sessionId}`,
        );
      }

      // If this file already exists in the draft, skip validation
      if (existingFileUrls.has(session.key)) {
        continue;
      }

      // Validate new upload session (not in draft)
      const validSession = await this.prisma.uploadSession.findFirst({
        where: {
          id: sess.sessionId,
          userId: inspectorId,
          status: 'COMPLETED',
          expiresAt: { gt: new Date() },
        },
      });

      if (!validSession) {
        throw new BadRequestException(
          `Invalid or expired upload session: ${sess.sessionId}. Session must be COMPLETED and not expired.`,
        );
      }
    }

    // ── Compute health label & remaining life ─────────────────────────────
    let roofThresholds;
    if (healthThresholdConfig && healthThresholdConfig[roofSystemType]) {
      roofThresholds = healthThresholdConfig[roofSystemType];
    } else if (healthThresholdConfig && healthThresholdConfig['Multiple']) {
      roofThresholds = healthThresholdConfig['Multiple'];
    } else {
      roofThresholds = {
        good: {
          minScore: 70,
          maxScore: 100,
          remainingLifeMinYears: 20,
          remainingLifeMaxYears: 30,
        },
        fair: {
          minScore: 30,
          maxScore: 69,
          remainingLifeMinYears: 10,
          remainingLifeMaxYears: 20,
        },
        poor: {
          minScore: 0,
          maxScore: 29,
          remainingLifeMinYears: 0,
          remainingLifeMaxYears: 10,
        },
      };
    }

    let healthLabel = 'Poor';
    let remainingLife = `${roofThresholds.poor.remainingLifeMinYears}-${roofThresholds.poor.remainingLifeMaxYears} Years`;

    if (actualScore >= roofThresholds.good.minScore) {
      healthLabel = 'Good';
      remainingLife = `${roofThresholds.good.remainingLifeMinYears}-${roofThresholds.good.remainingLifeMaxYears} Years`;
    } else if (actualScore >= roofThresholds.fair.minScore) {
      healthLabel = 'Fair';
      remainingLife = `${roofThresholds.fair.remainingLifeMinYears}-${roofThresholds.fair.remainingLifeMaxYears} Years`;
    }

    // Format repair items
    const repairItems = (dto.repairItems ?? []).map((item, i) => ({
      id: `repair_${Date.now()}_${i}`,
      title: item.title,
      status: item.status,
      description: item.description ?? '',
    }));

    // ── Transaction: Update draft to COMPLETE or create new inspection ──────
    const { inspection } = await this.prisma.$transaction(async (tx) => {
      let inspection;

      if (existingDraft) {
        // ── UPDATE existing draft to COMPLETE (preserves media files) ────────

        // Remove requested media files
        if (dto.removeMediaFileIds?.length) {
          await tx.mediaFile.deleteMany({
            where: {
              id: { in: dto.removeMediaFileIds },
              inspectionId: existingDraft.id,
            },
          });
        }

        // Remove old embed fields (they'll be replaced)
        await tx.mediaFile.deleteMany({
          where: {
            inspectionId: existingDraft.id,
            fileType: 'EMBED',
          },
        });

        // Update the draft to COMPLETE
        inspection = await tx.inspection.update({
          where: { id: existingDraft.id },
          data: {
            status: 'COMPLETE',
            headerData: dto.headerData as any,
            scores: categoryScores as any,
            repairItems: repairItems as any,
            nteValue: dto.nteValue ?? null,
            additionalComments: dto.additionalComments ?? null,
            overallScore: actualScore,
            totalScore: totalPossibleScore,
            overallScorePercentage: overallScorePercentage,
            healthLabel,
            remainingLife,
            inspectedAt: dto.inspectedAt
              ? new Date(dto.inspectedAt)
              : new Date(),
          },
        });
      } else {
        // ── CREATE new inspection as COMPLETE (no draft existed) ─────────────
        inspection = await tx.inspection.create({
          data: {
            dashboardId,
            scheduledInspectionId,
            inspectorId,
            status: 'COMPLETE',
            headerData: dto.headerData as any,
            scores: categoryScores as any,
            repairItems: repairItems as any,
            nteValue: dto.nteValue ?? null,
            additionalComments: dto.additionalComments ?? null,
            overallScore: actualScore,
            totalScore: totalPossibleScore,
            overallScorePercentage: overallScorePercentage,
            healthLabel,
            remainingLife,
            inspectedAt: dto.inspectedAt
              ? new Date(dto.inspectedAt)
              : new Date(),
          },
        });
      }

      // ── Save embed fields ─────────────────────────────────────────────
      for (const [mediaFieldKey, embedUrl] of Object.entries(
        dto.embedFields ?? {},
      )) {
        const slot = mediaSlots.find((s) => s.key === mediaFieldKey);
        if (!slot || slot.type !== 'embed') continue;

        await tx.mediaFile.create({
          data: {
            inspectionId: inspection.id,
            fileName: mediaFieldKey,
            fileType: 'EMBED',
            url: String(embedUrl),
            size: null,
            mediaFieldKey,
          },
        });
      }

      // ── Save new upload sessions (only new ones not already in draft) ──
      // Get existing URLs from draft to avoid duplicates
      const existingUrls = new Set(
        existingDraft?.mediaFiles
          .filter((mf) => mf.fileType !== 'EMBED')
          .map((mf) => mf.url) ?? [],
      );

      for (const sess of dto.mediaSessions ?? []) {
        const session = await tx.uploadSession.findUnique({
          where: { id: sess.sessionId },
        });
        if (!session) continue;

        // Skip if this file already exists in the draft
        if (existingUrls.has(session.key)) {
          continue;
        }

        await tx.mediaFile.create({
          data: {
            inspectionId: inspection.id,
            fileName: session.fileName,
            fileType: this._resolveFileType(session.mimeType),
            url: session.key,
            size: session.fileSize,
            mediaFieldKey: sess.mediaFieldKey,
          },
        });

        await tx.uploadSession.update({
          where: { id: sess.sessionId },
          data: {
            status: 'ASSIGNED',
            inspectionId: inspection.id,
            mediaFieldKey: sess.mediaFieldKey,
          },
        });
      }

      // ── Mark schedule as COMPLETE and link to inspection ──────────────
      await tx.scheduledInspection.update({
        where: { id: activeSchedule.id },
        data: {
          status: 'COMPLETE',
          inspectionId: inspection.id,
        },
      });

      // ── Clear nextInspectionDate on property ─────────────────────────
      await tx.property.update({
        where: { id: dashboard.property.id },
        data: { nextInspectionDate: null },
      });

      // ── Create activity log ──────────────────────────────────────────
      const inspector = await tx.user.findUnique({
        where: { id: inspectorId },
        select: { username: true, role: true },
      });

      await tx.activityLog.create({
        data: {
          category: 'PROPERTY_DASHBOARD_UPDATE',
          actor_role: inspector?.role ?? null,
          message: `${inspector?.username ?? 'Inspector'} submitted an inspection report for ${dashboard.property?.name ?? 'Unknown Property'}. Score: ${actualScore}/${totalPossibleScore} (${overallScorePercentage}%) - ${healthLabel}`,
        },
      });

      return { inspection };
    });

    // ── Send notifications ─────────────────────────────────────────────
    const propertyName = dashboard.property?.name ?? 'Unknown Property';
    const inspector = await this.prisma.user.findUnique({
      where: { id: inspectorId },
      select: { username: true, role: true },
    });

    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE', isDeleted: false },
      select: { id: true },
    });

    if (admins.length) {
      await this.notifications.inspectionReportUpdate({
        adminIds: admins.map((a) => a.id),
        inspectorId,
        inspectorName: inspector?.username ?? 'Inspector',
        propertyId: dashboard.property?.id ?? dashboardId,
        propertyName,
        inspectionId: inspection.id,
        dashboardId,
      });
    }

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
        changeNote: `New inspection report submitted. Score: ${actualScore}/${totalPossibleScore} (${overallScorePercentage}%) - ${healthLabel}`,
      });
    }

    // Fetch all media files for the completed inspection
    const allMediaFiles = await this.prisma.mediaFile.findMany({
      where: { inspectionId: inspection.id },
    });

    return {
      success: true,
      message: existingDraft
        ? 'Inspection submitted successfully'
        : 'Inspection submitted successfully',
      data: {
        ...inspection,
        mediaFiles: allMediaFiles.map((file) => ({
          ...file,
          url:
            file.fileType === 'EMBED' ? file.url : this._getSignedUrl(file.url),
        })),
        summary: {
          overallScore: actualScore,
          totalScore: totalPossibleScore,
          overallScorePercentage: overallScorePercentage,
          healthLabel,
          remainingLife,
          roofSystemType,
        },
      },
    };
  }

  // ── saveDraft ─────────────────────────────────────────────────────────────────
  async saveDraft(
    dashboardId: string,
    scheduledInspectionId: string,
    inspectorId: string,
    inspectorRole: string,
    dto: SaveDraftInspectionDto,
  ) {
    const { dashboard, criteria } =
      await this._getCriteriaForDashboard(dashboardId);

    // ── Access check ────────────────────────────────────────────────────────
    await this._assertPropertyAccess(
      dashboard.property.id,
      inspectorId,
      inspectorRole,
    );

    // ── Validate scheduled inspection ───────────────────────────────────────
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
    if (activeSchedule.status === 'COMPLETE')
      throw new BadRequestException(
        'This inspection is already completed and cannot be edited.',
      );
    if (activeSchedule.status === 'ASSIGNED')
      throw new BadRequestException('Call /start endpoint first.');
    if (activeSchedule.status === 'DUE')
      throw new BadRequestException('Inspection overdue. Contact admin.');
    if (activeSchedule.status !== 'IN_PROGRESS')
      throw new BadRequestException('Invalid state for draft save.');

    // ── Extract criteria configs ─────────────────────────────────────────────
    const mediaSlots = criteria.mediaFields as unknown as MediaFieldSlot[];

    // ── Validate media sessions ──────────────────────────────────────────────
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
          status: 'COMPLETED',
        },
      });
      if (!session)
        throw new BadRequestException(
          `Invalid or incomplete upload session: ${sess.sessionId}`,
        );
    }

    // ── Build partial scores ─────────────────────────────────────────────────
    const categoryScores: Record<string, { score: number; notes?: string }> =
      {};
    if (dto.scores) {
      for (const [key, val] of Object.entries(dto.scores)) {
        categoryScores[key] = {
          score: val.score ?? 0,
          notes: val.notes ?? '',
        };
      }
    }

    // ── Format repair items ──────────────────────────────────────────────────
    const repairItems = (dto.repairItems ?? []).map((item, i) => ({
      id: `repair_${Date.now()}_${i}`,
      title: item.title,
      status: item.status,
      description: item.description ?? '',
    }));

    // Check for existing draft
    const existingDraft = await this.prisma.inspection.findFirst({
      where: {
        scheduledInspectionId,
        inspectorId,
        status: 'DRAFT',
      },
    });

    // ── Transaction: upsert draft inspection ─────────────────────────────────
    const { inspection } = await this.prisma.$transaction(async (tx) => {
      let inspection;

      if (existingDraft) {
        // ── UPDATE existing draft ──────────────────────────────────────────

        // Remove media files the user wants to delete
        if (dto.removeMediaFileIds?.length) {
          await tx.mediaFile.deleteMany({
            where: {
              id: { in: dto.removeMediaFileIds },
              inspectionId: existingDraft.id,
            },
          });
        }

        // CRITICAL FIX: Include scheduledInspectionId in update
        inspection = await tx.inspection.update({
          where: { id: existingDraft.id },
          data: {
            // IMPORTANT: Keep the scheduledInspectionId relation
            scheduledInspectionId, // ← ADD THIS LINE
            ...(dto.headerData && { headerData: dto.headerData as any }),
            ...(dto.scores && { scores: categoryScores as any }),
            ...(dto.repairItems && { repairItems: repairItems as any }),
            ...(dto.nteValue !== undefined && { nteValue: dto.nteValue }),
            ...(dto.additionalComments !== undefined && {
              additionalComments: dto.additionalComments,
            }),
            ...(dto.inspectedAt && {
              inspectedAt: new Date(dto.inspectedAt),
            }),
          },
        });
      } else {
        // ── CREATE new draft ───────────────────────────────────────────────
        inspection = await tx.inspection.create({
          data: {
            dashboardId,
            scheduledInspectionId, // ← CRITICAL: Link to scheduled inspection
            inspectorId,
            status: 'DRAFT',
            headerData: (dto.headerData ?? {}) as any,
            scores: (Object.keys(categoryScores).length
              ? categoryScores
              : {}) as any,
            repairItems: repairItems as any,
            nteValue: dto.nteValue ?? null,
            additionalComments: dto.additionalComments ?? null,
            overallScore: 0,
            totalScore: 0,
            overallScorePercentage: 0,
            healthLabel: null,
            remainingLife: null,
            inspectedAt: dto.inspectedAt
              ? new Date(dto.inspectedAt)
              : new Date(),
          },
        });
      }

      // ── Save embed fields ────────────────────────────────────────────────
      // Remove old embeds for this inspection
      await tx.mediaFile.deleteMany({
        where: {
          inspectionId: inspection.id,
          fileType: 'EMBED',
        },
      });

      // Save new embed fields
      for (const [mediaFieldKey, embedUrl] of Object.entries(
        dto.embedFields ?? {},
      )) {
        const slot = mediaSlots.find((s) => s.key === mediaFieldKey);
        if (!slot || slot.type !== 'embed') continue;

        await tx.mediaFile.create({
          data: {
            inspectionId: inspection.id,
            fileName: mediaFieldKey,
            fileType: 'EMBED',
            url: String(embedUrl),
            size: null,
            mediaFieldKey,
          },
        });
      }

      // ── Save new upload sessions as MediaFiles ───────────────────────────
      for (const sess of dto.mediaSessions ?? []) {
        const session = await tx.uploadSession.findUnique({
          where: { id: sess.sessionId },
        });
        if (!session) continue;

        // Prevent duplicate
        const alreadyLinked = await tx.mediaFile.findFirst({
          where: { inspectionId: inspection.id, url: session.key },
        });
        if (!alreadyLinked) {
          await tx.mediaFile.create({
            data: {
              inspectionId: inspection.id,
              fileName: session.fileName,
              fileType: this._resolveFileType(session.mimeType),
              url: session.key,
              size: session.fileSize,
              mediaFieldKey: sess.mediaFieldKey,
            },
          });
        }

        // Mark session as ASSIGNED
        await tx.uploadSession.update({
          where: { id: sess.sessionId },
          data: {
            status: 'ASSIGNED',
            inspectionId: inspection.id,
            mediaFieldKey: sess.mediaFieldKey,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
      }

      return { inspection };
    });

    // Fetch all media files for this draft
    const allMediaFiles = await this.prisma.mediaFile.findMany({
      where: { inspectionId: inspection.id },
    });

    return {
      success: true,
      message: existingDraft
        ? 'Draft updated successfully.'
        : 'Draft saved successfully.',
      data: {
        ...inspection,
        mediaFiles: allMediaFiles.map((file) => ({
          ...file,
          url:
            file.fileType === 'EMBED' ? file.url : this._getSignedUrl(file.url),
        })),
      },
    };
  }

  // ── getDraft ──────────────────────────────────────────────────────────────────
  async getDraft(
    dashboardId: string,
    scheduledInspectionId: string,
    inspectorId: string,
    inspectorRole: string,
  ) {
    const { dashboard } = await this._getCriteriaForDashboard(dashboardId);

    // ── Access check ────────────────────────────────────────────────────────
    await this._assertPropertyAccess(
      dashboard.property.id,
      inspectorId,
      inspectorRole,
    );

    // ── Validate scheduled inspection ownership ──────────────────────────────
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

    // ── Only the assigned inspector can see the draft ────────────────────────
    if (activeSchedule.assignedTo !== inspectorId)
      throw new ForbiddenException('You do not have access to this draft.');

    // ── Find draft ───────────────────────────────────────────────────────────
    const draft = await this.prisma.inspection.findFirst({
      where: {
        scheduledInspectionId,
        inspectorId,
        status: 'DRAFT',
      },
      include: {
        mediaFiles: true,
      },
    });

    // No draft yet — return null, frontend shows empty form
    if (!draft) {
      return {
        success: true,
        message: 'No draft found. Start filling in the inspection.',
        data: null,
      };
    }

    return {
      success: true,
      message: 'Draft retrieved successfully.',
      data: {
        ...draft,
        mediaFiles: draft.mediaFiles.map((file) => ({
          ...file,
          url:
            file.fileType === 'EMBED' ? file.url : this._getSignedUrl(file.url),
        })),
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

    const criteria = inspection.dashboard.property?.activeTemplate?.criteria;

    if (!criteria) {
      throw new BadRequestException('Criteria not found for this inspection');
    }

    const mediaSlots = (criteria.mediaFields ??
      []) as unknown as MediaFieldSlot[];
    const validSlotKeys = mediaSlots.map((s) => s.key);

    // ── Validate media sessions (new files) ───────────────────────────────
    for (const sess of dto.mediaSessions ?? []) {
      if (!validSlotKeys.includes(sess.mediaFieldKey)) {
        throw new BadRequestException(
          `Invalid mediaFieldKey: ${sess.mediaFieldKey}`,
        );
      }

      const session = await this.prisma.uploadSession.findFirst({
        where: {
          id: sess.sessionId,
          status: 'COMPLETED',
          expiresAt: { gt: new Date() },
        },
      });

      if (!session) {
        throw new BadRequestException(
          `Invalid or expired upload session: ${sess.sessionId}`,
        );
      }
    }

    // ── Get categories and thresholds for score calculation ────────────────
    const categories =
      criteria.scoringCategories as unknown as ScoringCategory[];
    const healthThresholdConfig =
      criteria.healthThresholdConfig as unknown as HealthThresholdConfigDto;

    // Calculate total possible score
    const totalPossibleScore = categories.reduce(
      (sum, cat) => sum + cat.maxPoints,
      0,
    );

    // ── Recompute score + health if scores changed ────────────────────────
    let overallScore = inspection.overallScore ?? 0;
    let overallScorePercentage = inspection.overallScorePercentage ?? 0;
    let healthLabel = inspection.healthLabel;
    let remainingLife = inspection.remainingLife;

    if (dto.scores) {
      // Get existing scores
      const existingScores = inspection.scores as Record<
        string,
        { score: number; notes?: string }
      >;

      // Calculate new overall score
      overallScore = categories.reduce((sum, cat) => {
        const newScore = dto.scores?.[cat.key]?.score;
        const existingScore = existingScores?.[cat.key]?.score;
        const score = newScore !== undefined ? newScore : (existingScore ?? 0);
        return sum + score;
      }, 0);

      // Validate scores don't exceed maxPoints
      for (const category of categories) {
        const newScore = dto.scores?.[category.key]?.score;
        if (newScore !== undefined) {
          if (newScore > category.maxPoints) {
            throw new BadRequestException(
              `Score for "${category.label}" is ${newScore} — max allowed is ${category.maxPoints}.`,
            );
          }
          if (newScore < 0) {
            throw new BadRequestException(
              `Score for "${category.label}" cannot be negative.`,
            );
          }
        }
      }

      // Calculate percentage
      overallScorePercentage =
        totalPossibleScore > 0
          ? Number(((overallScore / totalPossibleScore) * 100).toFixed(2))
          : 0;

      // ── Get roof system type from headerData (merged) ──────────────────────
      const existingHeaderData = inspection.headerData as Record<
        string,
        string
      >;
      const mergedHeaderData = {
        ...existingHeaderData,
        ...(dto.headerData ?? {}),
      };
      const roofSystemType = mergedHeaderData?.roofSystemType || 'Multiple';

      // Safely get thresholds with fallback
      let roofThresholds;
      if (healthThresholdConfig && healthThresholdConfig[roofSystemType]) {
        roofThresholds = healthThresholdConfig[roofSystemType];
      } else if (healthThresholdConfig && healthThresholdConfig['Multiple']) {
        roofThresholds = healthThresholdConfig['Multiple'];
      } else {
        // Fallback default thresholds
        roofThresholds = {
          good: {
            minScore: 70,
            maxScore: 100,
            remainingLifeMinYears: 20,
            remainingLifeMaxYears: 30,
          },
          fair: {
            minScore: 30,
            maxScore: 69,
            remainingLifeMinYears: 10,
            remainingLifeMaxYears: 20,
          },
          poor: {
            minScore: 0,
            maxScore: 29,
            remainingLifeMinYears: 0,
            remainingLifeMaxYears: 10,
          },
        };
      }

      // Calculate health label and remaining life
      healthLabel = 'Poor';
      remainingLife = `${roofThresholds.poor.remainingLifeMinYears}-${roofThresholds.poor.remainingLifeMaxYears} Years`;

      if (overallScore >= roofThresholds.good.minScore) {
        healthLabel = 'Good';
        remainingLife = `${roofThresholds.good.remainingLifeMinYears}-${roofThresholds.good.remainingLifeMaxYears} Years`;
      } else if (overallScore >= roofThresholds.fair.minScore) {
        healthLabel = 'Fair';
        remainingLife = `${roofThresholds.fair.remainingLifeMinYears}-${roofThresholds.fair.remainingLifeMaxYears} Years`;
      }
    }

    // ── Process repair items ────────────────────────────────────────────────
    let repairItems = undefined;
    if (dto.repairItems) {
      const repairConfig =
        criteria.repairPlanningConfig as unknown as RepairConfig;
      const { statuses } = repairConfig;

      // Validate repair item statuses
      for (const item of dto.repairItems) {
        if (!statuses.includes(item.status)) {
          throw new BadRequestException(
            `Repair status "${item.status}" is invalid. Allowed: ${statuses.join(', ')}.`,
          );
        }
      }

      repairItems = dto.repairItems.map((item, i) => ({
        id: `repair_${Date.now()}_${i}`,
        title: item.title,
        status: item.status,
        description: item.description ?? '',
      }));
    }

    // ── Merge scores if partial update ─────────────────────────────────────
    let mergedScores = undefined;
    if (dto.scores) {
      const existingScores = inspection.scores as Record<
        string,
        { score: number; notes?: string }
      >;
      mergedScores = {
        ...existingScores,
        ...dto.scores,
      };
    }

    // ── Merge header data if partial update ────────────────────────────────
    let mergedHeaderData = undefined;
    if (dto.headerData) {
      const existingHeaderData = inspection.headerData as Record<
        string,
        string
      >;
      mergedHeaderData = {
        ...existingHeaderData,
        ...dto.headerData,
      };
    }

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

        const savedMediaFiles: any[] = [];

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
              url: session.key,
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
            ...(mergedHeaderData && { headerData: mergedHeaderData as any }),
            ...(mergedScores && { scores: mergedScores as any }),
            ...(repairItems && { repairItems: repairItems as any }),
            ...(dto.nteValue !== undefined && { nteValue: dto.nteValue }),
            ...(dto.additionalComments !== undefined && {
              additionalComments: dto.additionalComments,
            }),
            // Always update score-related fields if scores changed
            ...(dto.scores && {
              overallScore,
              totalScore: totalPossibleScore,
              overallScorePercentage,
              healthLabel,
              remainingLife,
            }),
          },
          include: { mediaFiles: true },
        });

        // 5. Activity log
        const propertyName =
          inspection.dashboard.property?.name ?? 'Unknown Property';
        await tx.activityLog.create({
          data: {
            category: 'PROPERTY_DASHBOARD_UPDATE',
            actor_role: 'ADMIN',
            message: dto.scores
              ? `Inspection report for ${propertyName} was updated. Score: ${overallScore}/${totalPossibleScore} (${overallScorePercentage}%) - ${healthLabel}`
              : `Inspection report for ${propertyName} was updated (non-score fields only).`,
          },
        });

        return { updated, savedMediaFiles };
      },
    );

    // ── Return response with signed URLs ────────────────────────────────────
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
        summary: dto.scores
          ? {
              overallScore,
              totalScore: totalPossibleScore,
              overallScorePercentage,
              healthLabel,
              remainingLife,
            }
          : undefined,
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

  // async findOne(inspectionId: string, userId: string, role: string) {
  //   const inspection = await this.prisma.inspection.findUnique({
  //     where: { id: inspectionId },
  //     include: {
  //       inspector: {
  //         select: { id: true, username: true, email: true, avatar: true },
  //       },
  //       mediaFiles: true,
  //       dashboard: { include: { property: { select: { id: true } } } },
  //     },
  //   });
  //   if (!inspection) throw new NotFoundException('Inspection not found.');

  //   // ── Access check ──────────────────────────────────────────────────────
  //   await this._assertPropertyAccess(
  //     inspection.dashboard.property.id,
  //     userId,
  //     role,
  //   );

  //   return {
  //     success: true,
  //     message: 'Inspection retrieved',
  //     data: {
  //       ...inspection,
  //       mediaFiles: inspection.mediaFiles.map((file) => ({
  //         ...file,
  //         url:
  //           file.fileType === 'EMBED' ? file.url : this._resolveUrl(file.url),
  //       })),
  //     },
  //   };
  // }

  async findOne(
    userId: string,
    role: string,
    inspectionId?: string,
    scheduledInspectionId?: string,
  ) {
    // At least one must be provided
    if (!inspectionId && !scheduledInspectionId)
      throw new BadRequestException(
        'Provide either inspectionId or scheduledInspectionId.',
      );

    // ── PATH A: scheduledInspectionId provided ────────────────────────────
    if (scheduledInspectionId) {
      const scheduled = await this.prisma.scheduledInspection.findUnique({
        where: { id: scheduledInspectionId },
        include: {
          dashboard: {
            include: { property: { select: { id: true } } },
          },
        },
      });

      if (!scheduled)
        throw new NotFoundException(
          `Scheduled inspection "${scheduledInspectionId}" not found.`,
        );

      // Access check
      await this._assertPropertyAccess(
        scheduled.dashboard.property.id,
        userId,
        role,
      );

      // Assigned inspector → check for their draft first
      if (role === 'OPERATIONAL' && scheduled.assignedTo === userId) {
        const draft = await this.prisma.inspection.findFirst({
          where: {
            scheduledInspectionId,
            inspectorId: userId,
            status: 'DRAFT',
          },
          include: {
            inspector: {
              select: { id: true, username: true, email: true, avatar: true },
            },
            mediaFiles: true,
          },
        });

        if (draft) {
          return {
            success: true,
            message: 'Draft inspection retrieved.',
            data: {
              ...draft,
              isDraft: true,
              mediaFiles: draft.mediaFiles.map((file) => ({
                ...file,
                url:
                  file.fileType === 'EMBED'
                    ? file.url
                    : this._resolveUrl(file.url),
              })),
            },
          };
        }
      }

      // No draft (or not assigned inspector) → fall to completed inspection
      const resolvedInspectionId = scheduled.inspectionId ?? inspectionId;

      if (!resolvedInspectionId) {
        return {
          success: true,
          message: 'No inspection data found yet.',
          data: null,
        };
      }

      // Load completed inspection
      const inspection = await this.prisma.inspection.findUnique({
        where: { id: resolvedInspectionId },
        include: {
          inspector: {
            select: { id: true, username: true, email: true, avatar: true },
          },
          mediaFiles: true,
        },
      });

      if (!inspection) throw new NotFoundException('Inspection not found.');

      return {
        success: true,
        message: 'Inspection retrieved.',
        data: {
          ...inspection,
          isDraft: false,
          mediaFiles: inspection.mediaFiles.map((file) => ({
            ...file,
            url:
              file.fileType === 'EMBED' ? file.url : this._resolveUrl(file.url),
          })),
        },
      };
    }

    // ── PATH B: only inspectionId provided ───────────────────────────────
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

    await this._assertPropertyAccess(
      inspection.dashboard.property.id,
      userId,
      role,
    );

    return {
      success: true,
      message: 'Inspection retrieved.',
      data: {
        ...inspection,
        isDraft: false,
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
          createdByUser: {
            // ← Use createdByUser, not creator
            select: { id: true, username: true },
          },
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
        createdBy: s.createdByUser,
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

        createdByUser: {
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
        createdBy: scheduled.createdByUser,

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

  private _resolveUrl(key: string): string {
    const isDevelopment = appConfig().app.node_env === 'development';

    if (isDevelopment) {
      // Development: use local  MinIO IP
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

  private _getSignedUrl(key: string): string {
    // Same as _resolveUrl for MinIO (since files are public or use presigned URLs)
    return this._resolveUrl(key);
  }
}
