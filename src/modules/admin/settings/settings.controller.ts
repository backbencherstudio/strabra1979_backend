import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateAdminNotificationsDto } from './dto/update-admin-notification.dto';
import { UpdateUserLevelNotificationsDto } from './dto/update-user-level-notification.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';

@ApiTags('Admin – Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // ─── MY NOTIFICATIONS ────────────────────────────────────────────────────

  @Get('notifications/my')
  @ApiOperation({ summary: "Get admin's own notification preferences" })
  @ApiOkResponse({ description: 'Admin notification preferences returned' })
  getAdminNotifications(@Request() req) {
    return this.settingsService.getAdminNotifications(req.user.userId);
  }

  @Patch('notifications/my')
  @ApiOperation({ summary: "Update admin's own notification preferences" })
  @ApiOkResponse({ description: 'Admin notification preferences updated' })
  updateAdminNotifications(
    @Request() req,
    @Body() dto: UpdateAdminNotificationsDto,
  ) {
    return this.settingsService.updateAdminNotifications(req.user.userId, dto);
  }

  // ─── USER LEVEL NOTIFICATION SETTINGS (system-wide role defaults) ─────────

  @Get('notifications/user-level')
  @ApiOperation({ summary: 'Get system-wide default notification settings per role' })
  @ApiOkResponse({ description: 'User level notification settings returned' })
  getUserLevelNotificationSettings() {
    return this.settingsService.getUserLevelNotificationSettings();
  }

  @Patch('notifications/user-level')
  @ApiOperation({ summary: 'Update system-wide default notification settings per role' })
  @ApiOkResponse({ description: 'User level notification settings updated' })
  updateUserLevelNotificationSettings(
    @Request() req,
    @Body() dto: UpdateUserLevelNotificationsDto,
  ) {
    return this.settingsService.updateUserLevelNotificationSettings(
      req.user.userId,
      dto,
    );
  }

  // ─── BRANDING SETTINGS ───────────────────────────────────────────────────

  @Get('branding')
  @ApiOperation({ summary: 'Get platform branding settings' })
  @ApiOkResponse({ description: 'Branding settings returned' })
  getBrandingSettings() {
    return this.settingsService.getBrandingSettings();
  }

  @Patch('branding')
  @ApiOperation({ summary: 'Update platform branding settings' })
  @ApiOkResponse({ description: 'Branding settings updated' })
  updateBrandingSettings(@Request() req, @Body() dto: UpdateBrandingDto) {
    return this.settingsService.updateBrandingSettings(req.user.userId, dto);
  }
}