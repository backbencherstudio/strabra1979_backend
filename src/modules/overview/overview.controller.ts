import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';
import { Request } from 'express';
import { OverviewService } from './overview.service';

@ApiTags('Overview')
@ApiBearerAuth(SWAGGER_AUTH.property_manager)
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
      "**OPERATIONAL** → today's inspection count, total assigned this month, completed this month, today's inspections list, recent inspections.",
  })
  @ApiOkResponse({
    description: 'Overview data returned based on authenticated user role.',
  })
  getMyOverview(@Req() req: Request) {
    return this.service.getOverview(
      req.user.userId,
      req.user.role as Role,
    );
  }
}
