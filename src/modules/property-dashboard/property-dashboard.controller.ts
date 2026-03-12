import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PropertyDashboardService } from './property-dashboard.service';
import {
  CreatePropertyDto,
  ScheduleInspectionDto,
  SetAccessExpirationDto,
  UpdatePropertyDto,
  AssignPropertyUserDto,
} from './dto/property-dashboard.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { Request } from 'express';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';

@ApiTags('Property Dashboard')
@ApiBearerAuth(SWAGGER_AUTH.admin)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('properties')
export class PropertyDashboardController {
  constructor(private readonly service: PropertyDashboardService) {}

  // ─── LIST ALL PROPERTIES ──────────────────────────────────────────────────

  @Get()
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'List all properties (Property List page)',
    description:
      'Returns properties visible to the requesting user. ' +
      'Admins see all; Property Managers see only their own.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'search', required: false, example: 'Sunset Office' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['createdAt', 'name', 'updatedAt'],
    example: 'createdAt',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['asc', 'desc'],
    example: 'desc',
  })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2024-01-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2024-12-31' })
  findAll(
    @Req() req: Request,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy = 'createdAt',
    @Query('sortOrder') sortOrder = 'desc',
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAll(req.user?.userId, req.user?.role, {
      page: +page,
      limit: +limit,
      search,
      status,
      sortBy,
      sortOrder: sortOrder as 'asc' | 'desc',
      dateFrom,
      dateTo,
    });
  }

  // ─── CREATE PROPERTY + DASHBOARD ─────────────────────────────────────────

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create a new Property + Dashboard',
    description:
      'Creates both the Property record and its linked PropertyDashboard in a single ' +
      'transaction. A frozen snapshot of the template sections is stored on the dashboard.',
  })
  @ApiResponse({
    status: 400,
    description: 'No active template found or validation error.',
  })
  @ApiResponse({ status: 404, description: 'Property Manager not found.' })
  create(@Body() dto: CreatePropertyDto, @Req() req: Request) {
    return this.service.createProperty(dto, req.user?.userId);
  }

  // ─── GET SINGLE DASHBOARD ─────────────────────────────────────────────────

  @Get('dashboard/:dashboardId')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER, Role.AUTHORIZED_VIEWER)
  @ApiOperation({
    summary: 'Get full dashboard by dashboard ID',
    description:
      'Returns property info, latest inspection, documents, folders. ' +
      'Authorized Viewers must have explicit access.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiResponse({ status: 200, description: 'Dashboard with full detail.' })
  @ApiResponse({
    status: 404,
    description: 'Dashboard not found or no access.',
  })
  findOne(@Param('dashboardId') dashboardId: string, @Req() req: Request) {
    return this.service.findOne(dashboardId, req.user?.userId, req.user?.role);
  }

  // ─── UPDATE PROPERTY DETAILS ──────────────────────────────────────────────

  @Patch('dashboard/:dashboardId')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Update property details',
    description:
      'Partial update for name, address, type, or next inspection date.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiResponse({ status: 200, description: 'Updated property record.' })
  @ApiResponse({ status: 404, description: 'Dashboard not found.' })
  updateProperty(
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdatePropertyDto,
    @Req() req: Request,
  ) {
    return this.service.updateProperty(dashboardId, dto, req.user?.userId);
  }

  // ─── SCHEDULE INSPECTION ──────────────────────────────────────────────────

  @Post('dashboard/:dashboardId/schedule-inspection')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'Schedule (or reschedule) an inspection',
    description:
      'Sets the Next Inspection date on the property. ' +
      'Corresponds to the "Schedule an Inspection" modal on the Property List page.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiResponse({ status: 201, description: 'Inspection scheduled.' })
  @ApiResponse({ status: 404, description: 'Dashboard not found.' })
  scheduleInspection(
    @Param('dashboardId') dashboardId: string,
    @Body() dto: ScheduleInspectionDto,
    @Req() req: Request,
  ) {
    return this.service.scheduleInspection(
      dashboardId,
      dto,
      req.user?.userId,
      req.user?.role,
    );
  }

  // ─── ASSIGN USER TO PROPERTY ──────────────────────────────────────────────

  @Post('dashboard/:dashboardId/assign-user')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Assign Property Manager or grant access to a user',
    description:
      'If userId belongs to a PROPERTY_MANAGER, they become the property manager. ' +
      'All other roles get a PropertyAccess record (view access).',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiResponse({ status: 201, description: 'User assigned or access granted.' })
  @ApiResponse({ status: 404, description: 'Dashboard or User not found.' })
  assignUser(
    @Param('dashboardId') dashboardId: string,
    @Body() dto: AssignPropertyUserDto,
    @Req() req: Request,
  ) {
    return this.service.assignPropertyUser(dashboardId, dto, req.user?.userId);
  }

  // ─── GET ACCESS LIST ──────────────────────────────────────────────────────

  @Get('dashboard/:dashboardId/access')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Get the access list for a property dashboard',
    description:
      'Returns all users who currently have access to this dashboard. ' +
      'Corresponds to the "Property Dashboard Access" modal.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  getAccess(@Param('dashboardId') dashboardId: string, @Req() req: Request) {
    return this.service.getPropertyAccess(
      dashboardId,
      req.user?.userId,
      req.user?.role,
    );
  }

  // ─── SET ACCESS EXPIRATION ────────────────────────────────────────────────

  @Patch('dashboard/:dashboardId/access/expiration')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Set or update access expiration date for a user',
    description:
      "Updates when a specific user's access to this property expires. " +
      'Corresponds to the "Set access expiration date" option in the access list context menu.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiResponse({ status: 200, description: 'Expiration date updated.' })
  @ApiResponse({ status: 404, description: 'Dashboard or User not found.' })
  setExpiration(
    @Param('dashboardId') dashboardId: string,
    @Body() dto: SetAccessExpirationDto,
    @Req() req: Request,
  ) {
    return this.service.setAccessExpiration(dashboardId, dto, req.user?.userId);
  }
}
