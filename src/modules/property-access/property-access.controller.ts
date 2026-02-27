import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PropertyAccessService } from './property-access.service';
import {
  RequestPropertyAccessDto,
  ReviewAccessRequestDto,
  ShareDashboardDto,
  RevokeAccessDto,
} from './dto/property-access.dto';

@ApiTags('Property Access')
@ApiBearerAuth()
@Controller('properties/:propertyId')
export class PropertyAccessController {
  constructor(private readonly service: PropertyAccessService) {}

  // ─── CHECK ACCESS (called when Authorized Viewer opens a property) ────────

  @Get('access/check')
  @ApiOperation({
    summary: 'Check if the current user can view this dashboard',
    description:
      'Called when any user navigates to a property dashboard. ' +
      'Returns hasAccess: true/false and a reason code when false. ' +
      'The frontend uses this to decide whether to show the dashboard ' +
      'or the "Access Not Granted" modal (Image 3).',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({
    status: 200,
    schema: {
      example: [
        { hasAccess: true },
        { hasAccess: false, reason: 'NO_ACCESS' },   // → show "Request Access" modal
        { hasAccess: false, reason: 'REVOKED' },      // → show "Access Revoked" message
        { hasAccess: false, reason: 'EXPIRED' },      // → show "Access Expired" message
      ],
    },
  })
  checkAccess(@Param('propertyId') propertyId: string, @Request() req: any) {
    return this.service.checkDashboardAccess(
      propertyId,
      req.user.id,
      req.user.role,
    );
  }

  // ─── STEP 1: Authorized Viewer clicks "Request Access" (Image 3) ──────────

  @Post('access/request')
  @ApiOperation({
    summary: 'Request access to a property dashboard',
    description:
      'Called when an Authorized Viewer clicks "Request Access" on the ' +
      '"Access Not Granted" modal (Image 3). ' +
      'Creates a PropertyAccessRequest with status PENDING and sends a ' +
      'real-time notification to the Property Manager (or Admin if no PM assigned).',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({
    status: 201,
    description: 'Access request submitted. PM will be notified.',
    schema: {
      example: {
        id: 'req_clxyz001',
        propertyId: 'clxyz001',
        requesterId: 'clxyz002',
        status: 'PENDING',
        message: 'I am the assigned insurer for this building.',
        createdAt: '2026-01-16T02:06:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 409, description: 'Already has access or pending request.' })
  requestAccess(
    @Param('propertyId') propertyId: string,
    @Body() dto: RequestPropertyAccessDto,
    @Request() req: any,
  ) {
    return this.service.requestAccess(propertyId, req.user.id, dto);
  }

  // ─── STEP 2: PM clicks Accept / Decline in notification (Image 2) ─────────

  @Patch('access/requests/:requestId/review')
  @ApiOperation({
    summary: 'Approve or decline an access request (Property Manager / Admin)',
    description:
      'Called when the Property Manager clicks "Accept" or "Decline" in the ' +
      'notification panel (Image 2). ' +
      'On APPROVED: creates a PropertyAccess row so the user can now enter the dashboard. ' +
      'On DECLINED: marks the request declined and notifies the requester. ' +
      'Both actions send a notification back to the requester.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiParam({ name: 'requestId', description: 'CUID of the PropertyAccessRequest' })
  @ApiResponse({
    status: 200,
    description: 'Request reviewed.',
    schema: {
      example: {
        message: 'Access approved.',
        requestId: 'req_clxyz001',
        propertyId: 'clxyz001',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Request already reviewed or missing decline reason.' })
  @ApiResponse({ status: 403, description: 'Not the Property Manager for this dashboard.' })
  @ApiResponse({ status: 404, description: 'Request not found.' })
  reviewRequest(
    @Param('propertyId') propertyId: string,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewAccessRequestDto,
    @Request() req: any,
  ) {
    return this.service.reviewAccessRequest(requestId, req.user.id, dto);
  }

  // ─── SHARE DASHBOARD directly (Image 1 — Share modal "Invite" button) ─────

  @Post('access/share')
  @ApiOperation({
    summary: 'Share dashboard directly via email or user ID (PM / Admin)',
    description:
      'Called when the PM clicks "Invite" in the Share modal (Image 1). ' +
      'Grants access immediately without requiring a request/approval cycle. ' +
      'Resolves the target user by email or user ID. ' +
      'Sends a "New Property Dashboard Assigned" notification to the invited user.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({
    status: 201,
    description: 'Dashboard shared. User now has view access.',
    schema: {
      example: {
        message: 'Access granted to insurer@example.com.',
        user: {
          id: 'clxyz003',
          name: 'Gustavo Xavier',
          email: 'insurer@example.com',
          avatar: null,
          expiresAt: null,
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  shareDashboard(
    @Param('propertyId') propertyId: string,
    @Body() dto: ShareDashboardDto,
    @Request() req: any,
  ) {
    return this.service.shareDashboard(propertyId, req.user.id, dto);
  }

  // ─── GET ACCESS LIST (Image 1 — "Who has view access" list) ──────────────

  @Get('access')
  @ApiOperation({
    summary: 'Get all users with active access to this dashboard',
    description:
      'Returns the list shown in the Share modal (Image 1) under "Who has view access". ' +
      'Excludes revoked and expired access records. ' +
      'Includes each user\'s name, email, avatar, role, and expiry date.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({
    status: 200,
    schema: {
      example: [
        {
          id: 'access_clxyz001',
          grantedAt: '2026-01-16T02:06:00.000Z',
          expiresAt: null,
          user: {
            id: 'clxyz002',
            name: 'Gustavo Xavier',
            email: 'manhachkt08@gmail.com',
            role: 'AUTHORIZED_VIEWER',
          },
        },
      ],
    },
  })
  getAccessList(@Param('propertyId') propertyId: string) {
    return this.service.getDashboardAccessList(propertyId);
  }

  // ─── REVOKE ACCESS (Image 1 — "Remove" button next to a user) ────────────

  @Delete('access/users/:targetUserId')
  @ApiOperation({
    summary: 'Revoke a user\'s access to this dashboard',
    description:
      'Called when the PM clicks "Remove" next to a user in the Share modal (Image 1). ' +
      'Sets revokedAt on the PropertyAccess record. ' +
      'The user will see "Access Not Granted" next time they try to open the dashboard.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiParam({ name: 'targetUserId', description: 'CUID of the user to remove' })
  @ApiResponse({ status: 200, description: 'Access revoked.' })
  @ApiResponse({ status: 404, description: 'Active access record not found.' })
  revokeAccess(
    @Param('propertyId') propertyId: string,
    @Param('targetUserId') targetUserId: string,
    @Body() dto: RevokeAccessDto,
    @Request() req: any,
  ) {
    return this.service.revokeAccess(propertyId, targetUserId, req.user.id, dto);
  }

  // ─── GET PENDING REQUESTS (for PM notification badge / list) ─────────────

  @Get('access/requests/pending')
  @ApiOperation({
    summary: 'Get all pending access requests for this property (PM / Admin)',
    description:
      'Returns all unreviewed access requests. ' +
      'Can be used to build a dedicated requests list or to populate notification counts.',
  })
  @ApiParam({ name: 'propertyId', description: 'CUID of the property' })
  @ApiResponse({
    status: 200,
    schema: {
      example: [
        {
          id: 'req_clxyz001',
          status: 'PENDING',
          message: 'I am the assigned insurer.',
          createdAt: '2026-01-16T02:06:00.000Z',
          requester: {
            id: 'clxyz002',
            name: 'Gustavo Xavier',
            email: 'manhachkt08@gmail.com',
          },
        },
      ],
    },
  })
  getPendingRequests(@Param('propertyId') propertyId: string) {
    return this.service.getPendingRequests(propertyId);
  }
}