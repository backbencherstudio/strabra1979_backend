import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Role, ScheduledInspectionStatus } from 'prisma/generated/enums';
import { ChartPeriod, OverviewQueryDto } from './overview.enum';

@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  // ═════════════════════════════════════════════════════════════════════════
  // ROUTER
  // ═════════════════════════════════════════════════════════════════════════

  async getOverview(userId: string, role: Role, query: OverviewQueryDto = {}) {
    switch (role) {
      case Role.ADMIN:
        return this._getAdminOverview(query);
      case Role.PROPERTY_MANAGER:
        return this._getPropertyManagerOverview(userId);
      case Role.AUTHORIZED_VIEWER:
        return this._getAuthorizedViewerOverview(userId);
      case Role.OPERATIONAL:
        return this._getOperationalOverview(userId);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ADMIN
  // ═════════════════════════════════════════════════════════════════════════

  private async _getAdminOverview(query: OverviewQueryDto) {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // ── Resolve date-range filter for scheduled inspections ────────────────
    let dateFilter: { gte?: Date; lte?: Date } | undefined;
    if (query.date) {
      const d = new Date(query.date);
      if (!isNaN(d.getTime())) {
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const dayEnd = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
          23,
          59,
          59,
          999,
        );
        dateFilter = { gte: dayStart, lte: dayEnd };
      }
    }

    // ── Stats ──────────────────────────────────────────────────────────────
    const [
      totalProperties,
      propertiesLastMonth,
      propertiesThisMonth,
      totalUsers,
      usersLastMonth,
      usersThisMonth,
      pendingInspections,
    ] = await this.prisma.$transaction([
      this.prisma.property.count({ where: { status: 'ACTIVE' } }),
      this.prisma.property.count({
        where: { createdAt: { gte: lastMonth, lte: lastMonthEnd } },
      }),
      this.prisma.property.count({
        where: { createdAt: { gte: thisMonth } },
      }),
      this.prisma.user.count({
        where: { isDeleted: false, status: 'ACTIVE' },
      }),
      this.prisma.user.count({
        where: {
          isDeleted: false,
          created_at: { gte: lastMonth, lte: lastMonthEnd },
        },
      }),
      this.prisma.user.count({
        where: { isDeleted: false, created_at: { gte: thisMonth } },
      }),
      this.prisma.scheduledInspection.count({
        where: {
          scheduledAt: { gte: thisMonth },
          status: {
            in: [
              ScheduledInspectionStatus.ASSIGNED,
              ScheduledInspectionStatus.DUE,
              ScheduledInspectionStatus.IN_PROGRESS,
            ],
          },
        },
      }),
    ]);

    const propertiesChangePercent =
      propertiesLastMonth > 0
        ? +(
            ((propertiesThisMonth - propertiesLastMonth) /
              propertiesLastMonth) *
            100
          ).toFixed(1)
        : null;

    const usersChangePercent =
      usersLastMonth > 0
        ? +(((usersThisMonth - usersLastMonth) / usersLastMonth) * 100).toFixed(
            1,
          )
        : null;

    // ── Chart ──────────────────────────────────────────────────────────────
    const chartData = await this._buildChartData(
      now,
      query.chartPeriod ?? 'yearly',
    );

    // ── Scheduled inspection tab counts ────────────────────────────────────
    const [dueCount, inProgressCount, completeCount, assignedCount] =
      await this.prisma.$transaction([
        this.prisma.scheduledInspection.count({
          where: { status: ScheduledInspectionStatus.DUE },
        }),
        this.prisma.scheduledInspection.count({
          where: { status: ScheduledInspectionStatus.IN_PROGRESS },
        }),
        this.prisma.scheduledInspection.count({
          where: { status: ScheduledInspectionStatus.COMPLETE },
        }),
        this.prisma.scheduledInspection.count({
          where: { status: ScheduledInspectionStatus.ASSIGNED },
        }),
      ]);

    // ── Recent scheduled inspections ───────────────────────────────────────
    const takeCount = query.take && query.take > 0 ? query.take : 5;

    const recentScheduled = await this.prisma.scheduledInspection.findMany({
      take: takeCount,
      orderBy: { scheduledAt: 'desc' },
      where: {
        ...(dateFilter ? { scheduledAt: dateFilter } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: {
        dashboard: {
          include: {
            property: { select: { name: true, address: true } },
          },
        },
        assignee: { select: { id: true, username: true, avatar: true } },
      },
    });

    // ── Activity logs ──────────────────────────────────────────────────────
    const activityLogs = await this.prisma.activityLog.findMany({
      take: 5,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        message: true,
        category: true,
        actor_role: true,
        created_at: true,
      },
    });

    // ── Latest 3 properties ────────────────────────────────────────────────
    const latestProperties = await this.prisma.property.findMany({
      take: 3,
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: {
        dashboard: {
          include: {
            inspections: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                overallScore: true,
                healthLabel: true,
                remainingLife: true,
              },
            },
          },
        },
        propertyManager: {
          select: { id: true, username: true, avatar: true },
        },
      },
    });

    return {
      success: true,
      message: 'Admin overview retrieved',
      data: {
        role: Role.ADMIN,
        stats: {
          totalProperties,
          propertiesChangePercent,
          totalUsers,
          usersChangePercent,
          pendingInspectionsThisMonth: pendingInspections,
        },
        chart: chartData,
        scheduledInspections: {
          tabs: {
            all: dueCount + inProgressCount + completeCount + assignedCount,
            due: dueCount,
            inProgress: inProgressCount,
            complete: completeCount,
            assigned: assignedCount,
          },
          appliedFilters: {
            date: query.date ?? null,
            status: query.status ?? null,
            take: takeCount,
          },
          recent: recentScheduled.map((s) => ({
            id: s.id,
            status: s.status,
            scheduledAt: s.scheduledAt,
            time: s.scheduledAt.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            property: s.dashboard.property.name,
            address: s.dashboard.property.address,
            dashboardId: s.dashboardId,
            assignee: s.assignee,
          })),
        },
        activityLogs,
        latestProperties: latestProperties.map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          propertyType: p.propertyType,
          nextInspectionDate: p.nextInspectionDate,
          dashboardId: p.dashboard?.id ?? null,
          propertyManager: p.propertyManager,
          roofHealth: p.dashboard?.inspections?.[0]
            ? {
                overallScore: p.dashboard.inspections[0].overallScore,
                healthLabel: p.dashboard.inspections[0].healthLabel,
                remainingLife: p.dashboard.inspections[0].remainingLife,
              }
            : null,
        })),
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CHART BUILDER
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Builds property count chart data at three granularities:
   *
   *  yearly  — one bucket per month of the current year  (Jan … Dec)
   *  monthly — one bucket per day of the current month   (1 … 28/30/31)
   *  daily   — one bucket per hour of today              (12 AM … 11 PM)
   *
   * Each bucket counts properties whose `createdAt` falls within that window.
   * The label field drives the x-axis on the frontend.
   */
  private async _buildChartData(now: Date, period: ChartPeriod) {
    switch (period) {
      // ── Yearly: 12 monthly buckets ───────────────────────────────────────
      case 'yearly': {
        const buckets = await Promise.all(
          Array.from({ length: 12 }, async (_, i) => {
            const start = new Date(now.getFullYear(), i, 1);
            const end = new Date(now.getFullYear(), i + 1, 0, 23, 59, 59, 999);
            const count = await this.prisma.property.count({
              where: { createdAt: { gte: start, lte: end } },
            });
            return {
              label: start.toLocaleString('en-US', { month: 'short' }), // Jan … Dec
              count,
            };
          }),
        );
        return { period: 'yearly', year: now.getFullYear(), data: buckets };
      }

      // ── Monthly: one bucket per day of the current month ────────────────
      case 'monthly': {
        const daysInMonth = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0,
        ).getDate();

        const buckets = await Promise.all(
          Array.from({ length: daysInMonth }, async (_, i) => {
            const day = i + 1;
            const start = new Date(now.getFullYear(), now.getMonth(), day);
            const end = new Date(
              now.getFullYear(),
              now.getMonth(),
              day,
              23,
              59,
              59,
              999,
            );
            const count = await this.prisma.property.count({
              where: { createdAt: { gte: start, lte: end } },
            });
            return {
              label: String(day), // "1" … "31"
              count,
            };
          }),
        );
        return {
          period: 'monthly',
          year: now.getFullYear(),
          month: now.toLocaleString('en-US', { month: 'long' }),
          data: buckets,
        };
      }

      // ── Daily: one bucket per hour of today ──────────────────────────────
      case 'daily': {
        const buckets = await Promise.all(
          Array.from({ length: 24 }, async (_, hour) => {
            const start = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
              hour,
              0,
              0,
              0,
            );
            const end = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
              hour,
              59,
              59,
              999,
            );
            const count = await this.prisma.property.count({
              where: { createdAt: { gte: start, lte: end } },
            });
            // Format as "12 AM", "1 AM" … "11 PM"
            const label = start.toLocaleString('en-US', {
              hour: 'numeric',
              hour12: true,
            });
            return { label, count };
          }),
        );
        return {
          period: 'daily',
          date: now.toISOString().split('T')[0],
          data: buckets,
        };
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PROPERTY MANAGER
  // ═════════════════════════════════════════════════════════════════════════

  private async _getPropertyManagerOverview(userId: string) {
    const properties = await this.prisma.property.findMany({
      where: { propertyManagerId: userId, status: 'ACTIVE' },
      include: {
        dashboard: {
          include: {
            inspections: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                overallScore: true,
                healthLabel: true,
                remainingLife: true,
                repairItems: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const scores = properties
      .map((p) => p.dashboard?.inspections?.[0]?.overallScore)
      .filter((s): s is number => s !== null && s !== undefined);

    const avgRoofHealth =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;

    let urgentRepairs = 0;
    for (const p of properties) {
      const items = (p.dashboard?.inspections?.[0]?.repairItems ?? []) as any[];
      urgentRepairs += items.filter((r) => r.status === 'Urgent').length;
    }

    const dashboardIds = properties
      .map((p) => p.dashboard?.id)
      .filter(Boolean) as string[];

    const recentInspections = await this.prisma.inspection.findMany({
      where: { dashboardId: { in: dashboardIds } },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        dashboard: {
          include: {
            property: { select: { name: true, address: true } },
          },
        },
        inspector: { select: { id: true, username: true, avatar: true } },
      },
    });

    return {
      success: true,
      message: 'Property Manager overview retrieved',
      data: {
        role: Role.PROPERTY_MANAGER,
        stats: {
          totalProperties: properties.length,
          avgRoofHealthPercent: avgRoofHealth,
          urgentRepairs,
        },
        properties: properties.map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          propertyType: p.propertyType,
          nextInspectionDate: p.nextInspectionDate,
          dashboardId: p.dashboard?.id ?? null,
          roofHealth: p.dashboard?.inspections?.[0]
            ? {
                overallScore: p.dashboard.inspections[0].overallScore,
                healthLabel: p.dashboard.inspections[0].healthLabel,
                remainingLife: p.dashboard.inspections[0].remainingLife,
              }
            : null,
        })),
        recentReports: recentInspections.map((i) => ({
          id: i.id,
          propertyName: i.dashboard.property.name,
          address: i.dashboard.property.address,
          inspectedAt: i.inspectedAt,
          healthLabel: i.healthLabel,
          overallScore: i.overallScore,
          inspector: i.inspector,
        })),
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // AUTHORIZED VIEWER
  // ═════════════════════════════════════════════════════════════════════════

  private async _getAuthorizedViewerOverview(userId: string) {
    const now = new Date();

    const accesses = await this.prisma.propertyAccess.findMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { grantedAt: 'desc' },
      include: {
        property: {
          include: {
            dashboard: {
              include: {
                inspections: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: {
                    overallScore: true,
                    healthLabel: true,
                    remainingLife: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      success: true,
      message: 'Authorized Viewer overview retrieved',
      data: {
        role: Role.AUTHORIZED_VIEWER,
        totalSharedDashboards: accesses.length,
        sharedDashboards: accesses.map((a) => ({
          propertyId: a.propertyId,
          dashboardId: a.property.dashboard?.id ?? null,
          name: a.property.name,
          address: a.property.address,
          propertyType: a.property.propertyType,
          accessExpiresAt: a.expiresAt,
          grantedAt: a.grantedAt,
          roofHealth: a.property.dashboard?.inspections?.[0]
            ? {
                overallScore: a.property.dashboard.inspections[0].overallScore,
                healthLabel: a.property.dashboard.inspections[0].healthLabel,
                remainingLife:
                  a.property.dashboard.inspections[0].remainingLife,
              }
            : null,
        })),
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // OPERATIONAL
  // ═════════════════════════════════════════════════════════════════════════

  private async _getOperationalOverview(userId: string) {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
    );
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    await this.prisma.scheduledInspection.updateMany({
      where: {
        assignedTo: userId,
        status: ScheduledInspectionStatus.ASSIGNED,
        scheduledAt: { lt: now },
      },
      data: { status: ScheduledInspectionStatus.DUE },
    });

    const [todayCount, totalAssignedThisMonth, completedThisMonth] =
      await this.prisma.$transaction([
        this.prisma.scheduledInspection.count({
          where: {
            assignedTo: userId,
            scheduledAt: { gte: todayStart, lte: todayEnd },
          },
        }),
        this.prisma.scheduledInspection.count({
          where: { assignedTo: userId, scheduledAt: { gte: thisMonth } },
        }),
        this.prisma.scheduledInspection.count({
          where: {
            assignedTo: userId,
            status: ScheduledInspectionStatus.COMPLETE,
            scheduledAt: { gte: thisMonth },
          },
        }),
      ]);

    const todaysInspections = await this.prisma.scheduledInspection.findMany({
      where: {
        assignedTo: userId,
        scheduledAt: { gte: todayStart, lte: todayEnd },
      },
      orderBy: { scheduledAt: 'asc' },
      include: {
        dashboard: {
          include: {
            property: { select: { name: true, address: true } },
          },
        },
      },
    });

    const recentInspections = await this.prisma.scheduledInspection.findMany({
      where: { assignedTo: userId },
      take: 5,
      orderBy: { scheduledAt: 'desc' },
      include: {
        dashboard: {
          include: {
            property: { select: { name: true, address: true } },
          },
        },
      },
    });

    const _formatScheduled = (s: any) => ({
      id: s.id,
      status: s.status,
      scheduledAt: s.scheduledAt,
      time: s.scheduledAt.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      property: s.dashboard.property.name,
      address: s.dashboard.property.address,
      dashboardId: s.dashboardId,
    });

    return {
      success: true,
      message: 'Operational overview retrieved',
      data: {
        role: Role.OPERATIONAL,
        stats: { todayCount, totalAssignedThisMonth, completedThisMonth },
        todaysInspections: todaysInspections.map(_formatScheduled),
        recentInspections: recentInspections.map(_formatScheduled),
      },
    };
  }
}
