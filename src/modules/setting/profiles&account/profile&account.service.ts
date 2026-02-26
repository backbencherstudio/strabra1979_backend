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

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── GET PROFILE ─────────────────────────────────────────────────────────────

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
        // Notification preferences
        notif_new_property_dashboard_assigned: true,
        notif_property_dashboard_access_request: true,
        notif_property_dashboard_update: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      success: true,
      message: 'Profile fetched successfully',
      data: user,
    };
  }

  // ─── UPDATE GENERAL SETTINGS (name / email) ───────────────────────────────

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

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
        metadata: {
          fields_changed: Object.keys(dto),
        },
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

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.password) {
      throw new BadRequestException(
        'No password set for this account. Use password reset instead.',
      );
    }

    const isMatch = await bcrypt.compare(dto.current_password, user.password);
    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect');
    }

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

    return {
      success: true,
      message: 'Password changed successfully',
    };
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

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        timezone: dto.auto_timezone ? 'auto' : dto.timezone,
        updated_at: new Date(),
      },
      select: {
        id: true,
        timezone: true,
        updated_at: true,
      },
    });

    return {
      success: true,
      message: 'Timezone updated successfully',
      data: updated,
    };
  }

  // ─── UPDATE NOTIFICATION PREFERENCES ─────────────────────────────────────

  async updateNotificationPreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.notif_new_property_dashboard_assigned !== undefined && {
          notif_new_property_dashboard_assigned:
            dto.notif_new_property_dashboard_assigned,
        }),
        ...(dto.notif_property_dashboard_access_request !== undefined && {
          notif_property_dashboard_access_request:
            dto.notif_property_dashboard_access_request,
        }),
        ...(dto.notif_property_dashboard_update !== undefined && {
          notif_property_dashboard_update: dto.notif_property_dashboard_update,
        }),
        updated_at: new Date(),
      },
      select: {
        id: true,
        notif_new_property_dashboard_assigned: true,
        notif_property_dashboard_access_request: true,
        notif_property_dashboard_update: true,
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