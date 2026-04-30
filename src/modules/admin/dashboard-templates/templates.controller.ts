import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { DashboardTemplateService } from './templates.service';
import {
  AddMediaFieldDto,
  AddTextFieldDto,
  CreateInitialDashboardTemplate,
  PatchSectionsDto,
  UpdateSectionStyleDto,
} from './dto/create-templates.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Role } from 'src/common/guard/role/role.enum';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { TemplateStatus } from 'prisma/generated/enums';
import { UpdateDashboardTemplateDto } from './dto/update-templates.dto';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';

@ApiTags('Dashboard Templates')
@ApiBearerAuth(SWAGGER_AUTH.admin)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('dashboard-templates')
export class DashboardTemplateController {
  constructor(
    private readonly dashboardTemplateService: DashboardTemplateService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // TEMPLATE CRUD
  // ──────────────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({
    summary: 'Create a new dashboard template',
    description: 'Creates a reusable dashboard template with sections',
  })
  create(@Body() dto: CreateInitialDashboardTemplate) {
    return this.dashboardTemplateService.create(dto);
  }

  // ──────────────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List all dashboard templates',
    description:
      'Returns all templates ordered by creation date (newest first). ' +
      'Optionally filter by status.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: TemplateStatus,
    description: 'Filter by template status. Omit to return all.',
  })
  findAll(@Query('status') status?: TemplateStatus) {
    return this.dashboardTemplateService.findAll(status);
  }

  // ──────────────────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single dashboard template',
    description:
      'Returns full template details including all sections (with styles and configs) ' +
      'and a list of properties currently using this template.',
  })
  @ApiParam({
    name: 'id',
    description: 'Template CUID',
    example: 'clx5678def',
  })
  findOne(@Param('id') id: string) {
    return this.dashboardTemplateService.findOneResponse(id);
  }

  // ──────────────────────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a dashboard template',
    description:
      'Partial update — only provided fields are changed. ' +
      'When updating `sections`, the 3 fixed sections are always preserved. ' +
      '**Note:** Changes here do NOT automatically propagate to existing properties.',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  update(@Param('id') id: string, @Body() dto: UpdateDashboardTemplateDto) {
    return this.dashboardTemplateService.update(id, dto);
  }

  // ──────────────────────────────────────────────────────────────────────────

  @Patch(':id/toggle-status')
  @ApiOperation({
    summary: 'Toggle dashboard template status (ACTIVE / INACTIVE)',
    description:
      'Toggles the template status between ACTIVE and INACTIVE. ' +
      'Only one template can be ACTIVE at a time. ' +
      'When a template is set to ACTIVE, all other templates are automatically set to INACTIVE. ' +
      'DELETED templates are not affected.',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  toggleStatus(@Param('id') id: string) {
    return this.dashboardTemplateService.toggleStatus(id);
  }

  // ──────────────────────────────────────────────────────────────────────────

  @Post(':id/duplicate')
  @ApiOperation({
    summary: 'Duplicate a dashboard template',
    description:
      'Creates a full copy of the template (including all sections and styles) ' +
      'under a new name. The duplicate starts with status `ACTIVE`.',
  })
  @ApiParam({
    name: 'id',
    description: 'Source template CUID',
    example: 'clx5678def',
  })
  @ApiBody({
    description: 'New name for the duplicated template',
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          example: 'Standard Roof Inspection Template (Copy)',
        },
      },
    },
  })
  duplicate(@Param('id') id: string, @Body('name') newName: string) {
    return this.dashboardTemplateService.duplicate(id, newName);
  }

  // ──────────────────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hard delete a dashboard template',
    description:
      'Permanently removes the template. ' +
      '**Blocked** if any properties are still assigned to it — archive instead.',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  remove(@Param('id') id: string) {
    return this.dashboardTemplateService.remove(id);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DYNAMIC SECTION MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  @Post(':id/sections/text-field')
  @ApiOperation({
    summary: 'Add a text field section',
    description:
      'Corresponds to the **"Add More Text Fields"** modal in the template editor. ' +
      'Creates a new `TEXT_FIELD` section with a label and optional placeholder. ' +
      'The section is inserted before the fixed sections.',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  addTextField(@Param('id') id: string, @Body() dto: AddTextFieldDto) {
    return this.dashboardTemplateService.addTextField(id, dto);
  }

  // ──────────────────────────────────────────────────────────────────────────

  @Post(':id/sections/media-field')
  @ApiOperation({
    summary: 'Add a media or embedded content section',
    description:
      'Corresponds to the **"Add More Supporting Media & Embedded Contents"** modal. ' +
      'Set `mediaType` to:\n' +
      '- `media` → photos / videos uploaded directly (e.g. Aerial Map, Photos)\n' +
      '- `embedded` → 3D tours, interactive maps, or any external embed URL',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  addMediaField(@Param('id') id: string, @Body() dto: AddMediaFieldDto) {
    return this.dashboardTemplateService.addMediaField(id, dto);
  }

  // ──────────────────────────────────────────────────────────────────────────

  @Delete(':id/sections/:order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a dynamic section',
    description:
      'Removes a `TEXT_FIELD` or `MEDIA_FIELD` section by its `order` number. ' +
      'The remaining dynamic sections are automatically renumbered. ' +
      '**Fixed sections** (`priority_repair_planning`, `documents`, `additional_information`) ' +
      'cannot be removed and will return a 400.',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  @ApiParam({
    name: 'order',
    description: 'Section order number to remove',
    example: 2,
  })
  removeSection(@Param('id') id: string, @Param('order') order: string) {
    return this.dashboardTemplateService.removeDynamicSection(
      id,
      parseInt(order, 10),
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STYLE & LAYOUT
  // ──────────────────────────────────────────────────────────────────────────

  @Patch(':id/sections/style')
  @ApiOperation({
    summary: 'Update style for a specific section',
    description:
      'Corresponds to the **right-side style panel** in the template editor ' +
      '(Typography, Fill, Size, Layout tabs). ' +
      'Uses a **deep-merge** strategy — only the provided style fields are overwritten, ' +
      'existing style properties are preserved.',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  updateSectionStyle(
    @Param('id') id: string,
    @Body() dto: UpdateSectionStyleDto,
  ) {
    return this.dashboardTemplateService.updateSectionStyle(id, dto);
  }

  // ──────────────────────────────────────────────────────────────────────────

  @Patch(':id/sections')
  @ApiOperation({
    summary: 'Reorder and/or update sections in one call',
    description:
      '`order` — full ordered array of type strings for drag-and-drop reorder.\n\n' +
      '`sections` — per-section `label` / `width` updates using `type` as the key.\n\n' +
      'Both can be sent together. Reorder runs first, then style patches.',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        order: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'header_info',
            'health_snapshot',
            'media_grid',
            'aerial_map',
            'tour_3d',
            'repair_planning',
            'roof_health_rating',
            'additional_info',
            'documents',
          ],
        },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: {
                type: 'string',
                enum: [
                  'header_info',
                  'health_snapshot',
                  'media_grid',
                  'aerial_map',
                  'tour_3d',
                  'repair_planning',
                  'roof_health_rating',
                  'additional_info',
                  'documents',
                ],
                example: 'health_snapshot',
              },
              label: { type: 'string', example: 'Roof Overview' },
              width: {
                type: 'string',
                enum: ['full', '1/2', '1/3', '2/3'],
                example: '1/2',
              },
            },
          },
        },
      },
    },
  })
  patchSections(@Param('id') id: string, @Body() dto: PatchSectionsDto) {
    return this.dashboardTemplateService.patchSections(id, dto);
  }
}
