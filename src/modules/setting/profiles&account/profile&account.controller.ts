import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateTimezoneDto } from './dto/update-timezone.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { ProfileService } from './profile&account.service';
import { UpdateNotificationPreferencesDto } from './dto/notification-preference.dto';

@ApiTags('Profile & Account')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // ─── GET PROFILE ───────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Returns the authenticated user\'s profile, including general info, timezone, and notification preferences.',
  })
  @ApiOkResponse({
    description: 'Profile fetched successfully',
    schema: {
      example: {
        success: true,
        message: 'Profile fetched successfully',
        data: {
          id: 'cmm02r3ri0000uku8do7v286a',
          email: 'yoursilentwhistle@email.com',
          username: 'gustavo_x',
          first_name: 'Gustavo',
          last_name: 'Xavier',
          avatar: null,
          role: 'AUTHORIZED_VIEWER',
          status: 'ACTIVE',
          timezone: 'America/Guatemala',
          email_verified_at: '2025-01-16T02:06:00.000Z',
          notif_new_property_dashboard_assigned: true,
          notif_property_dashboard_access_request: true,
          notif_property_dashboard_update: true,
          created_at: '2025-01-16T02:06:00.000Z',
          updated_at: '2025-01-16T02:06:00.000Z',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @Get()
  async getProfile(@Req() req: Request) {
    return this.profileService.getProfile(req.user['userId']);
  }

  // ─── UPDATE GENERAL SETTINGS ───────────────────────────────────────────────

  @ApiOperation({
    summary: 'Update general settings',
    description:
      'Update the authenticated user\'s first name, last name, or email address. Changing email will reset email verification.',
  })
  @ApiOkResponse({
    description: 'Profile updated successfully',
    schema: {
      example: {
        success: true,
        message: 'Profile updated successfully',
        data: {
          id: 'cmm02r3ri0000uku8do7v286a',
          email: 'yoursilentwhistle@email.com',
          first_name: 'Gustavo',
          last_name: 'Xavier',
          updated_at: '2025-01-16T02:12:00.000Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @ApiConflictResponse({ description: 'Email is already in use' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @Patch('general')
  async updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user['userId'], dto);
  }

  // ─── CHANGE PASSWORD ───────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Change password',
    description:
      'Change the authenticated user\'s password. Requires the current password for verification. New password must be at least 8 characters and different from the current one.',
  })
  @ApiOkResponse({
    description: 'Password changed successfully',
    schema: {
      example: {
        success: true,
        message: 'Password changed successfully',
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Current password is incorrect / passwords do not match / new password same as old',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @Patch('change-password')
  async changePassword(
    @Req() req: Request,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.profileService.changePassword(req.user['userId'], dto);
  }

  // ─── UPDATE TIMEZONE ───────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Update timezone settings',
    description:
      'Set the user\'s timezone. Toggle auto_timezone to true to use system/browser timezone, or set auto_timezone to false and provide an IANA timezone string (e.g. "America/Guatemala").',
  })
  @ApiOkResponse({
    description: 'Timezone updated successfully',
    schema: {
      example: {
        success: true,
        message: 'Timezone updated successfully',
        data: {
          id: 'cmm02r3ri0000uku8do7v286a',
          timezone: 'America/Guatemala',
          updated_at: '2025-01-16T02:12:00.000Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'timezone is required when auto_timezone is false',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @Patch('timezone')
  async updateTimezone(
    @Req() req: Request,
    @Body() dto: UpdateTimezoneDto,
  ) {
    return this.profileService.updateTimezone(req.user['userId'], dto);
  }

  // ─── UPDATE NOTIFICATION PREFERENCES ──────────────────────────────────────

  @ApiOperation({
    summary: 'Update notification preferences',
    description:
      'Toggle email notification preferences for the authenticated user. All fields are optional — only the provided fields will be updated.',
  })
  @ApiOkResponse({
    description: 'Notification preferences updated successfully',
    schema: {
      example: {
        success: true,
        message: 'Notification preferences updated successfully',
        data: {
          id: 'cmm02r3ri0000uku8do7v286a',
          notif_new_property_dashboard_assigned: true,
          notif_property_dashboard_access_request: false,
          notif_property_dashboard_update: true,
          updated_at: '2025-01-16T02:12:00.000Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @Patch('notifications')
  async updateNotificationPreferences(
    @Req() req: Request,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.profileService.updateNotificationPreferences(
      req.user['userId'],
      dto,
    );
  }
}