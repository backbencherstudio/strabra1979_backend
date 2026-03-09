import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';
import { ActivityLogService } from './activity.service';
import { ActivityCategory } from 'prisma/generated/enums';

@ApiTags('Activity Log')
@ApiBearerAuth(SWAGGER_AUTH.admin)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('activity-logs')
export class ActivityLogController {
  constructor(private readonly service: ActivityLogService) {}

  @Get()
  @ApiOperation({ summary: 'Get all activity logs (Admin only)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ActivityCategory,
  })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2024-01-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2024-12-31' })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['asc', 'desc'],
    example: 'desc',
  })
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('category') category?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortOrder') sortOrder = 'desc',
  ) {
    return this.service.findAll({
      page: +page,
      limit: +limit,
      category,
      dateFrom,
      dateTo,
      sortOrder: sortOrder as 'asc' | 'desc',
    });
  }
}
