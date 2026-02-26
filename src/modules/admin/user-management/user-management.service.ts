import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ChangeUserStatusDto } from './dto/change-user-status.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserStatus } from 'prisma/generated/enums';

@Injectable()
export class UserManagementService {
  constructor(private readonly prisma: PrismaService) {}

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
      isDeleted: false,
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
      where: { id, isDeleted: false },
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

  async changeStatus(id: string, dto: ChangeUserStatusDto, currentUser: any) {
    const user = await this.prisma.user.findFirst({
      where: { id, isDeleted: false },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Prevent admin from deactivating themselves
    if (id === currentUser.userId) {
      throw new BadRequestException('You cannot change your own status');
    }

    // Build update payload based on status
    const updateData: any = { status: dto.status };

    if (dto.status === UserStatus.ACTIVE) {
      updateData.approved_at = new Date();
      updateData.approved_by = currentUser.userId;
      updateData.access_revoked_at = null;
      updateData.access_revoked_by = null;
    }

    if (dto.status === UserStatus.DEACTIVATED) {
      updateData.access_revoked_at = new Date();
      updateData.access_revoked_by = currentUser.userId;
    }

    if (dto.status === UserStatus.DELETED) {
      updateData.isDeleted = true;
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
        role: true,
        status: true,
        approved_at: true,
        access_revoked_at: true,
        updated_at: true,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        user_id: currentUser.userId,
        entity_type: 'user',
        entity_id: id,
        action: `status_changed_to_${dto.status.toLowerCase()}`,
        metadata: {
          previous_status: user.status,
          new_status: dto.status,
        },
      },
    });

    return {
      success: true,
      message: `User status changed to ${dto.status} successfully`,
      data: updated,
    };
  }
}
