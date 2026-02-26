import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UserManagementService } from './user-management.service';
import { ChangeUserStatusDto } from './dto/change-user-status.dto';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';

@ApiTags('User Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('user-management')
export class UserManagementController {
  constructor(private readonly userManagementService: UserManagementService) {}

  @ApiOperation({
    summary: 'Get all users',
    description:
      'Admin only. Returns paginated list of all users with optional filters.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'role', required: false, enum: Role })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'DEACTIVATED', 'DELETED'],
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by name, email or username',
  })
  @Roles(Role.ADMIN)
  @Get()
  async findAll(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('role') role?: Role,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.userManagementService.findAll({
      page: Number(page),
      limit: Number(limit),
      role,
      status,
      search,
    });
  }

  @ApiOperation({
    summary: 'Get a single user by ID',
    description: 'Admin only. Returns full user profile by user ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID (cuid)',
    example: 'cmm02r3ri0000uku8do7v286a',
  })
  @Roles(Role.ADMIN)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.userManagementService.findOne(id);
  }

  @ApiOperation({
    summary: 'Change user status',
    description:
      'Admin only. Change a user status to ACTIVE, DEACTIVATED, or DELETED.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID (cuid)',
    example: 'cmm02r3ri0000uku8do7v286a',
  })
  @Roles(Role.ADMIN)
  @Patch(':id/status')
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeUserStatusDto,
    @Req() req: Request,
  ) {
    return this.userManagementService.changeStatus(id, dto, req.user);
  }
}
