import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateTimezoneDto } from './dto/update-timezone.dto';
import { UpdateNotificationPreferencesDto } from './dto/notification-preference.dto';
import { Role } from 'src/common/guard/role/role.enum';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── GET PROFILE ──────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      select: {
        id: true,
        email: true,
        username: true,
        first_name: true,
        last_name: true,
        avatar: true,
        role: true,
        status: true,
        timezone: true,
        email_verified_at: true,
        // Property Manager notifications
        notif_pm_new_property_dashboard_assigned: true,
        notif_pm_property_dashboard_access_request: true,
        notif_pm_property_dashboard_update: true,
        // Authorized Viewer notifications
        notif_av_new_property_dashboard_invitation: true,
        notif_av_access_request_update: true,
        notif_av_property_dashboard_update: true,
        // Operational Team notifications
        notif_ot_new_inspection_assigned: true,
        notif_ot_due_inspection: true,
        notif_ot_incomplete_inspection_report: true,
        // Admin notifications
        notif_admin_new_user_registration: true,
        notif_admin_due_inspection: true,
        notif_admin_new_inspection_report_update: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      success: true,
      message: 'Profile fetched successfully',
      data: user,
    };
  }

  // ─── UPDATE PROFILE (name / email) ────────────────────────────────────────

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
    });

    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.first_name !== undefined && { first_name: dto.first_name }),
        ...(dto.last_name !== undefined && { last_name: dto.last_name }),
        updated_at: new Date(),
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        updated_at: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        entity_type: 'user',
        entity_id: userId,
        action: 'profile_updated',
        metadata: { fields_changed: Object.keys(dto) },
      },
    });

    return {
      success: true,
      message: 'Profile updated successfully',
      data: updated,
    };
  }

  // ─── CHANGE PASSWORD ──────────────────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.new_password !== dto.confirm_new_password) {
      throw new BadRequestException(
        'new_password and confirm_new_password do not match',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      select: { id: true, password: true },
    });

    if (!user) throw new NotFoundException('User not found');

    if (!user.password) {
      throw new BadRequestException(
        'No password set for this account. Use password reset instead.',
      );
    }

    const isMatch = await bcrypt.compare(dto.current_password, user.password);
    if (!isMatch)
      throw new BadRequestException('Current password is incorrect');

    if (dto.current_password === dto.new_password) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const hashed = await bcrypt.hash(dto.new_password, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, updated_at: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        entity_type: 'user',
        entity_id: userId,
        action: 'password_changed',
        metadata: {},
      },
    });

    return { success: true, message: 'Password changed successfully' };
  }

  // ─── UPDATE TIMEZONE ──────────────────────────────────────────────────────

  async updateTimezone(userId: string, dto: UpdateTimezoneDto) {
    if (!dto.auto_timezone && !dto.timezone) {
      throw new BadRequestException(
        'timezone is required when auto_timezone is false',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
    });

    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        timezone: dto.auto_timezone ? 'auto' : dto.timezone,
        updated_at: new Date(),
      },
      select: { id: true, timezone: true, updated_at: true },
    });

    return {
      success: true,
      message: 'Timezone updated successfully',
      data: updated,
    };
  }

  // ─── UPDATE NOTIFICATION PREFERENCES ─────────────────────────────────────
  //
  // Only fields that exist on the User model are passed to Prisma.
  // The frontend should send only the fields relevant to the user's role,
  // but the service accepts any valid subset for flexibility.
  //
  async updateNotificationPreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      select: { id: true, role: true },
    });

    if (!user) throw new NotFoundException('User not found');

    // Build update payload — only include fields present in dto
    const data: Record<string, boolean> = {};

    const boolField = (key: keyof UpdateNotificationPreferencesDto) => {
      if (dto[key] !== undefined) data[key] = dto[key] as boolean;
    };

    // Property Manager fields
    boolField('notif_pm_new_property_dashboard_assigned');
    boolField('notif_pm_property_dashboard_access_request');
    boolField('notif_pm_property_dashboard_update');

    // Authorized Viewer fields
    boolField('notif_av_new_property_dashboard_invitation');
    boolField('notif_av_access_request_update');
    boolField('notif_av_property_dashboard_update');

    // Operational Team fields
    boolField('notif_ot_new_inspection_assigned');
    boolField('notif_ot_due_inspection');
    boolField('notif_ot_incomplete_inspection_report');

    // Admin fields
    boolField('notif_admin_new_user_registration');
    boolField('notif_admin_due_inspection');
    boolField('notif_admin_new_inspection_report_update');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { ...data, updated_at: new Date() },
      select: {
        id: true,
        // Return only the fields relevant to this user's role
        ...(user.role === Role.PROPERTY_MANAGER && {
          notif_pm_new_property_dashboard_assigned: true,
          notif_pm_property_dashboard_access_request: true,
          notif_pm_property_dashboard_update: true,
        }),
        ...(user.role === Role.AUTHORIZED_VIEWER && {
          notif_av_new_property_dashboard_invitation: true,
          notif_av_access_request_update: true,
          notif_av_property_dashboard_update: true,
        }),
        ...(user.role === Role.OPERATIONAL && {
          notif_ot_new_inspection_assigned: true,
          notif_ot_due_inspection: true,
          notif_ot_incomplete_inspection_report: true,
        }),
        ...(user.role === Role.ADMIN && {
          notif_admin_new_user_registration: true,
          notif_admin_due_inspection: true,
          notif_admin_new_inspection_report_update: true,
        }),
        updated_at: true,
      },
    });

    return {
      success: true,
      message: 'Notification preferences updated successfully',
      data: updated,
    };
  }
}
