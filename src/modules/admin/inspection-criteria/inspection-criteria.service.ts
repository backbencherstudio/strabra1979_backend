import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateInspectionCriteriaDto,
  UpdateInspectionCriteriaDto,
  AddHeaderFieldDto,
  UpdateHeaderFieldDto,
  AddScoringCategoryDto,
  UpdateScoringCategoryDto,
  AddMediaFieldDto,
  UpdateMediaFieldDto,
  UpdateNteConfigDto,
  UpdateAdditionalNotesConfigDto,
  UpdateRepairPlanningConfigDto,
  UpdateHealthThresholdConfigDto,
} from './dto/inspection-criteria.dto';

// ─── Internal types ───────────────────────────────────────────────────────────

interface HeaderField {
  key: string;
  label: string;
  type: 'text' | 'dropdown';
  placeholder: string;
  required: boolean;
  isSystem: boolean;
  order: number;
  options: string[] | null;
}

interface ScoringCategory {
  key: string;
  label: string;
  maxPoints: number;
  isSystem: boolean;
  order: number;
}

interface MediaField {
  key: string;
  label: string;
  placeholder: string;
  type: 'file' | 'embed' | 'document';
  isSystem: boolean;
  order: number;
  accept: string[] | null;
}

interface AdditionalNotesConfig {
  label: string;
  placeholder: string;
}

interface RepairPlanningConfig {
  status: string;
}

interface HealthTier {
  minScore: number;
  maxScore: number;
  remainingLifeMinYears: number;
  remainingLifeMaxYears: number;
}

interface HealthThresholdConfig {
  good: HealthTier;
  fair: HealthTier;
  poor: HealthTier;
}

