import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';
import { Request } from 'express';
import { OverviewService } from './overview.service';
import { ScheduledInspectionStatus } from 'prisma/generated/enums';
import { ChartPeriod, OverviewQueryDto } from './overview.enum';

@ApiTags('Overview')
@ApiBearerAuth(SWAGGER_AUTH.operational)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('overview')
export class OverviewController {
  constructor(private readonly service: OverviewService) {}

  @Get('me')
  @Roles(
    Role.ADMIN,
    Role.PROPERTY_MANAGER,
    Role.AUTHORIZED_VIEWER,
    Role.OPERATIONAL,
  )
  @ApiOperation({
    summary: 'Get my dashboard overview',
    description:
      "Returns role-specific overview data based on the authenticated user's role.\n\n" +
      '**ADMIN** → total properties, total users, pending inspections, chart data, recent scheduled inspections, activity logs, latest properties.\n\n' +
      '**PROPERTY_MANAGER** → total managed properties, avg roof health, urgent repairs count, property cards, recent inspection reports.\n\n' +
      '**AUTHORIZED_VIEWER** → shared property dashboards with roof health and access expiration.\n\n' +
      "**OPERATIONAL** → today's inspection count, total assigned this month, completed this month, today's inspections list, recent inspections.\n\n" +
      '**Filters (ADMIN only):**\n' +
      '- `date` + `status` + `take` filter the Recent Scheduled Inspections list.\n' +
      '- `chartPeriod` (`yearly` | `monthly` | `daily`) controls chart granularity.',
  })
  @ApiOkResponse({
    description: 'Overview data returned based on authenticated user role.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description:
      'Filter scheduled inspections by date (ISO string, e.g. 2026-02-04)',
    example: '2026-02-04',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ScheduledInspectionStatus,
    description: 'Filter scheduled inspections by status',
  })
  @ApiQuery({
    name: 'take',
    required: false,
    description: 'Number of recent scheduled inspections to return (default 5)',
    example: 5,
  })
  @ApiQuery({
    name: 'chartPeriod',
    required: false,
    enum: ['yearly', 'monthly', 'daily'],
    description:
      'Chart granularity — yearly (monthly buckets for current year), monthly (daily buckets for current month), daily (hourly buckets for today). Defaults to yearly.',
    example: 'yearly',
  })
  getMyOverview(
    @Req() req: Request,
    @Query('date') date?: string,
    @Query('status') status?: ScheduledInspectionStatus,
    @Query('take') take?: string,
    @Query('chartPeriod') chartPeriod?: ChartPeriod,
  ) {
    const query: OverviewQueryDto = {
      date,
      status,
      take: take ? parseInt(take, 10) : undefined,
      chartPeriod,
    };

    return this.service.getOverview(
      req.user.userId,
      req.user.role as Role,
      query,
    );
  }
}
