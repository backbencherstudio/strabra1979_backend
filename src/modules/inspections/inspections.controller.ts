import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFiles,
  Query,
  Delete,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SubmitInspectionDto, UpdateInspectionDto } from './dto/inspection.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { Request } from 'express';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';
import { InspectionService } from './inspections.service';
import { ScheduledInspectionStatus } from 'prisma/generated/enums';

@ApiTags('Inspections')
@ApiBearerAuth(SWAGGER_AUTH.operational)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inspections')
export class InspectionController {
  constructor(private readonly service: InspectionService) {}

  // ═════════════════════════════════════════════════════════════════════════
  // INSPECTION FORM + SUBMIT
  // ═════════════════════════════════════════════════════════════════════════

  @Get('property/:dashboardId/form')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({
    summary: 'Get inspection form config',
    description:
      'Returns the full form structure built from the linked InspectionCriteria. ' +
      'Frontend renders the form entirely from this response.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiOkResponse({ description: 'Form config returned.' })
  getForm(@Param('dashboardId') dashboardId: string, @Req() req: Request) {
    return this.service.getInspectionForm(
      dashboardId,
      req.user.userId,
      req.user.role,
    );
  }

  @Post('property/:dashboardId/submit/:scheduledInspectionId')
  @Roles(Role.OPERATIONAL)
  @UseInterceptors(FilesInterceptor('files', 50))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Submit a completed inspection with all data and media files',
    description:
      'Single API call — sends everything at once as multipart/form-data.\n\n' +
      '**Requires** the scheduledInspectionId to be IN_PROGRESS status.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiParam({
    name: 'scheduledInspectionId',
    description: 'CUID of the ScheduledInspection (must be IN_PROGRESS)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'string',
          description: 'JSON string of the inspection payload',
          example: JSON.stringify({
            headerData: {
              inspectionTitle: '2024 Annual Roof Inspection',
              propertyType: 'Commercial',
            },
            scores: {
              surfaceCondition: { score: 22, notes: 'Minor cracks observed' },
            },
            repairItems: [
              {
                title: 'Emergency Leak Repair',
                status: 'Urgent',
                description: 'Moisture stains...',
              },
            ],
            nteValue: 7500,
            additionalComments: 'No active leaks at time of inspection.',
            inspectedAt: '2024-06-15T09:00:00.000Z',
            mediaFieldKeys: [
              'mediaFiles',
              'mediaFiles',
              'documents',
              'documents',
              'documents',
            ],
          }),
        },
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Inspection submitted successfully.' })
  submitInspection(
    @Param('dashboardId') dashboardId: string,
    @Param('scheduledInspectionId') scheduledInspectionId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('data') rawData: string,
    @Req() req: Request,
  ) {
    let dto: SubmitInspectionDto;
    try {
      dto = JSON.parse(rawData);
    } catch {
      throw new Error('Invalid JSON in "data" field.');
    }
    return this.service.submitInspection(
      dashboardId,
      scheduledInspectionId,
      req.user.userId,
      req.user.role,
      dto,
      files ?? [],
    );
  }

  @Patch(':inspectionId')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @UseInterceptors(FilesInterceptor('files', 50))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update an inspection before publishing (Admin only)',
    description:
      'Allows admin to modify inspection data before publishing.\n\n' +
      'Only works on inspections in `COMPLETE` status (not yet published).\n\n' +
      'Sends everything as multipart/form-data — same format as submit.\n\n' +
      '**New files are appended. Existing media files are NOT deleted unless `removeMediaFileIds` is provided.**',
  })
  @ApiParam({ name: 'inspectionId', description: 'CUID of the Inspection' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: 'JSON string of fields to update',
          example: JSON.stringify({
            headerData: { inspectionTitle: 'Updated Title' },
            scores: { surfaceCondition: { score: 24, notes: 'Updated notes' } },
            repairItems: [
              { title: 'Leak Repair', status: 'Urgent', description: 'Fixed' },
            ],
            nteValue: 8000,
            additionalComments: 'Updated comments',
            mediaFieldKeys: ['mediaFiles'],
            removeMediaFileIds: ['cuid1', 'cuid2'],
          }),
        },
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Inspection updated successfully.' })
  updateInspection(
    @Param('inspectionId') inspectionId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('data') rawData: string,
    @Req() req: Request,
  ) {
    let dto: UpdateInspectionDto;
    try {
      dto = JSON.parse(rawData);
    } catch {
      throw new BadRequestException('Invalid JSON in "data" field.');
    }
    return this.service.updateInspection(
      inspectionId,
      req.user.userId,
      dto,
      files ?? [],
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // INSPECTION QUERIES
  // ═════════════════════════════════════════════════════════════════════════

  @Get('property/:dashboardId')
  @Roles(Role.ADMIN, Role.OPERATIONAL, Role.PROPERTY_MANAGER)
  @ApiOperation({ summary: 'List all inspections for a property dashboard' })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiOkResponse({ description: 'List of inspections.' })
  findAllForDashboard(
    @Param('dashboardId') dashboardId: string,
    @Req() req: Request,
  ) {
    return this.service.findAllForDashboard(
      dashboardId,
      req.user.userId,
      req.user.role,
    );
  }

  @Get(':inspectionId')
  @Roles(Role.ADMIN, Role.OPERATIONAL, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'Get a single inspection with all data and media files',
  })
  @ApiParam({ name: 'inspectionId', description: 'CUID of the Inspection' })
  @ApiOkResponse({ description: 'Full inspection record returned.' })
  findOne(@Param('inspectionId') inspectionId: string, @Req() req: Request) {
    return this.service.findOne(inspectionId, req.user.userId, req.user.role);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SCHEDULED INSPECTIONS — MY LIST (Operational)
  // ═════════════════════════════════════════════════════════════════════════

  @Get('scheduled/my')
  @Roles(Role.OPERATIONAL)
  @ApiOperation({
    summary: 'Get all scheduled inspections assigned to me',
    description:
      'Returns all scheduled inspections for the logged-in operational user. ' +
      'Auto-marks overdue (ASSIGNED + past scheduledAt) as DUE before returning.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ScheduledInspectionStatus,
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  getAssignedInspections(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.service.getAssignedInspections(
      req.user.userId,
      req.user.role, // ← add this
      { status, page: +page, limit: +limit },
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SCHEDULED INSPECTIONS — ADMIN / PM LIST
  // ═════════════════════════════════════════════════════════════════════════

  @Get('scheduled/all')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER, Role.OPERATIONAL)
  @ApiOperation({
    summary: 'Get all scheduled inspections (Admin / PM)',
    description:
      'Returns all scheduled inspections with filters. Used for the Inspection List page.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ScheduledInspectionStatus,
  })
  @ApiQuery({
    name: 'assignedTo',
    required: false,
    description: 'Filter by operational user ID',
  })
  @ApiQuery({
    name: 'dashboardId',
    required: false,
    description: 'Filter by dashboard',
  })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2024-01-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2024-12-31' })
  @ApiQuery({ name: 'search', required: false, example: 'Summit Heights' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  getAllScheduled(
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('dashboardId') dashboardId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.service.getAllScheduled({
      status,
      assignedTo,
      dashboardId,
      dateFrom,
      dateTo,
      search,
      page: +page,
      limit: +limit,
    });
  }

  @Get('scheduled/:scheduledInspectionId')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER, Role.OPERATIONAL)
  @ApiOperation({ summary: 'Get a single scheduled inspection by ID' })
  @ApiParam({
    name: 'scheduledInspectionId',
    description: 'CUID of the ScheduledInspection',
  })
  getOneScheduled(
    @Param('scheduledInspectionId') scheduledInspectionId: string,
    @Req() req: Request,
  ) {
    return this.service.getOneScheduled(
      scheduledInspectionId,
      req.user.userId,
      req.user.role,
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SCHEDULED INSPECTIONS — ACTIONS
  // ═════════════════════════════════════════════════════════════════════════

  @Patch('scheduled/:scheduledInspectionId/start')
  @Roles(Role.OPERATIONAL)
  @ApiOperation({
    summary: 'Start a scheduled inspection (Operational team)',
    description:
      'Changes status from ASSIGNED/DUE to IN_PROGRESS. ' +
      'Returns dashboardId + scheduledInspectionId to redirect to the inspection form.',
  })
  @ApiParam({
    name: 'scheduledInspectionId',
    description: 'CUID of the ScheduledInspection',
  })
  startInspection(
    @Param('scheduledInspectionId') scheduledInspectionId: string,
    @Req() req: Request,
  ) {
    return this.service.startInspection(
      scheduledInspectionId,
      req.user?.userId,
    );
  }

  @Delete(':inspectionId')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary:
      'Delete an inspection and its linked scheduled inspection (Admin only)',
    description:
      'Permanently deletes the Inspection record along with:\n\n' +
      '- All associated `MediaFile` records\n' +
      '- The linked `ScheduledInspection` record\n' +
      '- All `InspectionFolderItem` references\n\n' +
      '⚠️ This action is irreversible.',
  })
  @ApiParam({
    name: 'inspectionId',
    description: 'CUID of the Inspection to delete',
  })
  @ApiOkResponse({ description: 'Inspection deleted successfully.' })
  deleteInspection(
    @Param('inspectionId') inspectionId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteInspection(inspectionId, req.user.userId);
  }
}
