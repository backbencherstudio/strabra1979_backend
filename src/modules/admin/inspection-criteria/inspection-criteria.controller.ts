import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { InspectionCriteriaService } from './inspection-criteria.service';
import {
  CreateInspectionCriteriaDto,
  UpdateInspectionCriteriaDto,
  AddHeaderFieldDto,
  UpdateHeaderFieldDto,
  AddScoringCategoryDto,
  UpdateScoringCategoryDto,
  AddMediaFieldDto,
  UpdateMediaFieldDto,
} from './dto/inspection-criteria.dto';

@ApiTags('Inspection Criteria')
@ApiBearerAuth()
@Controller('inspection-criteria')
export class InspectionCriteriaController {
  constructor(private readonly service: InspectionCriteriaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CRITERIA — CRUD
  // ─────────────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({
    summary: 'Create a new inspection criteria',
    description:
      'Creates a new InspectionCriteria record. ' +
      'The user provides the initial headerFields, scoringCategories, and mediaFields arrays. ' +
      'All fields sent here become isSystem=true — they cannot be deleted later, ' +
      'only their labels, placeholders, and dropdown options can be edited. ' +
      'Keys must be unique within each array. ' +
      'Total scoringCategories maxPoints must not exceed 100.',
  })
  create(@Body() dto: CreateInspectionCriteriaDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all inspection criteria',
    description: 'Returns all criteria records ordered by creation date descending.',
  })
  findAll() {
    return this.service.findAll();
  }

  @Get(':criteriaId')
  @ApiOperation({
    summary: 'Get a single inspection criteria by ID',
    description:
      'Returns the full criteria object including headerFields, ' +
      'scoringCategories, and mediaFields JSON arrays.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  findOne(@Param('criteriaId') criteriaId: string) {
    return this.service.findOne(criteriaId);
  }

  @Patch(':criteriaId')
  @ApiOperation({
    summary: 'Update criteria name or description',
    description:
      'Updates top-level name and/or description only. ' +
      'Use the dedicated field/category/media endpoints to modify those arrays.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  update(
    @Param('criteriaId') criteriaId: string,
    @Body() dto: UpdateInspectionCriteriaDto,
  ) {
    return this.service.update(criteriaId, dto);
  }

  @Delete(':criteriaId')
  @ApiOperation({
    summary: 'Delete an inspection criteria',
    description:
      'Permanently deletes the criteria. ' +
      'Throws 400 if any dashboard template is currently linked to this criteria.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  remove(@Param('criteriaId') criteriaId: string) {
    return this.service.remove(criteriaId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HEADER FIELDS
  // ─────────────────────────────────────────────────────────────────────────

  @Get(':criteriaId/header-fields')
  @ApiOperation({
    summary: 'Get all header fields',
    description:
      'Returns the headerFields array. Each field: key, label, type ("text"|"dropdown"), ' +
      'placeholder, required, isSystem, order, options. ' +
      'isSystem=true fields are pre-seeded and protected from deletion.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  getHeaderFields(@Param('criteriaId') criteriaId: string) {
    return this.service.getHeaderFields(criteriaId);
  }

  @Post(':criteriaId/header-fields')
  @ApiOperation({
    summary: 'Add a custom input field to the inspection form header',
    description:
      'Called when the user fills in the "Add More Input Fields" modal and clicks Create. ' +
      'isDropdown=true requires an options array (min 1). ' +
      'New fields get isSystem=false and can be edited or deleted. ' +
      'Key is auto-generated as custom_{timestamp}.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  addHeaderField(
    @Param('criteriaId') criteriaId: string,
    @Body() dto: AddHeaderFieldDto,
  ) {
    return this.service.addHeaderField(criteriaId, dto);
  }

  @Patch(':criteriaId/header-fields/:fieldKey')
  @ApiOperation({
    summary: 'Edit an existing header field',
    description:
      'System fields (isSystem=true): only dropdown options can be modified. ' +
      'Custom fields: label, placeholder, required, and options are all editable. ' +
      'To delete a dropdown option send the full replacement array without the removed item.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  @ApiParam({ name: 'fieldKey', description: 'Field key e.g. "roofSystemType" or "custom_1748291234"' })
  updateHeaderField(
    @Param('criteriaId') criteriaId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() dto: UpdateHeaderFieldDto,
  ) {
    return this.service.updateHeaderField(criteriaId, fieldKey, dto);
  }

  @Delete(':criteriaId/header-fields/:fieldKey')
  @ApiOperation({
    summary: 'Delete a custom header field',
    description:
      'Removes a custom field (isSystem=false). ' +
      'Field order is recalculated after removal. ' +
      'Throws 403 if the field is a system field.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  @ApiParam({ name: 'fieldKey', description: 'Key of the custom header field to delete' })
  removeHeaderField(
    @Param('criteriaId') criteriaId: string,
    @Param('fieldKey') fieldKey: string,
  ) {
    return this.service.removeHeaderField(criteriaId, fieldKey);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SCORING CATEGORIES
  // ─────────────────────────────────────────────────────────────────────────

  @Get(':criteriaId/scoring-categories')
  @ApiOperation({
    summary: 'Get all scoring categories',
    description:
      'Returns the scoringCategories array. Each category: key, label, maxPoints, isSystem, order. ' +
      'Total maxPoints across all categories should not exceed 100.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  getScoringCategories(@Param('criteriaId') criteriaId: string) {
    return this.service.getScoringCategories(criteriaId);
  }

  @Post(':criteriaId/scoring-categories')
  @ApiOperation({
    summary: 'Add a custom scoring category',
    description:
      'Adds a new scored checklist category. ' +
      'Validates that total maxPoints across all categories does not exceed 100. ' +
      'Key is auto-generated as custom_cat_{timestamp}.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  addScoringCategory(
    @Param('criteriaId') criteriaId: string,
    @Body() dto: AddScoringCategoryDto,
  ) {
    return this.service.addScoringCategory(criteriaId, dto);
  }

  @Patch(':criteriaId/scoring-categories/:categoryKey')
  @ApiOperation({
    summary: 'Edit a scoring category',
    description:
      'System categories (isSystem=true): only label is editable, maxPoints is locked. ' +
      'Custom categories: both label and maxPoints are editable. ' +
      'Validates that updated total does not exceed 100pts.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  @ApiParam({ name: 'categoryKey', description: 'Key e.g. "surfaceCondition" or "custom_cat_1748291234"' })
  updateScoringCategory(
    @Param('criteriaId') criteriaId: string,
    @Param('categoryKey') categoryKey: string,
    @Body() dto: UpdateScoringCategoryDto,
  ) {
    return this.service.updateScoringCategory(criteriaId, categoryKey, dto);
  }

  @Delete(':criteriaId/scoring-categories/:categoryKey')
  @ApiOperation({
    summary: 'Delete a custom scoring category',
    description:
      'Removes a custom category (isSystem=false). Order is recalculated after removal. ' +
      'Throws 403 if the category is a system category.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  @ApiParam({ name: 'categoryKey', description: 'Key of the custom scoring category to delete' })
  removeScoringCategory(
    @Param('criteriaId') criteriaId: string,
    @Param('categoryKey') categoryKey: string,
  ) {
    return this.service.removeScoringCategory(criteriaId, categoryKey);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MEDIA FIELDS
  // ─────────────────────────────────────────────────────────────────────────

  @Get(':criteriaId/media-fields')
  @ApiOperation({
    summary: 'Get all media fields (Media Files tab)',
    description:
      'Returns the mediaFields array shown in the Media Files tab of the inspection form. ' +
      'Each field: key, label, placeholder, type ("file"|"embed"|"document"), isSystem, order, accept. ' +
      'System fields: mediaFiles, aerialMap (file upload), tour3d (embed), documents (doc upload).',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  getMediaFields(@Param('criteriaId') criteriaId: string) {
    return this.service.getMediaFields(criteriaId);
  }

  @Post(':criteriaId/media-fields')
  @ApiOperation({
    summary: 'Add a custom media input field',
    description:
      'Called when the user clicks "+ Add More Supporting Media & Documents" and fills the modal. ' +
      'isMediaFile=true → renders a file upload widget (like Aerial Map). ' +
      'isEmbedded=true  → renders a URL/iframe textarea (like 3D Tours). ' +
      'Both false is not allowed for custom fields (document slots are system-only). ' +
      'Key is auto-generated as custom_media_{timestamp}.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  addMediaField(
    @Param('criteriaId') criteriaId: string,
    @Body() dto: AddMediaFieldDto,
  ) {
    return this.service.addMediaField(criteriaId, dto);
  }

  @Patch(':criteriaId/media-fields/:fieldKey')
  @ApiOperation({
    summary: 'Edit a media field label, placeholder, or accepted file types',
    description:
      'System fields: label and placeholder are editable. Accept types editable for file fields. ' +
      'Custom fields: same properties editable. ' +
      'Field type (file/embed) cannot be changed after creation for any field.',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  @ApiParam({ name: 'fieldKey', description: 'Key e.g. "aerialMap" or "custom_media_1748291234"' })
  updateMediaField(
    @Param('criteriaId') criteriaId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() dto: UpdateMediaFieldDto,
  ) {
    return this.service.updateMediaField(criteriaId, fieldKey, dto);
  }

  @Delete(':criteriaId/media-fields/:fieldKey')
  @ApiOperation({
    summary: 'Delete a custom media field',
    description:
      'Removes a custom media field (isSystem=false). Order is recalculated. ' +
      'Throws 403 if the field is a system field (mediaFiles, aerialMap, tour3d, documents).',
  })
  @ApiParam({ name: 'criteriaId', description: 'CUID of the InspectionCriteria' })
  @ApiParam({ name: 'fieldKey', description: 'Key of the custom media field to delete' })
  removeMediaField(
    @Param('criteriaId') criteriaId: string,
    @Param('fieldKey') fieldKey: string,
  ) {
    return this.service.removeMediaField(criteriaId, fieldKey);
  }
}