import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateUserLevelNotificationsDto } from './dto/update-user-level-notification.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UpdateAdminNotificationsDto } from './dto/update-admin-notification.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Singleton IDs ────────────────────────────────────────────────────────
  // Both UserLevelNotificationSettings and BrandingSettings are singleton
  // records — one row each, always upserted on the same fixed ID.
  private readonly ULNS_ID = 'singleton_ulns';
  private readonly BRANDING_ID = 'singleton_branding';

  // ═══════════════════════════════════════════════════════════════════════════
  //  TAB 1 – MY NOTIFICATIONS  (admin's own personal notification prefs)
  //  These are stored directly on the User model, scoped to the logged-in admin.
  // ═══════════════════════════════════════════════════════════════════════════

  async getAdminNotifications(adminId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: adminId, isDeleted: false },
      select: {
        id: true,
        notif_admin_new_user_registration: true,
        notif_admin_due_inspection: true,
        notif_admin_new_inspection_report_update: true,
      },
    });

    if (!user) throw new NotFoundException('Admin user not found');

    return {
      success: true,
      message: 'Admin notification preferences fetched successfully',
      data: user,
    };
  }

  async updateAdminNotifications(
    adminId: string,
    dto: UpdateAdminNotificationsDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: adminId, isDeleted: false },
    });

    if (!user) throw new NotFoundException('Admin user not found');

    const updated = await this.prisma.user.update({
      where: { id: adminId },
      data: {
        ...(dto.notif_admin_new_user_registration !== undefined && {
          notif_admin_new_user_registration: dto.notif_admin_new_user_registration,
        }),
        ...(dto.notif_admin_due_inspection !== undefined && {
          notif_admin_due_inspection: dto.notif_admin_due_inspection,
        }),
        ...(dto.notif_admin_new_inspection_report_update !== undefined && {
          notif_admin_new_inspection_report_update:
            dto.notif_admin_new_inspection_report_update,
        }),
        updated_at: new Date(),
      },
      select: {
        id: true,
        notif_admin_new_user_registration: true,
        notif_admin_due_inspection: true,
        notif_admin_new_inspection_report_update: true,
        updated_at: true,
      },
    });

    return {
      success: true,
      message: 'Admin notification preferences updated successfully',
      data: updated,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  TAB 2 – USER LEVEL NOTIFICATION SETTINGS  (system-wide role defaults)
  //  Singleton record. Defines default on/off state for each role's notifications.
  //  When a new user is approved, these defaults are copied to their User record.
  // ═══════════════════════════════════════════════════════════════════════════

  async getUserLevelNotificationSettings() {
    // Upsert ensures the singleton row always exists with schema defaults
    const settings = await this.prisma.userLevelNotificationSettings.upsert({
      where: { id: this.ULNS_ID },
      create: { id: this.ULNS_ID },
      update: {},
    });

    return {
      success: true,
      message: 'User level notification settings fetched successfully',
      data: settings,
    };
  }

  async updateUserLevelNotificationSettings(
    adminId: string,
    dto: UpdateUserLevelNotificationsDto,
  ) {
    const updated = await this.prisma.userLevelNotificationSettings.upsert({
      where: { id: this.ULNS_ID },
      create: {
        id: this.ULNS_ID,
        updated_by: adminId,
        ...dto,
      },
      update: {
        updated_by: adminId,
        updated_at: new Date(),
        // Property Manager
        ...(dto.pm_new_property_dashboard_assigned !== undefined && {
          pm_new_property_dashboard_assigned:
            dto.pm_new_property_dashboard_assigned,
        }),
        ...(dto.pm_property_dashboard_access_request !== undefined && {
          pm_property_dashboard_access_request:
            dto.pm_property_dashboard_access_request,
        }),
        ...(dto.pm_property_dashboard_update !== undefined && {
          pm_property_dashboard_update: dto.pm_property_dashboard_update,
        }),
        // Authorized Viewer
        ...(dto.av_new_property_dashboard_invitation !== undefined && {
          av_new_property_dashboard_invitation:
            dto.av_new_property_dashboard_invitation,
        }),
        ...(dto.av_access_request_update !== undefined && {
          av_access_request_update: dto.av_access_request_update,
        }),
        ...(dto.av_property_dashboard_update !== undefined && {
          av_property_dashboard_update: dto.av_property_dashboard_update,
        }),
        // Operational Team
        ...(dto.ot_new_inspection_assigned !== undefined && {
          ot_new_inspection_assigned: dto.ot_new_inspection_assigned,
        }),
        ...(dto.ot_due_inspection !== undefined && {
          ot_due_inspection: dto.ot_due_inspection,
        }),
        ...(dto.ot_incomplete_inspection_report !== undefined && {
          ot_incomplete_inspection_report:
            dto.ot_incomplete_inspection_report,
        }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: adminId,
        entity_type: 'user_level_notification_settings',
        entity_id: this.ULNS_ID,
        action: 'user_level_notifications_updated',
        metadata: { fields_changed: Object.keys(dto) },
      },
    });

    return {
      success: true,
      message: 'User level notification settings updated successfully',
      data: updated,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BRANDING SETTINGS  (singleton)
  //  Controls platform-wide visual identity: logo, colors, onboarding images.
  // ═══════════════════════════════════════════════════════════════════════════

  async getBrandingSettings() {
    const settings = await this.prisma.brandingSettings.upsert({
      where: { id: this.BRANDING_ID },
      create: { id: this.BRANDING_ID },
      update: {},
    });

    return {
      success: true,
      message: 'Branding settings fetched successfully',
      data: settings,
    };
  }

  async updateBrandingSettings(adminId: string, dto: UpdateBrandingDto) {
    const updated = await this.prisma.brandingSettings.upsert({
      where: { id: this.BRANDING_ID },
      create: {
        id: this.BRANDING_ID,
        updated_by: adminId,
        ...dto,
      },
      update: {
        updated_by: adminId,
        updated_at: new Date(),
        ...(dto.platform_name !== undefined && {
          platform_name: dto.platform_name,
        }),
        ...(dto.platform_logo_url !== undefined && {
          platform_logo_url: dto.platform_logo_url,
        }),
        ...(dto.signup_onboarding_image_url !== undefined && {
          signup_onboarding_image_url: dto.signup_onboarding_image_url,
        }),
        ...(dto.login_onboarding_image_url !== undefined && {
          login_onboarding_image_url: dto.login_onboarding_image_url,
        }),
        ...(dto.primary_color !== undefined && {
          primary_color: dto.primary_color,
        }),
        ...(dto.primary_color_label !== undefined && {
          primary_color_label: dto.primary_color_label,
        }),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: adminId,
        entity_type: 'branding_settings',
        entity_id: this.BRANDING_ID,
        action: 'branding_settings_updated',
        metadata: { fields_changed: Object.keys(dto) },
      },
    });

    return {
      success: true,
      message: 'Branding settings updated successfully',
      data: updated,
    };
  }
}