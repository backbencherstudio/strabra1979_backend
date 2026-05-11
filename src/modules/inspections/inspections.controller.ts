import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
  Delete,
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
  @Roles(
    Role.ADMIN,
    Role.OPERATIONAL,
    Role.AUTHORIZED_VIEWER,
    Role.PROPERTY_MANAGER,
  )
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
  @ApiOperation({
    summary: 'Submit a completed inspection',
    description:
      '**Requires** the scheduledInspectionId to be IN_PROGRESS status.\n\n' +
      'Files must be uploaded separately via the upload module. Pass their session IDs in `mediaSessions`.',
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
    type: SubmitInspectionDto,
    description:
      'Inspection data including header, scores, repair items, and media session references.',
  })
  @ApiCreatedResponse({ description: 'Inspection submitted successfully.' })
  submitInspection(
    @Param('dashboardId') dashboardId: string,
    @Param('scheduledInspectionId') scheduledInspectionId: string,
    @Body() dto: SubmitInspectionDto,
    @Req() req: Request,
  ) {
    return this.service.submitInspection(
      dashboardId,
      scheduledInspectionId,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  @Patch(':inspectionId')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({
    summary: 'Update an inspection before publishing (JSON only)',
  })
  @ApiParam({ name: 'inspectionId', description: 'CUID of the Inspection' })
  @ApiBody({ type: UpdateInspectionDto })
  @ApiOkResponse({ description: 'Inspection updated successfully.' })
  updateInspection(
    @Param('inspectionId') inspectionId: string,
    @Body() dto: UpdateInspectionDto,
    @Req() req: Request,
  ) {
    return this.service.updateInspection(inspectionId, req.user.userId, dto);
  }
  // ═════════════════════════════════════════════════════════════════════════
  // INSPECTION QUERIES
  // ═════════════════════════════════════════════════════════════════════════

  @Get('property/:dashboardId')
  @Roles(
    Role.ADMIN,
    Role.OPERATIONAL,
    Role.PROPERTY_MANAGER,
    Role.AUTHORIZED_VIEWER,
  )
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

  @Get('property/:dashboardId/info')
  @Roles(Role.ADMIN, Role.OPERATIONAL, Role.PROPERTY_MANAGER)
  @ApiOperation({ summary: 'Get property info by dashboardId' })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiOkResponse({ description: 'Property info returned.' })
  getPropertyInfo(
    @Param('dashboardId') dashboardId: string,
    @Req() req: Request,
  ) {
    return this.service.getPropertyInfo(
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
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by property name or address',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  getAssignedInspections(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.service.getAssignedInspections(req.user.userId, req.user.role, {
      status,
      search,
      page: +page,
      limit: +limit,
    });
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

  @Delete(':scheduledInspectionId')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary:
      'Delete a scheduled inspection and its linked inspection report (Admin only)',
    description:
      'Permanently deletes the ScheduledInspection record along with:\n\n' +
      '- The linked `Inspection` report (if submitted)\n' +
      '- All associated `MediaFile` records\n' +
      '- All `InspectionFolderItem` references\n\n' +
      '⚠️ If no inspection has been submitted yet, only the schedule is deleted.\n' +
      '⚠️ This action is irreversible.',
  })
  @ApiParam({
    name: 'scheduledInspectionId',
    description: 'CUID of the ScheduledInspection to delete',
  })
  @ApiOkResponse({ description: 'Scheduled inspection deleted successfully.' })
  deleteInspection(
    @Param('scheduledInspectionId') scheduledInspectionId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteInspection(
      scheduledInspectionId,
      req.user.userId,
    );
  }
}