@Injectable()
export class InspectionCriteriaService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CRITERIA — CRUD
  // ─────────────────────────────────────────────────────────────────────────

  async create(dto: CreateInspectionCriteriaDto) {
    // Guard: unique keys within each array
    this._assertUniqueKeys(
      dto.headerFields.map((f) => f.key),
      'headerFields',
    );
    this._assertUniqueKeys(
      dto.scoringCategories.map((c) => c.key),
      'scoringCategories',
    );
    this._assertUniqueKeys(
      dto.mediaFields.map((m) => m.key),
      'mediaFields',
    );

    // Guard: total scoring points <= 100
    const totalPoints = dto.scoringCategories.reduce(
      (sum, c) => sum + c.maxPoints,
      0,
    );
    if (totalPoints > 100) {
      throw new BadRequestException(
        `Total scoringCategories maxPoints is ${totalPoints} — must not exceed 100.`,
      );
    }

    // Guard: health tier score ranges must not overlap and must cover 0–100
    this._assertHealthTiers(dto.healthThresholdConfig);

    // Map user input → internal shapes (isSystem=true, order from array position)
    const headerFields: HeaderField[] = dto.headerFields.map((f, i) => ({
      key: f.key,
      label: f.label,
      type: f.isDropdown ? 'dropdown' : 'text',
      placeholder: f.placeholder ?? '',
      required: f.required,
      isSystem: true,
      order: i + 1,
      options: f.isDropdown ? (f.options ?? null) : null,
    }));

    const scoringCategories: ScoringCategory[] = dto.scoringCategories.map(
      (c, i) => ({
        key: c.key,
        label: c.label,
        maxPoints: c.maxPoints,
        isSystem: true,
        order: i + 1,
      }),
    );

    const mediaFields: MediaField[] = dto.mediaFields.map((m, i) => ({
      key: m.key,
      label: m.label,
      placeholder: m.placeholder ?? '',
      type: m.isMediaFile ? 'file' : m.isEmbedded ? 'embed' : 'document',
      isSystem: true,
      order: i + 1,
      accept: m.isMediaFile ? (m.accept ?? null) : null,
    }));

    const additionalNotesConfig: AdditionalNotesConfig = {
      label: dto.additionalNotesConfig.label ?? 'Additional Notes/Comments',
      placeholder:
        dto.additionalNotesConfig.placeholder ??
        'Type Any Additional Notes/Comments',
    };

    const healthThresholdConfig: HealthThresholdConfig = {
      good: { ...dto.healthThresholdConfig.good },
      fair: { ...dto.healthThresholdConfig.fair },
      poor: { ...dto.healthThresholdConfig.poor },
    };

    const result = await this.prisma.inspectionCriteria.create({
      data: {
        name: dto.name,
        description: dto.description,
        headerFields: headerFields as any,
        scoringCategories: scoringCategories as any,
        mediaFields: mediaFields as any,
        additionalNotesConfig: additionalNotesConfig as any,
        healthThresholdConfig: healthThresholdConfig as any,
      },
    });

    return {
      success: true,
      message: 'Inspection criteria created successfully',
      data: result,
    };
  }

  async findAll() {
    const result = await this.prisma.inspectionCriteria.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      message: 'Inspection criteria retrieved successfully',
      data: result,
    };
  }

  async findOne(id: string) {
    const result = await this._assertCriteriaExists(id);
    return {
      success: true,
      message: 'Inspection criteria retrieved successfully',
      data: result,
    };
  }

  async update(id: string, dto: UpdateInspectionCriteriaDto) {
    await this._assertCriteriaExists(id);
    const result = await this.prisma.inspectionCriteria.update({
      where: { id },
      data: { ...dto },
    });
    return {
      success: true,
      message: 'Inspection criteria updated successfully',
      data: result,
    };
  }

  async remove(id: string) {
    await this._assertCriteriaExists(id);

    const usedInTemplate = await this.prisma.dashboardTemplate.findFirst({
      where: { criteriaId: id },
    });
    if (usedInTemplate) {
      throw new BadRequestException(
        'Cannot delete criteria. It is used by one or more dashboard templates.',
      );
    }

    const result = await this.prisma.inspectionCriteria.delete({
      where: { id },
    });
    return {
      success: true,
      message: 'Inspection criteria deleted successfully',
      data: result,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HEADER FIELDS
  // ─────────────────────────────────────────────────────────────────────────

  async getHeaderFields(criteriaId: string) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    return {
      success: true,
      message: 'Header fields retrieved successfully',
      data: criteria.headerFields,
    };
  }

  async addHeaderField(criteriaId: string, dto: AddHeaderFieldDto) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const fields = criteria.headerFields as unknown as HeaderField[];

    const newField: HeaderField = {
      key: `custom_${Date.now()}`,
      label: dto.label,
      type: dto.isDropdown ? 'dropdown' : 'text',
      placeholder: dto.placeholder ?? '',
      required: dto.required,
      isSystem: false,
      order: fields.length + 1,
      options: dto.isDropdown ? (dto.options ?? null) : null,
    };

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { headerFields: [...fields, newField] as any },
    });

    return {
      success: true,
      message: 'Header field added successfully',
      data: updated.headerFields,
    };
  }

  async updateHeaderField(
    criteriaId: string,
    fieldKey: string,
    dto: UpdateHeaderFieldDto,
  ) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const fields = criteria.headerFields as unknown as HeaderField[];

    const fieldIndex = fields.findIndex((f) => f.key === fieldKey);
    if (fieldIndex === -1)
      throw new NotFoundException(`Header field "${fieldKey}" not found.`);

    const field = fields[fieldIndex];

    if (field.isSystem) {
      if (dto.label || dto.placeholder || dto.required !== undefined) {
        throw new ForbiddenException(
          'System fields: only dropdown options can be modified.',
        );
      }
      if (field.type !== 'dropdown') {
        throw new ForbiddenException(
          'This system field has no editable options.',
        );
      }
    }

    fields[fieldIndex] = {
      ...field,
      label: dto.label ?? field.label,
      placeholder: dto.placeholder ?? field.placeholder,
      required: dto.required ?? field.required,
      options: dto.options !== undefined ? dto.options : field.options,
    };

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { headerFields: fields as any },
    });

    return {
      success: true,
      message: 'Header field updated successfully',
      data: updated.headerFields,
    };
  }

  async removeHeaderField(criteriaId: string, fieldKey: string) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const fields = criteria.headerFields as unknown as HeaderField[];

    const field = fields.find((f) => f.key === fieldKey);
    if (!field)
      throw new NotFoundException(`Header field "${fieldKey}" not found.`);
    if (field.isSystem)
      throw new ForbiddenException('System fields cannot be deleted.');

    const filtered = fields
      .filter((f) => f.key !== fieldKey)
      .map((f, i) => ({ ...f, order: i + 1 }));

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { headerFields: filtered as any },
    });

    return {
      success: true,
      message: 'Header field deleted successfully',
      data: updated.headerFields,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCORING CATEGORIES
  // ─────────────────────────────────────────────────────────────────────────

  async getScoringCategories(criteriaId: string) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    return {
      success: true,
      message: 'Scoring categories retrieved successfully',
      data: criteria.scoringCategories,
    };
  }

  async addScoringCategory(criteriaId: string, dto: AddScoringCategoryDto) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const categories =
      criteria.scoringCategories as unknown as ScoringCategory[];

    const currentTotal = categories.reduce((sum, c) => sum + c.maxPoints, 0);
    if (currentTotal + dto.maxPoints > 100) {
      throw new BadRequestException(
        `Adding ${dto.maxPoints}pts would exceed 100pt total (currently ${currentTotal}pts used).`,
      );
    }

    const newCategory: ScoringCategory = {
      key: `custom_cat_${Date.now()}`,
      label: dto.label,
      maxPoints: dto.maxPoints,
      isSystem: false,
      order: categories.length + 1,
    };

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { scoringCategories: [...categories, newCategory] as any },
    });

    return {
      success: true,
      message: 'Scoring category added successfully',
      data: updated.scoringCategories,
    };
  }

  async updateScoringCategory(
    criteriaId: string,
    categoryKey: string,
    dto: UpdateScoringCategoryDto,
  ) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const categories =
      criteria.scoringCategories as unknown as ScoringCategory[];

    const catIndex = categories.findIndex((c) => c.key === categoryKey);
    if (catIndex === -1)
      throw new NotFoundException(
        `Scoring category "${categoryKey}" not found.`,
      );

    const category = categories[catIndex];

    if (category.isSystem && dto.maxPoints !== undefined) {
      throw new ForbiddenException(
        'System category maxPoints cannot be changed.',
      );
    }

    if (dto.maxPoints !== undefined) {
      const totalWithoutThis = categories
        .filter((c) => c.key !== categoryKey)
        .reduce((sum, c) => sum + c.maxPoints, 0);
      if (totalWithoutThis + dto.maxPoints > 100) {
        throw new BadRequestException(
          `Setting ${dto.maxPoints}pts would exceed 100pt total.`,
        );
      }
    }

    categories[catIndex] = {
      ...category,
      label: dto.label ?? category.label,
      maxPoints: dto.maxPoints ?? category.maxPoints,
    };

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { scoringCategories: categories as any },
    });

    return {
      success: true,
      message: 'Scoring category updated successfully',
      data: updated.scoringCategories,
    };
  }

  async removeScoringCategory(criteriaId: string, categoryKey: string) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const categories =
      criteria.scoringCategories as unknown as ScoringCategory[];

    const category = categories.find((c) => c.key === categoryKey);
    if (!category)
      throw new NotFoundException(
        `Scoring category "${categoryKey}" not found.`,
      );
    if (category.isSystem)
      throw new ForbiddenException(
        'System scoring categories cannot be deleted.',
      );

    const filtered = categories
      .filter((c) => c.key !== categoryKey)
      .map((c, i) => ({ ...c, order: i + 1 }));

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { scoringCategories: filtered as any },
    });

    return {
      success: true,
      message: 'Scoring category deleted successfully',
      data: updated.scoringCategories,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MEDIA FIELDS
  // ─────────────────────────────────────────────────────────────────────────

  async getMediaFields(criteriaId: string) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    return {
      success: true,
      message: 'Media fields retrieved successfully',
      data: criteria.mediaFields,
    };
  }

  async addMediaField(criteriaId: string, dto: AddMediaFieldDto) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const fields = criteria.mediaFields as unknown as MediaField[];

    const type: MediaField['type'] = dto.isMediaFile
      ? 'file'
      : dto.isEmbedded
        ? 'embed'
        : 'document';

    if (type === 'document') {
      throw new BadRequestException(
        'Document upload slots are system-managed and cannot be added manually.',
      );
    }

    const newField: MediaField = {
      key: `custom_media_${Date.now()}`,
      label: dto.label,
      placeholder: dto.placeholder ?? '',
      type,
      isSystem: false,
      order: fields.length + 1,
      accept: dto.isMediaFile ? (dto.accept ?? null) : null,
    };

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { mediaFields: [...fields, newField] as any },
    });

    return {
      success: true,
      message: 'Media field added successfully',
      data: updated.mediaFields,
    };
  }

  async updateMediaField(
    criteriaId: string,
    fieldKey: string,
    dto: UpdateMediaFieldDto,
  ) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const fields = criteria.mediaFields as unknown as MediaField[];

    const fieldIndex = fields.findIndex((f) => f.key === fieldKey);
    if (fieldIndex === -1)
      throw new NotFoundException(`Media field "${fieldKey}" not found.`);

    const field = fields[fieldIndex];

    fields[fieldIndex] = {
      ...field,
      label: dto.label ?? field.label,
      placeholder: dto.placeholder ?? field.placeholder,
      accept:
        field.type === 'file' && dto.accept !== undefined
          ? dto.accept
          : field.accept,
    };

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { mediaFields: fields as any },
    });

    return {
      success: true,
      message: 'Media field updated successfully',
      data: updated.mediaFields,
    };
  }

  async removeMediaField(criteriaId: string, fieldKey: string) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const fields = criteria.mediaFields as unknown as MediaField[];

    const field = fields.find((f) => f.key === fieldKey);
    if (!field)
      throw new NotFoundException(`Media field "${fieldKey}" not found.`);
    if (field.isSystem)
      throw new ForbiddenException('System media fields cannot be deleted.');

    const filtered = fields
      .filter((f) => f.key !== fieldKey)
      .map((f, i) => ({ ...f, order: i + 1 }));

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { mediaFields: filtered as any },
    });

    return {
      success: true,
      message: 'Media field deleted successfully',
      data: updated.mediaFields,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADDITIONAL NOTES CONFIG
  // ─────────────────────────────────────────────────────────────────────────

  async getAdditionalNotesConfig(criteriaId: string) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    return {
      success: true,
      message: 'Additional notes config retrieved successfully',
      data: criteria.additionalNotesConfig,
    };
  }

  async updateAdditionalNotesConfig(
    criteriaId: string,
    dto: UpdateAdditionalNotesConfigDto,
  ) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const current =
      criteria.additionalNotesConfig as unknown as AdditionalNotesConfig;

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: {
        additionalNotesConfig: {
          label: dto.label ?? current.label,
          placeholder: dto.placeholder ?? current.placeholder,
        } as any,
      },
    });

    return {
      success: true,
      message: 'Additional notes config updated successfully',
      data: updated.additionalNotesConfig,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REPAIR PLANNING CONFIG
  // ─────────────────────────────────────────────────────────────────────────

  async getRepairPlanningConfig(criteriaId: string) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    return {
      success: true,
      message: 'Repair planning config retrieved successfully',
      data: criteria.repairPlanningConfig,
    };
  }

  async updateRepairPlanningConfig(
    criteriaId: string,
    dto: UpdateRepairPlanningConfigDto,
  ) {
    await this._assertCriteriaExists(criteriaId);

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: {
        repairPlanningConfig: { statuses: dto.statuses } as any,
      },
    });

    return {
      success: true,
      message: 'Repair planning config updated successfully',
      data: updated.repairPlanningConfig,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HEALTH THRESHOLD CONFIG
  // ─────────────────────────────────────────────────────────────────────────

  async getHealthThresholdConfig(criteriaId: string) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    return {
      success: true,
      message: 'Health threshold config retrieved successfully',
      data: criteria.healthThresholdConfig,
    };
  }

  async updateHealthThresholdConfig(
    criteriaId: string,
    dto: UpdateHealthThresholdConfigDto,
  ) {
    const criteria = await this._assertCriteriaExists(criteriaId);
    const current =
      criteria.healthThresholdConfig as unknown as HealthThresholdConfig;

    // Merge each tier — only update fields that were sent
    const merged: HealthThresholdConfig = {
      good: { ...current.good, ...dto.good },
      fair: { ...current.fair, ...dto.fair },
      poor: { ...current.poor, ...dto.poor },
    };

    this._assertHealthTiers(merged);

    const updated = await this.prisma.inspectionCriteria.update({
      where: { id: criteriaId },
      data: { healthThresholdConfig: merged as any },
    });

    return {
      success: true,
      message: 'Health threshold config updated successfully',
      data: updated.healthThresholdConfig,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private _assertUniqueKeys(keys: string[], fieldName: string) {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        throw new BadRequestException(
          `Duplicate key "${key}" found in ${fieldName}. All keys must be unique.`,
        );
      }
      seen.add(key);
    }
  }

  private _assertHealthTiers(config: {
    good: HealthTier;
    fair: HealthTier;
    poor: HealthTier;
  }) {
    for (const [name, tier] of Object.entries(config)) {
      if (tier.minScore > tier.maxScore) {
        throw new BadRequestException(
          `Health tier "${name}": minScore (${tier.minScore}) cannot exceed maxScore (${tier.maxScore}).`,
        );
      }
      if (tier.remainingLifeMinYears > tier.remainingLifeMaxYears) {
        throw new BadRequestException(
          `Health tier "${name}": remainingLifeMinYears cannot exceed remainingLifeMaxYears.`,
        );
      }
    }
  }

  private async _assertCriteriaExists(id: string) {
    const criteria = await this.prisma.inspectionCriteria.findUnique({
      where: { id },
    });
    if (!criteria)
      throw new NotFoundException(`InspectionCriteria "${id}" not found.`);
    return criteria;
  }
}
