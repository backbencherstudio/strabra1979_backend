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
  UpdateMediaFieldDto,
  AddMediaFieldDto,
} from './dto/inspection-criteria.dto';
import {
  HeaderField,
  MediaField,
  ScoringCategory,
} from './inspection-criteria.types';
import { INSPECTION_CRITERIA } from './inspection-criteria.const';

@Injectable()
export class InspectionCriteriaService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CRITERIA — CRUD
  // ─────────────────────────────────────────────────────────────────────────

  async create(dto: CreateInspectionCriteriaDto) {
    const result = await this.prisma.inspectionCriteria.create({
      data: {
        name: dto.name,
        description: dto.description,
        headerFields: INSPECTION_CRITERIA.headerFields as any,
        scoringCategories: INSPECTION_CRITERIA.scoringCategories as any,
        mediaFields: INSPECTION_CRITERIA.mediaFields as any,
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
      where: {
        criteriaId: id,
      },
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
    if (fieldIndex === -1) {
      throw new NotFoundException(`Header field "${fieldKey}" not found.`);
    }

    const field = fields[fieldIndex];

    // System fields: only allow options update (not label/placeholder/required/type)
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

    const updatedField: HeaderField = {
      ...field,
      label: dto.label ?? field.label,
      placeholder: dto.placeholder ?? field.placeholder,
      required: dto.required ?? field.required,
      options: dto.options !== undefined ? dto.options : field.options,
    };

    fields[fieldIndex] = updatedField;

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
    if (!field) {
      throw new NotFoundException(`Header field "${fieldKey}" not found.`);
    }
    if (field.isSystem) {
      throw new ForbiddenException('System fields cannot be deleted.');
    }

    // Remove and re-order
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

    // Guard: total maxPoints must not exceed 100
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
    if (catIndex === -1) {
      throw new NotFoundException(
        `Scoring category "${categoryKey}" not found.`,
      );
    }

    const category = categories[catIndex];

    // Guard: system categories — only label can be updated
    if (category.isSystem && dto.maxPoints !== undefined) {
      throw new ForbiddenException(
        'System category maxPoints cannot be changed.',
      );
    }

    // Guard: new total must not exceed 100
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
    if (!category) {
      throw new NotFoundException(
        `Scoring category "${categoryKey}" not found.`,
      );
    }
    if (category.isSystem) {
      throw new ForbiddenException(
        'System scoring categories cannot be deleted.',
      );
    }

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

    // Document slots are system-managed — cannot be added manually
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

    // Both system and custom fields: label and placeholder are always editable
    // accept is editable only for file-type fields; type itself is always locked
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
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private async _assertCriteriaExists(id: string) {
    const criteria = await this.prisma.inspectionCriteria.findUnique({
      where: { id },
    });
    if (!criteria) {
      throw new NotFoundException(`InspectionCriteria "${id}" not found.`);
    }
    return criteria;
  }
}
