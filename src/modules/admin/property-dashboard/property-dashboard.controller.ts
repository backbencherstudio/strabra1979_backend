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
} from '@nestjs/swagger';
import { PropertyDashboardService } from './property-dashboard.service';
import {
  CreatePropertyDto,
  ScheduleInspectionDto,
  AssignPropertyManagerDto,
  GrantPropertyAccessDto,
  RevokePropertyAccessDto,
  SetAccessExpirationDto,
  UpdatePropertyDto,
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

  // ─── LOOKUP ENDPOINTS (used to populate form dropdowns) ──────────────────────

  //   @Get('lookup/property-managers')
  //   @ApiOperation({
  //     summary: 'List available Property Managers',
  //     description:
  //       'Returns all active users with the PROPERTY_MANAGER role. ' +
  //       'Used to populate the "Assign Property Manager" dropdown in the creation form.',
  //   })
  //   @ApiQuery({
  //     name: 'search',
  //     required: false,
  //     description: 'Filter by name or email',
  //     example: 'Leslie',
  //   })
  //   @ApiResponse({ status: 200, description: 'List of property managers.' })
  //   getPropertyManagers(@Query('search') search?: string) {
  //     return this.service.getAvailablePropertyManagers(search);
  //   }

  //   @Get('lookup/templates')
  //   @ApiOperation({
  //     summary: 'List available Dashboard Templates',
  //     description:
  //       'Returns all active dashboard templates. ' +
  //       'Used to populate the optional template selector. ' +
  //       'If no template is chosen the system uses the most recently created active template.',
  //   })
  //   @ApiResponse({ status: 200, description: 'List of active templates.' })
  //   getTemplates() {
  //     return this.service.getAvailableTemplates();
  //   }

  // ─── PROPERTY CRUD ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List all properties (Property List page)',
    description:
      'Returns properties visible to the requesting user. ' +
      'Admins see all; Property Managers see only their own; ' +
      'Authorized Viewers see their assigned dashboards.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of property records with dashboard meta.',
  })
  findAll(@Req() req: Request) {
    // req.user injected by JwtAuthGuard
    return this.service.findAll(req.user?.userId, req.user?.role);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create a new Property Dashboard',
    description:
      'Creates both the Property record and its linked PropertyDashboard in a single ' +
      'transaction. A frozen snapshot of the template sections is stored on the dashboard ' +
      'so future template edits never break existing dashboards. ' +
      'Triggers a notification to the assigned Property Manager.',
  })
  @ApiResponse({
    status: 400,
    description: 'No active template found or validation error.',
  })
  @ApiResponse({ status: 404, description: 'Property Manager not found.' })
  create(@Body() dto: CreatePropertyDto, @Req() req: Request) {
    return this.service.createProperty(dto, req.user?.userId);
  }

  @Get(':propertyId')
  @ApiOperation({
    summary: 'Get a single property with its full dashboard data',
    description:
      'Returns the property record, its latest inspection (for the Roof Health Snapshot), ' +
      'all non-archived documents, and the template snapshot used to render the dashboard sections.',
  })
  @ApiParam({
    name: 'propertyId',
    description: 'CUID of the property',
    example: 'clxyz001',
  })
  @ApiResponse({ status: 200, description: 'Property with dashboard detail.' })
  @ApiResponse({ status: 404, description: 'Property not found.' })
  findOne(@Param('propertyId') propertyId: string) {
    return this.service.findOne(propertyId);
  }

  @Patch(':propertyId')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Update property details',
    description:
      'Partial update for name, address, type, or next inspection date.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({ status: 200, description: 'Updated property record.' })
  @ApiResponse({ status: 404, description: 'Property not found.' })
  updateProperty(
    @Param('propertyId') propertyId: string,
    @Body() dto: UpdatePropertyDto,
    @Req() req: Request,
  ) {
    return this.service.updateProperty(propertyId, dto, req.user?.userId);
  }

  // ─── SCHEDULE INSPECTION ─────────────────────────────────────────────────────

  @Post(':propertyId/schedule-inspection')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'Schedule (or reschedule) an inspection',
    description:
      'Sets the Next Inspection date on the property. ' +
      'Reflects immediately on the property card and in dashboard header. ' +
      'Corresponds to the "Schedule an Inspection" modal on the Property List page.',
  })
  @ApiParam({
    name: 'propertyId',
    description: 'CUID of the property',
    example: 'clxyz001',
  })
  @ApiResponse({ status: 201, description: 'Inspection scheduled.' })
  @ApiResponse({ status: 404, description: 'Property not found.' })
  scheduleInspection(
    @Param('propertyId') propertyId: string,
    @Body() dto: ScheduleInspectionDto,
    @Req() req: Request,
  ) {
    return this.service.scheduleInspection(propertyId, dto, req.user?.userId);
  }

  // ─── ASSIGN PROPERTY MANAGER ──────────────────────────────────────────────────

  @Post(':propertyId/assign-manager')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Assign or change the Property Manager for a property',
    description:
      'Corresponds to the "Assign a Property Manager" action in the property card menu. ' +
      'Only PROPERTY_MANAGER role users are selectable.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({ status: 201, description: 'Property manager assigned.' })
  @ApiResponse({
    status: 404,
    description: 'Property or Property Manager not found.',
  })
  assignManager(
    @Param('propertyId') propertyId: string,
    @Body() dto: AssignPropertyManagerDto,
    @Req() req: Request,
  ) {
    return this.service.assignPropertyManager(
      propertyId,
      dto,
      req.user?.userId,
    );
  }

  // ─── PROPERTY ACCESS MANAGEMENT ──────────────────────────────────────────────

  @Get(':propertyId/access')
  @ApiOperation({
    summary: 'Get the access list for a property dashboard',
    description:
      'Returns all users who have access to this property dashboard. ' +
      'Corresponds to the "Property Dashboard Access" modal on the Property List page.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({
    status: 200,
    description: 'Property access list.',
    schema: {
      example: {
        id: 'clxyz001',
        propertyManager: {
          id: 'clxyz002',
          name: 'Leslie Alexander',
          email: 'sara.cruz@example.com',
          role: 'PROPERTY_MANAGER',
          access_expires_at: null,
        },
      },
    },
  })
  getAccess(@Param('propertyId') propertyId: string) {
    return this.service.getPropertyAccess(propertyId);
  }

  @Post(':propertyId/access/grant')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Grant a user access to a property dashboard',
    description:
      'Grants an Authorized Viewer or other user access to this property. ' +
      'An optional access expiration date can be set — ideal for insurers and consultants.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({ status: 201, description: 'Access granted.' })
  @ApiResponse({ status: 404, description: 'Property or User not found.' })
  grantAccess(
    @Param('propertyId') propertyId: string,
    @Body() dto: GrantPropertyAccessDto,
    @Req() req: Request,
  ) {
    return this.service.grantAccess(propertyId, dto, req.user?.userId);
  }

  @Post(':propertyId/access/revoke')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: "Revoke a user's access to a property dashboard",
    description:
      'Immediately revokes access. ' +
      'Corresponds to the "Revoke access" option in the access list context menu.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({ status: 201, description: 'Access revoked.' })
  @ApiResponse({ status: 404, description: 'Property or User not found.' })
  revokeAccess(
    @Param('propertyId') propertyId: string,
    @Body() dto: RevokePropertyAccessDto,
    @Req() req: Request,
  ) {
    return this.service.revokeAccess(propertyId, dto, req.user?.userId);
  }

  @Patch(':propertyId/access/expiration')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Set or update an access expiration date for a user',
    description:
      "Updates when a specific user's access to this property expires. " +
      'Corresponds to the "Set access expiration date" option in the access list context menu.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({ status: 200, description: 'Expiration date updated.' })
  @ApiResponse({ status: 404, description: 'Property or User not found.' })
  setExpiration(
    @Param('propertyId') propertyId: string,
    @Body() dto: SetAccessExpirationDto,
    @Req() req: Request,
  ) {
    return this.service.setAccessExpiration(propertyId, dto, req.user?.userId);
  }
}
