import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ChangeUserStatusDto } from './dto/change-user-status.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserStatus } from 'prisma/generated/enums';
import { UpdateUserRoleDto } from './dto/change-role.dto';
import { Prisma } from 'prisma/generated/client';
import appConfig from 'src/config/app.config';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class UserManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async findAll(filters: {
    page: number;
    limit: number;
    role?: string;
    status?: string;
    search?: string;
  }) {
    const { page, limit, role, status, search } = filters;
    const skip = (page - 1) * limit;

    const where: any = {
      ...(role && { role }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          email: true,
          username: true,
          first_name: true,
          last_name: true,
          avatar: true,
          role: true,
          status: true,
          approved_at: true,
          access_expires_at: true,
          created_at: true,
          updated_at: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const total_pages = Math.ceil(total / limit);

    return {
      success: true,
      message: 'Users fetched successfully',
      data: users,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        has_next_page: page < total_pages,
        has_prev_page: page > 1,
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id },
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
        approved_at: true,
        approved_by: true,
        access_expires_at: true,
        access_revoked_at: true,
        access_revoked_by: true,
        email_verified_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      success: true,
      message: 'User fetched successfully',
      data: user,
    };
  }

  async getUserAssignedProperties(
    userId: string,
    page = 1,
    limit = 10,
    search?: string,
  ) {
    const skip = (page - 1) * limit;

    const whereClause: Prisma.PropertyAccessWhereInput = {
      userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      property: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { address: { contains: search, mode: 'insensitive' } },
              { propertyType: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
    };

    const [total, accesses] = await Promise.all([
      this.prisma.propertyAccess.count({ where: whereClause }),

      this.prisma.propertyAccess.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { grantedAt: 'desc' },
        include: {
          user: {
            select: { role: true },
          },
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              propertyType: true,
              dashboard: { select: { id: true } },
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      message: 'Assigned properties fetched successfully',
      data: accesses.map((a) => ({
        accessId: a.id,
        grantedAt: a.grantedAt,
        expiresAt: a.expiresAt,
        role: a.user.role,
        property: {
          propertyId: a.property.id,
          name: a.property.name,
          address: a.property.address,
          propertyType: a.property.propertyType,
          dashboardId: a.property.dashboard?.id ?? null,
        },
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async changeStatus(id: string, dto: ChangeUserStatusDto, currentUser: any) {
    const user = await this.prisma.user.findFirst({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Prevent admin from deactivating themselves
    if (id === currentUser.userId) {
      throw new BadRequestException('You cannot change your own status');
    }

    const platformName = appConfig().app.name ?? 'Platform';
    const adminName =
      `${currentUser.first_name} ${currentUser.last_name}`.trim() ||
      currentUser.email;

    // Build update payload based on status
    const updateData: any = { status: dto.status };

    if (dto.status === UserStatus.ACTIVE) {
      updateData.approved_at = new Date();
      updateData.approved_by = currentUser.userId;
      updateData.access_revoked_at = null;
      updateData.access_revoked_by = null;
      updateData.deleted_at = null;
      updateData.deletedReason = null;
    }

    if (dto.status === UserStatus.DEACTIVATED) {
      updateData.access_revoked_at = new Date();
      updateData.access_revoked_by = currentUser.userId;
    }

    if (dto.status === UserStatus.DELETED) {
      updateData.deleted_at = new Date();
      updateData.access_revoked_at = new Date();
      updateData.access_revoked_by = currentUser.userId;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        approved_at: true,
        access_revoked_at: true,
        updated_at: true,
      },
    });

    // Send email based on status change
    const username =
      user.username ||
      `${user.first_name} ${user.last_name}`.trim() ||
      user.email;

    switch (dto.status) {
      case UserStatus.ACTIVE:
        await this.mailService.sendAccountActivated({
          email: user.email,
          username: username,
          approvedBy: adminName,
          platformName,
          loginUrl: `${appConfig().app.client_app_url}/login`,
        });
        break;

      case UserStatus.DEACTIVATED:
        await this.mailService.sendAccountDeactivated({
          email: user.email,
          username: username,
          deactivatedBy: adminName,
          platformName,
        });
        break;

      case UserStatus.DELETED:
          await this.mailService.sendAccountDeleted({
          email: user.email,
          username: username,
          deletedBy: adminName,
          platformName,
        });
        break;
    }

    return {
      success: true,
      message: `User status changed to ${dto.status} successfully`,
      data: updated,
    };
  }

  async updateRole(id: string, dto: UpdateUserRoleDto, currentUser: any) {
    // Check if user exists
    const user = await this.prisma.user.findFirst({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Prevent admin from changing their own role (optional - security measure)
    if (id === currentUser.userId) {
      throw new BadRequestException('You cannot change your own role');
    }

    // Store old role for response
    const oldRole = user.role;

    // Update user role
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        role: dto.role,
      },
      select: {
        id: true,
        email: true,
        username: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        updated_at: true,
      },
    });

    return {
      success: true,
      message: `User role changed from ${oldRole} to ${dto.role} successfully. User needs to log out and log back in for changes to take effect.`,
      data: {
        ...updated,
        requires_logout: true,
        message: 'User must logout and login again for role changes to apply',
      },
    };
  }
}
