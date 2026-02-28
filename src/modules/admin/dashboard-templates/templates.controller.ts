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
  CreateDashboardTemplateDto,
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
    description:
      'Creates a reusable dashboard template with sections. ' +
      'The 3 fixed sections (`priority_repair_planning`, `documents`, `additional_information`) ' +
      'are always auto-injected at order 100–102 even if omitted from the request.',
  })
  create(@Body() dto: CreateDashboardTemplateDto) {
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

  @Patch(':id/archive')
  @ApiOperation({
    summary: 'Archive a dashboard template',
    description:
      'Sets the template status to `ARCHIVED`. The template is preserved ' +
      'and its existing property assignments remain intact, but it becomes ' +
      'unavailable for new assignments.',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  archive(@Param('id') id: string) {
    return this.dashboardTemplateService.archive(id);
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

  @Patch(':id/sections/reorder')
  @ApiOperation({
    summary: 'Reorder all sections',
    description:
      'Accepts a fully-ordered array of section **type strings**. ' +
      'All existing section types must be present — missing types return a 400. ' +
      'This controls what the admin sees in the template drag-and-drop reorder view.',
  })
  @ApiParam({ name: 'id', description: 'Template CUID', example: 'clx5678def' })
  @ApiBody({
    description: 'Ordered array of section type strings',
    schema: {
      type: 'object',
      required: ['sections'],
      properties: {
        sections: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'text_field',
            'media_field',
            'priority_repair_planning',
            'documents',
            'additional_information',
          ],
        },
      },
    },
  })
  reorderSections(
    @Param('id') id: string,
    @Body('sections') sections: string[],
  ) {
    return this.dashboardTemplateService.reorderSections(id, sections);
  }
}
