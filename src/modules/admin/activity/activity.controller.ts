import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';
import { ActivityLogService } from './activity.service';
import { GetActivityLogsDto } from './dto/activity-dto';

@ApiTags('Activity Log')
@ApiBearerAuth(SWAGGER_AUTH.admin)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('activity-logs')
export class ActivityLogController {
  constructor(private readonly service: ActivityLogService) {}

  @Get()
  @ApiOperation({ summary: 'Get all activity logs (Admin only)' })
  findAll(@Query() query: GetActivityLogsDto) {
    return this.service.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 10,
      category: query.category,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      sortOrder: query.sortOrder ?? 'desc',
    });
  }
}
