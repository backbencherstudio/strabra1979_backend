import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import { PropertyAccessService } from './property-access.service';
import {
  RequestPropertyAccessDto,
  ReviewAccessRequestDto,
  ShareDashboardDto,
  RevokeAccessDto,
} from './dto/property-access.dto';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';
import { Request } from 'express';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { AccessRequestStatus } from 'prisma/generated/enums';

@ApiTags('Property Access')
@ApiBearerAuth(SWAGGER_AUTH.authorized_viewer)
// @ApiBearerAuth(SWAGGER_AUTH.admin)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('properties/dashboard/:dashboardId')
export class PropertyAccessController {
  constructor(private readonly service: PropertyAccessService) {}

  // ─── CHECK ACCESS ─────────────────────────────────────────────────────────

  @Get('access/check')
  @Roles(
    Role.ADMIN,
    Role.PROPERTY_MANAGER,
    Role.AUTHORIZED_VIEWER,
    Role.OPERATIONAL,
  )
  @ApiOperation({
    summary: 'Check if the current user can view this dashboard',
    description:
      'Returns hasAccess: true/false and a reason code when false. ' +
      'The frontend uses this to decide whether to show the dashboard ' +
      'or the "Access Not Granted" modal.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: [
        { hasAccess: true },
        { hasAccess: false, reason: 'NO_ACCESS' },
        { hasAccess: false, reason: 'REVOKED' },
        { hasAccess: false, reason: 'EXPIRED' },
      ],
    },
  })
  checkAccess(@Param('dashboardId') dashboardId: string, @Req() req: Request) {
    return this.service.checkDashboardAccess(
      dashboardId,
      req.user.userId,
      req.user.role,
    );
  }

  // ─── REQUEST ACCESS ───────────────────────────────────────────────────────

  @Post('access/request')
  @Roles(Role.AUTHORIZED_VIEWER)
  @ApiOperation({
    summary: 'Request access to a property dashboard',
    description:
      'Called when an Authorized Viewer clicks "Request Access". ' +
      'Creates a PropertyAccessRequest with status PENDING and notifies the PM.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiResponse({
    status: 201,
    description: 'Access request submitted. PM will be notified.',
  })
  @ApiResponse({
    status: 409,
    description: 'Already has access or pending request.',
  })
  requestAccess(
    @Param('dashboardId') dashboardId: string,
    @Body() dto: RequestPropertyAccessDto,
    @Req() req: Request,
  ) {
    return this.service.requestAccess(dashboardId, req.user.userId, dto);
  }

  // ─── GET ALL ACCESS REQUESTS ──────────────────────────────────────────────

  @Get('access/requests')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'Get all access requests for this dashboard (Admin / PM)',
    description:
      'Returns all PropertyAccessRequests. Optionally filter by status or requesterId.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiQuery({ name: 'status', required: false, enum: AccessRequestStatus })
  @ApiQuery({
    name: 'requesterId',
    required: false,
    description: 'Filter by requesting user',
  })
  getAllAccessRequests(
    @Param('dashboardId') dashboardId: string,
    @Query('status') status?: AccessRequestStatus,
    @Query('requesterId') requesterId?: string,
  ) {
    return this.service.getAllAccessRequests({
      dashboardId,
      status,
      requesterId,
    });
  }

  // ─── REVIEW REQUEST ───────────────────────────────────────────────────────

  @Patch('access/requests/:requestId/review')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'Approve or decline an access request (Property Manager / Admin)',
    description:
      'On APPROVED: creates a PropertyAccess row. ' +
      'On DECLINED: marks the request declined. Both notify the requester.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiParam({
    name: 'requestId',
    description: 'CUID of the PropertyAccessRequest',
  })
  @ApiResponse({ status: 200, description: 'Request reviewed.' })
  reviewRequest(
    @Param('dashboardId') dashboardId: string,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewAccessRequestDto,
    @Req() req: Request,
  ) {
    return this.service.reviewAccessRequest(
      dashboardId,
      requestId,
      req.user.userId,
      dto,
    );
  }

  // ─── SHARE DASHBOARD ──────────────────────────────────────────────────────

  @Post('access/share')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'Share dashboard directly via email or user ID (PM / Admin)',
    description:
      'Grants access immediately without a request/approval cycle. ' +
      'Sends a notification to the invited user.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiResponse({
    status: 201,
    description: 'Dashboard shared. User now has view access.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  shareDashboard(
    @Param('dashboardId') dashboardId: string,
    @Body() dto: ShareDashboardDto,
    @Req() req: Request,
  ) {
    return this.service.shareDashboard(dashboardId, req.user.userId, dto);
  }

  // ─── GET ACCESS LIST ──────────────────────────────────────────────────────

  @Get('access')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'Get all users with active access to this dashboard',
    description:
      'Returns active (non-revoked, non-expired) access records. ' +
      "Includes each user's name, email, avatar, role, and expiry date.",
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  getAccessList(@Param('dashboardId') dashboardId: string) {
    return this.service.getDashboardAccessList(dashboardId);
  }

  // ─── REVOKE ACCESS ────────────────────────────────────────────────────────

  @Delete('access/users/:targetUserId')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: "Revoke a user's access to this dashboard",
    description:
      'Sets revokedAt on the PropertyAccess record. ' +
      'The user will see "Access Not Granted" next time they open the dashboard.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiParam({ name: 'targetUserId', description: 'CUID of the user to remove' })
  @ApiResponse({ status: 200, description: 'Access revoked.' })
  @ApiResponse({ status: 404, description: 'Active access record not found.' })
  revokeAccess(
    @Param('dashboardId') dashboardId: string,
    @Param('targetUserId') targetUserId: string,
    @Body() dto: RevokeAccessDto,
    @Req() req: Request,
  ) {
    return this.service.revokeAccess(
      dashboardId,
      targetUserId,
      req.user.userId,
      dto,
    );
  }

  // ─── GET PENDING REQUESTS ─────────────────────────────────────────────────

  @Get('access/requests/pending')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'Get all pending access requests for this dashboard (PM / Admin)',
    description:
      'Returns all unreviewed access requests for the notification badge / list.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  getPendingRequests(@Param('dashboardId') dashboardId: string) {
    return this.service.getPendingRequests(dashboardId);
  }
}
