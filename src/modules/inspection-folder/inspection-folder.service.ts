import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ActivityCategory } from 'prisma/generated/enums';
import { Role } from 'src/common/guard/role/role.enum';
import {
  CreateFolderDto,
  UpdateFolderDto,
  AddInspectionsToFolderDto,
} from './dto/inspection-folder.dto';

@Injectable()
export class InspectionFolderService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── 1. GET ALL FOLDERS FOR A DASHBOARD ────────────────────────────────────
  // Shown as the folder cards row in Image 1 (2023/2024/2025/2026 Inspection)

  async getFolders(dashboardId: string) {
    await this._assertDashboardExists(dashboardId);

    const folders = await this.prisma.inspectionFolder.findMany({
      where: { dashboardId },
      include: {
        items: {
          include: {
            inspection: {
              select: {
                id: true,
                status: true,
                overallScore: true,
                healthLabel: true,
                inspectedAt: true,
                mediaFiles: { select: { id: true, size: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      message: 'Folders retrieved successfully',
      data: folders.map((f) => {
        const totalBytes = f.items.reduce(
          (sum, i) =>
            sum +
            i.inspection.mediaFiles.reduce((s, m) => s + (m.size ?? 0), 0),
          0,
        );

        return {
          id: f.id,
          name: f.name,
          dashboardId: f.dashboardId,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
          inspectionCount: f.items.length, // number of inspection reports in folder
          fileCount: f.items.reduce(
            // number of uploaded media files only
            (sum, i) => sum + i.inspection.mediaFiles.length,
            0,
          ),
          totalSizeBytes: totalBytes, // raw bytes if frontend wants to format itself
          totalSizeLabel: this._formatSize(totalBytes), // e.g. "1.2 GB"
        };
      }),
    };
  }

  // ─── 2. GET SINGLE FOLDER WITH INSPECTIONS ──────────────────────────────────

  async getFolder(folderId: string) {
    const folder = await this.prisma.inspectionFolder.findUnique({
      where: { id: folderId },
      include: {
        items: {
          include: {
            inspection: {
              include: {
                inspector: { select: { id: true, name: true, avatar: true } },
                mediaFiles: true,
              },
            },
          },
          orderBy: { addedAt: 'desc' },
        },
      },
    });

    if (!folder) throw new NotFoundException('Folder not found.');

    return {
      success: true,
      message: 'Folder retrieved successfully',
      data: {
        id: folder.id,
        name: folder.name,
        dashboardId: folder.dashboardId,
        createdAt: folder.createdAt,
        inspections: folder.items.map((i) => i.inspection),
      },
    };
  }

  // Already implemented — no changes needed
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

  // ─── 3. CREATE FOLDER ───────────────────────────────────────────────────────
  // Image 2 & 3: "Create New Folder" modal — name + optional inspection selection

  async createFolder(
    dashboardId: string,
    dto: CreateFolderDto,
    adminId: string,
  ) {
    await this._assertDashboardExists(dashboardId);

    // Validate inspection IDs belong to this dashboard
    if (dto.inspectionIds?.length) {
      await this._assertInspectionsBelongToDashboard(
        dashboardId,
        dto.inspectionIds,
      );
    }

    const folder = await this.prisma.inspectionFolder.create({
      data: {
        dashboardId,
        name: dto.name,
        items: dto.inspectionIds?.length
          ? {
              create: dto.inspectionIds.map((inspectionId) => ({
                inspectionId,
              })),
            }
          : undefined,
      },
      include: {
        items: {
          include: { inspection: { select: { id: true, status: true } } },
        },
      },
    });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: Role.ADMIN,
        message: `Folder "${folder.name}" created on dashboard`,
      },
    });

    return {
      success: true,
      message: 'Folder created successfully',
      data: folder,
    };
  }

  // ─── 4. RENAME FOLDER ──────────────────────────────────────────────────────
  // Image 1: "Edit" option in folder kebab menu

  async updateFolder(folderId: string, dto: UpdateFolderDto, adminId: string) {
    const folder = await this._assertFolderExists(folderId);

    const updated = await this.prisma.inspectionFolder.update({
      where: { id: folderId },
      data: { name: dto.name },
    });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: Role.ADMIN,
        message: `Folder renamed from "${folder.name}" to "${dto.name}"`,
      },
    });

    return {
      success: true,
      message: 'Folder renamed successfully',
      data: updated,
    };
  }

  // ─── 5. DELETE FOLDER (not the inspections) ────────────────────────────────
  // Image 5: "Delete Folder" confirmation modal
  // onDelete: Cascade on InspectionFolderItem handles join rows automatically

  async deleteFolder(folderId: string, adminId: string) {
    const folder = await this._assertFolderExists(folderId);

    await this.prisma.inspectionFolder.delete({ where: { id: folderId } });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: Role.ADMIN,
        message: `Folder "${folder.name}" deleted`,
      },
    });

    return {
      success: true,
      message: 'Folder deleted. Inspection reports are preserved.',
    };
  }

  // ─── 6. ADD INSPECTIONS TO FOLDER ──────────────────────────────────────────
  // Image 3: checkbox selection + "Select" button

  async addInspections(
    folderId: string,
    dto: AddInspectionsToFolderDto,
    adminId: string,
  ) {
    const folder = await this._assertFolderExists(folderId);

    await this._assertInspectionsBelongToDashboard(
      folder.dashboardId,
      dto.inspectionIds,
    );

    // Skip already-linked inspections to avoid unique constraint error
    const existing = await this.prisma.inspectionFolderItem.findMany({
      where: { folderId, inspectionId: { in: dto.inspectionIds } },
      select: { inspectionId: true },
    });
    const existingIds = new Set(existing.map((e) => e.inspectionId));
    const toAdd = dto.inspectionIds.filter((id) => !existingIds.has(id));

    if (!toAdd.length) {
      throw new BadRequestException(
        'All selected inspections are already in this folder.',
      );
    }

    await this.prisma.inspectionFolderItem.createMany({
      data: toAdd.map((inspectionId) => ({ folderId, inspectionId })),
    });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: Role.ADMIN,
        message: `${toAdd.length} inspection report(s) added to folder "${folder.name}"`,
      },
    });

    return {
      success: true,
      message: `${toAdd.length} inspection(s) added to folder.`,
    };
  }

  // ─── 7. REMOVE INSPECTION FROM FOLDER ──────────────────────────────────────
  // Image 4: trash icon next to each inspection inside the folder

  async removeInspection(
    folderId: string,
    inspectionId: string,
    adminId: string,
  ) {
    const folder = await this._assertFolderExists(folderId);

    const item = await this.prisma.inspectionFolderItem.findUnique({
      where: { folderId_inspectionId: { folderId, inspectionId } },
    });

    if (!item)
      throw new NotFoundException('Inspection not found in this folder.');

    await this.prisma.inspectionFolderItem.delete({
      where: { folderId_inspectionId: { folderId, inspectionId } },
    });

    await this.prisma.activityLog.create({
      data: {
        category: ActivityCategory.PROPERTY_DASHBOARD_UPDATE,
        actor_role: Role.ADMIN,
        message: `Inspection report removed from folder "${folder.name}"`,
      },
    });

    return {
      success: true,
      message: 'Inspection removed from folder. Report is preserved.',
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

  private async _assertFolderExists(folderId: string) {
    const folder = await this.prisma.inspectionFolder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('Folder not found.');
    return folder;
  }

  private async _assertInspectionsBelongToDashboard(
    dashboardId: string,
    inspectionIds: string[],
  ) {
    const inspections = await this.prisma.inspection.findMany({
      where: { id: { in: inspectionIds }, dashboardId },
      select: { id: true },
    });

    if (inspections.length !== inspectionIds.length) {
      const foundIds = new Set(inspections.map((i) => i.id));
      const invalid = inspectionIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(
        `These inspections do not belong to this dashboard: ${invalid.join(', ')}`,
      );
    }
  }

  private _formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
