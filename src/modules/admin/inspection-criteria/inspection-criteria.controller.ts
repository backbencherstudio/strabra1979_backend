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
  UpdateNteConfigDto,
  UpdateAdditionalNotesConfigDto,
  UpdateRepairPlanningConfigDto,
  UpdateHealthThresholdConfigDto,
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
      'The caller provides headerFields, scoringCategories, mediaFields, ' +
      'nteConfig, additionalNotesConfig, repairPlanningConfig, and healthThresholdConfig. ' +
      'All fields/categories/media sent here become isSystem=true — cannot be deleted later. ' +
      'Keys must be unique within each array. Total scoringCategories maxPoints must not exceed 100.',
  })
  create(@Body() dto: CreateInspectionCriteriaDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all inspection criteria',
    description:
      'Returns all criteria records ordered by creation date descending.',
  })
  findAll() {
    return this.service.findAll();
  }

  @Get(':criteriaId')
  @ApiOperation({
    summary: 'Get a single inspection criteria by ID',
    description:
      'Returns the full criteria object including all JSON fields: ' +
      'headerFields, scoringCategories, mediaFields, nteConfig, ' +
      'additionalNotesConfig, repairPlanningConfig, healthThresholdConfig.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  findOne(@Param('criteriaId') criteriaId: string) {
    return this.service.findOne(criteriaId);
  }

  @Patch(':criteriaId')
  @ApiOperation({
    summary: 'Update criteria name or description',
    description:
      'Updates top-level name and/or description only. ' +
      'Use dedicated sub-endpoints to modify fields, categories, media, or config sections.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
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
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
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
      'placeholder, required, isSystem, order, options.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  getHeaderFields(@Param('criteriaId') criteriaId: string) {
    return this.service.getHeaderFields(criteriaId);
  }

  @Post(':criteriaId/header-fields')
  @ApiOperation({
    summary: 'Add a custom header input field',
    description:
      'Called from the "Add More Input Fields" modal. ' +
      'isDropdown=true requires options array (min 1). ' +
      'New fields get isSystem=false — fully editable and deletable. ' +
      'Key is auto-generated as custom_{timestamp}.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  addHeaderField(
    @Param('criteriaId') criteriaId: string,
    @Body() dto: AddHeaderFieldDto,
  ) {
    return this.service.addHeaderField(criteriaId, dto);
  }

  @Patch(':criteriaId/header-fields/:fieldKey')
  @ApiOperation({
    summary: 'Edit a header field',
    description:
      'System fields (isSystem=true): only dropdown options editable. ' +
      'Custom fields: label, placeholder, required, and options all editable. ' +
      'To remove a dropdown option, send the full array without it.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  @ApiParam({
    name: 'fieldKey',
    description: 'e.g. "roofSystemType" or "custom_1748291234"',
  })
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
      'Removes a custom field (isSystem=false). Order recalculated after removal. ' +
      'Throws 403 for system fields.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  @ApiParam({
    name: 'fieldKey',
    description: 'Key of the custom field to delete',
  })
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
      'Returns the scoringCategories array. Each: key, label, maxPoints, isSystem, order. ' +
      'Total maxPoints should not exceed 100.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  getScoringCategories(@Param('criteriaId') criteriaId: string) {
    return this.service.getScoringCategories(criteriaId);
  }

  @Post(':criteriaId/scoring-categories')
  @ApiOperation({
    summary: 'Add a custom scoring category',
    description:
      'Validates total maxPoints does not exceed 100. ' +
      'Key auto-generated as custom_cat_{timestamp}.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
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
      'System categories: only label editable, maxPoints locked. ' +
      'Custom categories: both editable. Validates 100pt total.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  @ApiParam({
    name: 'categoryKey',
    description: 'e.g. "surfaceCondition" or "custom_cat_1748291234"',
  })
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
      'Removes custom category (isSystem=false). Throws 403 for system categories.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  @ApiParam({
    name: 'categoryKey',
    description: 'Key of the custom category to delete',
  })
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
    summary: 'Get all media fields',
    description:
      'Returns the mediaFields array. Each: key, label, placeholder, ' +
      'type ("file"|"embed"|"document"), isSystem, order, accept.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  getMediaFields(@Param('criteriaId') criteriaId: string) {
    return this.service.getMediaFields(criteriaId);
  }

  @Post(':criteriaId/media-fields')
  @ApiOperation({
    summary: 'Add a custom media field',
    description:
      'Called from "+ Add More Supporting Media & Documents" modal. ' +
      'isMediaFile=true → file upload widget. isEmbedded=true → URL/iframe textarea. ' +
      'Both false is blocked (document slots are system-only). ' +
      'Key auto-generated as custom_media_{timestamp}.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  addMediaField(
    @Param('criteriaId') criteriaId: string,
    @Body() dto: AddMediaFieldDto,
  ) {
    return this.service.addMediaField(criteriaId, dto);
  }

  @Patch(':criteriaId/media-fields/:fieldKey')
  @ApiOperation({
    summary: 'Edit a media field',
    description:
      'label and placeholder editable for all fields. ' +
      'accept editable only for file-type fields. ' +
      'Field type is immutable after creation.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  @ApiParam({
    name: 'fieldKey',
    description: 'e.g. "aerialMap" or "custom_media_1748291234"',
  })
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
      'Removes custom media field (isSystem=false). Throws 403 for system fields.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  @ApiParam({
    name: 'fieldKey',
    description: 'Key of the custom media field to delete',
  })
  removeMediaField(
    @Param('criteriaId') criteriaId: string,
    @Param('fieldKey') fieldKey: string,
  ) {
    return this.service.removeMediaField(criteriaId, fieldKey);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADDITIONAL NOTES CONFIG
  // ─────────────────────────────────────────────────────────────────────────

  @Get(':criteriaId/additional-notes-config')
  @ApiOperation({
    summary: 'Get additional notes config',
    description:
      'Returns the Additional Notes/Comments textarea config: label and placeholder.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  getAdditionalNotesConfig(@Param('criteriaId') criteriaId: string) {
    return this.service.getAdditionalNotesConfig(criteriaId);
  }

  @Patch(':criteriaId/additional-notes-config')
  @ApiOperation({
    summary: 'Update additional notes config',
    description:
      'Updates label and/or placeholder for the Additional Notes textarea. ' +
      'Omitted fields keep their current values.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  updateAdditionalNotesConfig(
    @Param('criteriaId') criteriaId: string,
    @Body() dto: UpdateAdditionalNotesConfigDto,
  ) {
    return this.service.updateAdditionalNotesConfig(criteriaId, dto);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REPAIR PLANNING CONFIG
  // ─────────────────────────────────────────────────────────────────────────

  @Get(':criteriaId/repair-planning-config')
  @ApiOperation({
    summary: 'Get repair planning config',
    description:
      'Returns the repair planning config: statuses array. ' +
      'These are the priority options the inspector selects when adding repair items.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  getRepairPlanningConfig(@Param('criteriaId') criteriaId: string) {
    return this.service.getRepairPlanningConfig(criteriaId);
  }

  @Patch(':criteriaId/repair-planning-config')
  @ApiOperation({
    summary: 'Update repair planning config',
    description:
      'Replaces the full statuses array. ' +
      'Send the complete desired list — e.g. to remove a status, omit it from the array.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  updateRepairPlanningConfig(
    @Param('criteriaId') criteriaId: string,
    @Body() dto: UpdateRepairPlanningConfigDto,
  ) {
    return this.service.updateRepairPlanningConfig(criteriaId, dto);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HEALTH THRESHOLD CONFIG
  // ─────────────────────────────────────────────────────────────────────────

  @Get(':criteriaId/health-threshold-config')
  @ApiOperation({
    summary: 'Get health threshold config',
    description:
      'Returns the health threshold config with three tiers: good, fair, poor. ' +
      'Each tier: minScore, maxScore, remainingLifeMinYears, remainingLifeMaxYears.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  getHealthThresholdConfig(@Param('criteriaId') criteriaId: string) {
    return this.service.getHealthThresholdConfig(criteriaId);
  }

  @Patch(':criteriaId/health-threshold-config')
  @ApiOperation({
    summary: 'Update health threshold config',
    description:
      'Partially updates one or more health tiers. ' +
      'Only send the tiers and fields you want to change — others keep their current values. ' +
      'Validates that minScore does not exceed maxScore within each tier.',
  })
  @ApiParam({
    name: 'criteriaId',
    description: 'CUID of the InspectionCriteria',
  })
  updateHealthThresholdConfig(
    @Param('criteriaId') criteriaId: string,
    @Body() dto: UpdateHealthThresholdConfigDto,
  ) {
    return this.service.updateHealthThresholdConfig(criteriaId, dto);
  }
}
