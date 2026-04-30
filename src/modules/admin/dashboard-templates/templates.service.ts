import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  AddTextFieldDto,
  AddMediaFieldDto,
  UpdateSectionStyleDto,
  SectionType,
  TemplateSectionDto,
  CreateInitialDashboardTemplate,
  PatchSectionsDto,
} from './dto/create-templates.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { TemplateStatus } from 'prisma/generated/enums';
import { Prisma } from 'prisma/generated/client';
import { UpdateDashboardTemplateDto } from './dto/update-templates.dto';

// ─── Internal section shape stored in DB JSON ─────────────────────────────────

interface StoredSection {
  order: number;
  type: SectionType;
  label: string;
  isDynamic: boolean;
  config: Record<string, unknown>;
  style: Record<string, unknown>;
}

// ─── Fixed sections always injected into every template ───────────────────────

const DEFAULT_TEMPLATE_SECTIONS: StoredSection[] = [
  {
    order: 1,
    type: SectionType.HEADER_INFO,
    label: 'Property Info',
    isDynamic: false,
    config: {
      fields: [
        'propertyName',
        'address',
        'propertyType',
        'inspectionId',
        'inspectorName',
        'inspectionDate',
        'lastInspectionDate',
      ],
    },
    style: { width: 'full' },
  },
  {
    order: 2,
    type: SectionType.HEALTH_SNAPSHOT,
    label: 'Roof Health Snapshot',
    isDynamic: false,
    config: {
      showHealthLabel: true,
      showAverageScore: true,
      showOverallScore: true,
      showRemainingLife: true,
    },
    style: { width: '1/3' },
  },
  {
    order: 3,
    type: SectionType.MEDIA_GRID,
    label: 'Media Files',
    isDynamic: false,
    config: {
      layout: 'grid',
      maxVisible: 4,
      allowedTypes: ['PHOTO', 'VIDEO'],
    },
    style: { width: '2/3' },
  },
  {
    order: 4,
    type: SectionType.TOUR_3D,
    label: '3D Roof Tour',
    isDynamic: false,
    config: {
      embedType: 'iframe',
      placeholder: 'No 3D tour available for this inspection.',
    },
    style: { width: '1/2' },
  },
  {
    order: 5,
    type: SectionType.AERIAL_MAP,
    label: 'Aerial Map',
    isDynamic: false,
    config: {
      embedType: 'url',
      placeholder: 'No aerial map available for this inspection.',
    },
    style: { width: '1/2' },
  },
  {
    order: 6,
    type: SectionType.ROOF_HEALTH_RATING,
    label: 'Roof Health Rating',
    isDynamic: false,
    config: {
      showNotes: true,
      showMaxPoints: true,
    },
    style: { width: 'full' },
  },
  {
    order: 7,
    type: SectionType.REPAIR_PLANNING,
    label: 'Priority Repair Planning',
    isDynamic: false,
    config: {},
    style: { width: 'full' },
  },
  {
    order: 8,
    type: SectionType.DOCUMENTS,
    label: 'Documents',
    isDynamic: false,
    config: {
      pageSize: 5,
      showVersion: true,
      showFileSize: true,
      showUploadDate: true,
      allowInBrowserView: true,
    },
    style: { width: 'full' },
  },
  {
    order: 9,
    type: SectionType.ADDITIONAL_INFO,
    label: 'Additional Information',
    isDynamic: false,
    config: {
      fields: ['nteValue', 'additionalComments'],
      nteCurrency: 'USD',
    },
    style: { width: 'full' },
  },
];

// ─── Inline response helper ───────────────────────────────────────────────────

function ok<T>(message: string, data?: T) {
  return {
    success: true,
    message,
    ...(data !== undefined && { data }),
  };
}

// ─── Helper: cast StoredSection[] to Prisma-safe InputJsonValue ───────────────

function toJson(sections: StoredSection[]): Prisma.InputJsonValue {
  return sections as unknown as Prisma.InputJsonValue;
}

// ─── Helper: safely cast Prisma Json field back to StoredSection[] ────────────

function fromJson(value: unknown): StoredSection[] {
  return (value as unknown as StoredSection[]) ?? [];
}

@Injectable()
export class DashboardTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(dto: CreateInitialDashboardTemplate) {
    // Get the single inspection criteria record
    const criteria = await this.prisma.inspectionCriteria.findFirst();

    if (!criteria) {
      throw new NotFoundException(
        'No inspection criteria found. Please ensure inspection criteria is seeded first.',
      );
    }

