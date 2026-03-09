import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: {
    page: number;
    limit: number;
    category?: string;
    dateFrom?: string;
    dateTo?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const {
      page = 1,
      limit = 10,
      category,
      dateFrom,
      dateTo,
      sortOrder = 'desc',
    } = filters;

    const skip = (page - 1) * limit;

    const where: any = {
      ...(category && { category }),
      ...((dateFrom || dateTo) && {
        created_at: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
    };

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: sortOrder },
        select: {
          id: true,
          created_at: true,
          category: true,
          message: true,
          actor_role: true,
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    const total_pages = Math.ceil(total / limit);

    return {
      success: true,
      message: 'Activity logs fetched successfully',
      data: logs,
      meta: {
        total,
        page,
        limit,
        total_pages,
        has_next_page: page < total_pages,
        has_prev_page: page > 1,
      },
    };
  }
}