    // Check if template name is unique
    await this.assertNameIsUnique(dto.name);

    // Deactivate all existing templates
    await this.prisma.dashboardTemplate.updateMany({
      where: {
        status: TemplateStatus.ACTIVE,
      },
      data: {
        status: TemplateStatus.INACTIVE,
      },
    });

    // Create new template with ACTIVE status
    const template = await this.prisma.dashboardTemplate.create({
      data: {
        name: dto.name,
        criteriaId: criteria.id,
        status: TemplateStatus.ACTIVE,
        sections: toJson(DEFAULT_TEMPLATE_SECTIONS), // Pre-populate with default sections
      },
    });

    // Return only the needed fields
    return ok('Dashboard template created successfully', {
      id: template.id,
      name: template.name,
      status: template.status,
    });
  }
  // ─── Find All ─────────────────────────────────────────────────────────────

  async findAll(status?: TemplateStatus) {
    const templates = await this.prisma.dashboardTemplate.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        criteria: true,
        _count: { select: { properties: true } },
      },
    });

    return ok(
      templates.length
        ? 'Dashboard templates retrieved successfully'
        : 'No dashboard templates found',
      templates,
    );
  }

  // ─── Find One (internal — raw record, used by other methods) ─────────────

  async findOne(id: string) {
    const template = await this.prisma.dashboardTemplate.findUnique({
      where: { id },
      include: {
        criteria: true,
        properties: {
          select: { id: true, name: true, createdAt: true },
        },
      },
    });

    if (!template) {
      throw new NotFoundException(
        `Dashboard template with id "${id}" not found`,
      );
    }

    return template;
  }

  // ─── Find One Response (public — wrapped) ─────────────────────────────────

  async findOneResponse(id: string) {
    const template = await this.findOne(id);
    return ok('Dashboard template retrieved successfully', template);
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateDashboardTemplateDto) {
    await this.findOne(id);

    if (dto.name) await this.assertNameIsUnique(dto.name, id);
    if (dto.criteriaId) await this.findCriteriaOrThrow(dto.criteriaId);

    let sections: StoredSection[] | undefined;
    if (dto.sections) {
      const merged = this.mergeWithFixedSections(dto.sections);
      sections = this.sortSections(merged);
    }

    const updated = await this.prisma.dashboardTemplate.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.status && { status: dto.status }),
        ...(sections && { sections: toJson(sections) }),
        // criteriaId uses connect to avoid XOR conflict
        ...(dto.criteriaId && {
          criteria: { connect: { id: dto.criteriaId } },
        }),
      },
      include: {
        criteria: true,
        _count: { select: { properties: true } },
      },
    });

    return ok('Dashboard template updated successfully', updated);
  }

  // ─── Add Text Field ───────────────────────────────────────────────────────

  async addTextField(id: string, dto: AddTextFieldDto) {
    const template = await this.findOne(id);
    const sections = fromJson(template.sections);

    const newSection: StoredSection = {
      order: this.nextDynamicOrder(sections),
      type: SectionType.TEXT_FIELD,
      label: dto.label,
      isDynamic: true,
      config: {
        label: dto.label,
        placeholder: dto.placeholder ?? '',
      },
      style: (dto.style as Record<string, unknown>) ?? {},
    };

    const updated = await this.prisma.dashboardTemplate.update({
      where: { id },
      data: {
        sections: toJson(this.sortSections([...sections, newSection])),
      },
      include: {
        criteria: true,
        _count: { select: { properties: true } },
      },
    });

    return ok('Text field section added successfully', updated);
  }

  // ─── Add Media Field ──────────────────────────────────────────────────────

  async addMediaField(id: string, dto: AddMediaFieldDto) {
    const template = await this.findOne(id);
    const sections = fromJson(template.sections);

    const newSection: StoredSection = {
      order: this.nextDynamicOrder(sections),
      type: SectionType.MEDIA_FIELD,
      label: dto.title,
      isDynamic: true,
      config: {
        title: dto.title,
        mediaType: dto.mediaType,
        ...(dto.embedUrl && { embedUrl: dto.embedUrl }),
      },
      style: (dto.style as Record<string, unknown>) ?? {},
    };

    const updated = await this.prisma.dashboardTemplate.update({
      where: { id },
      data: {
        sections: toJson(this.sortSections([...sections, newSection])),
      },
      include: {
        criteria: true,
        _count: { select: { properties: true } },
      },
    });

    return ok('Media field section added successfully', updated);
  }

  // ─── Remove Dynamic Section ───────────────────────────────────────────────

  async removeDynamicSection(id: string, sectionOrder: number) {
    const template = await this.findOne(id);
    const sections = fromJson(template.sections);

    const target = sections.find((s) => s.order === sectionOrder);

    if (!target) {
      throw new NotFoundException(
        `Section with order ${sectionOrder} not found`,
      );
    }

    if (!target.isDynamic) {
      throw new BadRequestException(
        `Section "${target.label}" is a fixed section and cannot be removed`,
      );
    }

    const updated = await this.prisma.dashboardTemplate.update({
      where: { id },
      data: {
        sections: toJson(
          this.renumberSections(
            sections.filter((s) => s.order !== sectionOrder),
          ),
        ),
      },
      include: {
        criteria: true,
        _count: { select: { properties: true } },
      },
    });

    return ok('Section removed successfully', updated);
  }

  // ─── Update Section Style ─────────────────────────────────────────────────

  async updateSectionStyle(id: string, dto: UpdateSectionStyleDto) {
    const template = await this.findOne(id);
    const sections = fromJson(template.sections);

    const sectionIndex = sections.findIndex((s) => s.order === dto.order);

    if (sectionIndex === -1) {
      throw new NotFoundException(`Section with order ${dto.order} not found`);
    }

    // Deep-merge: only provided style fields are overwritten
    sections[sectionIndex] = {
      ...sections[sectionIndex],
      style: this.deepMerge(
        sections[sectionIndex].style,
        dto.style as unknown as Record<string, unknown>,
      ),
    };

    const updated = await this.prisma.dashboardTemplate.update({
      where: { id },
      data: { sections: toJson(sections) },
      include: {
        criteria: true,
        _count: { select: { properties: true } },
      },
    });

    return ok('Section style updated successfully', updated);
  }

  // ─── Update Section Layout (width / label) ────────────────────────────────────

  async patchSections(id: string, dto: PatchSectionsDto) {
    const template = await this.findOne(id);
    let sections = fromJson(template.sections);

    // ── Step 1: reorder ──────────────────────────────────────────────────────
    if (dto.order) {
      for (const type of dto.order) {
        if (!sections.find((s) => s.type === type)) {
          throw new NotFoundException(`Section type "${type}" not found`);
        }
      }

      const orderedTypes = new Set(dto.order);

      const reordered = dto.order.map((type, index) => ({
        ...sections.find((s) => s.type === type)!,
        order: index + 1,
      }));

      const rest = sections
        .filter((s) => !orderedTypes.has(s.type))
        .map((s, i) => ({ ...s, order: reordered.length + i + 1 }));

      sections = [...reordered, ...rest];
    }

    // ── Step 2: label / width ────────────────────────────────────────────────
    if (dto.sections?.length) {
      for (const patch of dto.sections) {
        const sectionIndex = sections.findIndex((s) => s.type === patch.type);

        if (sectionIndex === -1) {
          throw new NotFoundException(`Section type "${patch.type}" not found`);
        }

        const section = { ...sections[sectionIndex] };

        if (patch.width !== undefined) {
          section.style = { ...section.style, width: patch.width };
        }

        if (patch.label !== undefined) {
          section.label = patch.label;
          if (section.config?.label !== undefined) {
            section.config = { ...section.config, label: patch.label };
          }
        }

        sections[sectionIndex] = section;
      }
    }

    const updated = await this.prisma.dashboardTemplate.update({
      where: { id },
      data: { sections: toJson(sections) },
      include: { criteria: true, _count: { select: { properties: true } } },
    });

    return ok('Sections updated successfully', updated);
  }

  // ─── Toggle Status ──────────────────────────────────────────────────────────────

  async toggleStatus(id: string) {
    const template = await this.findOne(id);

    return await this.prisma.$transaction(async (tx) => {
      // If currently ACTIVE → make it INACTIVE
      if (template.status === TemplateStatus.ACTIVE) {
        const updated = await tx.dashboardTemplate.update({
          where: { id },
          data: { status: TemplateStatus.INACTIVE },
          include: {
            criteria: true,
            _count: { select: { properties: true } },
          },
        });

        return ok('Dashboard template set to INACTIVE', updated);
      }

      // If currently INACTIVE → make this ACTIVE and others INACTIVE
      await tx.dashboardTemplate.updateMany({
        where: {
          id: { not: id },
          status: TemplateStatus.ACTIVE,
        },
        data: { status: TemplateStatus.INACTIVE },
      });

      const updated = await tx.dashboardTemplate.update({
        where: { id },
        data: { status: TemplateStatus.ACTIVE },
        include: {
          criteria: true,
          _count: { select: { properties: true } },
        },
      });

      return ok('Dashboard template set to ACTIVE', updated);
    });
  }

  // ─── Duplicate ────────────────────────────────────────────────────────────

  async duplicate(id: string, newName: string) {
    const source = await this.findOne(id);
    await this.assertNameIsUnique(newName);

    const duplicated = await this.prisma.dashboardTemplate.create({
      data: {
        name: newName,
        criteriaId: source.criteriaId,
        status: TemplateStatus.ACTIVE,
        sections: source.sections as Prisma.InputJsonValue,
      },
      include: {
        criteria: true,
        _count: { select: { properties: true } },
      },
    });

    return ok('Dashboard template duplicated successfully', duplicated);
  }

  // ─── Hard Delete ──────────────────────────────────────────────────────────

  async remove(id: string) {
    const template = await this.prisma.dashboardTemplate.findUnique({
      where: { id },
      include: { _count: { select: { properties: true } } },
    });

    if (!template) {
      throw new NotFoundException(
        `Dashboard template with id "${id}" not found`,
      );
    }

    if (template._count.properties > 0) {
      throw new ConflictException(
        `Cannot delete template "${template.name}" — it is assigned to ` +
          `${template._count.properties} ` +
          `propert${template._count.properties === 1 ? 'y' : 'ies'}. ` +
          `Archive it instead.`,
      );
    }

    await this.prisma.dashboardTemplate.delete({ where: { id } });

    return ok('Dashboard template deleted successfully');
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Ensures all 3 fixed sections are always present.
   * Caller-provided values are preserved; missing ones are auto-injected.
   */
  private mergeWithFixedSections(
    incoming: TemplateSectionDto[],
  ): StoredSection[] {
    const result: StoredSection[] = incoming.map((s) => ({
      order: s.order,
      type: s.type,
      label: s.label,
      isDynamic: s.isDynamic,
      config: (s.config as Record<string, unknown>) ?? {},
      style: (s.style as unknown as Record<string, unknown>) ?? {},
    }));

    const existingTypes = new Set(result.map((s) => s.type));

    for (const fixed of DEFAULT_TEMPLATE_SECTIONS) {
      if (!existingTypes.has(fixed.type)) {
        result.push({ ...fixed });
      }
    }

    return result;
  }

  private sortSections(sections: StoredSection[]): StoredSection[] {
    return [...sections].sort((a, b) => a.order - b.order);
  }

  /**
   * Dynamic sections slot before fixed sections (order 100+).
   */
  private nextDynamicOrder(sections: StoredSection[]): number {
    const dynamicOrders = sections
      .filter((s) => s.isDynamic)
      .map((s) => s.order);
    return dynamicOrders.length > 0 ? Math.max(...dynamicOrders) + 1 : 1;
  }

  /**
   * Close order gaps after a deletion.
   * Fixed sections keep their high-order values (100+).
   */
  private renumberSections(sections: StoredSection[]): StoredSection[] {
    const dynamic = sections
      .filter((s) => s.isDynamic)
      .map((s, i) => ({ ...s, order: i + 1 }));

    const fixed = sections.filter((s) => !s.isDynamic);

    return this.sortSections([...dynamic, ...fixed]);
  }

  private deepMerge(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...base };
    for (const key of Object.keys(override)) {
      if (
        typeof override[key] === 'object' &&
        override[key] !== null &&
        !Array.isArray(override[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null
      ) {
        result[key] = this.deepMerge(
          result[key] as Record<string, unknown>,
          override[key] as Record<string, unknown>,
        );
      } else {
        result[key] = override[key];
      }
    }
    return result;
  }

  private async assertNameIsUnique(name: string, excludeId?: string) {
    const existing = await this.prisma.dashboardTemplate.findFirst({
      where: {
        name,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });

    if (existing) {
      throw new ConflictException(
        `A dashboard template named "${name}" already exists`,
      );
    }
  }

  private async findCriteriaOrThrow(criteriaId: string) {
    const criteria = await this.prisma.inspectionCriteria.findUnique({
      where: { id: criteriaId },
    });

    if (!criteria) {
      throw new NotFoundException(
        `InspectionCriteria with id "${criteriaId}" not found`,
      );
    }

    return criteria;
  }
}
