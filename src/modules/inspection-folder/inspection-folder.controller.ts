import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { InspectionFolderService } from './inspection-folder.service';
import {
  CreateFolderDto,
  UpdateFolderDto,
  AddInspectionsToFolderDto,
  FindDashboardInspectionsDto,
} from './dto/inspection-folder.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { Request } from 'express';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';

@ApiTags('Inspection Folders')
@ApiBearerAuth(SWAGGER_AUTH.admin)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dashboards/:dashboardId')
export class InspectionFolderController {
  constructor(private readonly service: InspectionFolderService) {}

  // GET /dashboards/:dashboardId/folders
  @Get('folders')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER, Role.AUTHORIZED_VIEWER)
  @ApiOperation({
    summary: 'Get all folders for a dashboard',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  getFolders(@Param('dashboardId') dashboardId: string) {
    return this.service.getFolders(dashboardId);
  }

  // GET /dashboards/:dashboardId/folders/:folderId
  @Get('folders/:folderId')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER)
  @ApiOperation({ summary: 'Get a single folder with its inspection reports' })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiParam({ name: 'folderId', description: 'CUID of the folder' })
  getFolder(@Param('folderId') folderId: string) {
    return this.service.getFolder(folderId);
  }

  // GET /dashboards/:dashboardId/inspections
  @Get('inspections')
  @Roles(Role.ADMIN, Role.PROPERTY_MANAGER, Role.AUTHORIZED_VIEWER)
  @ApiOperation({
    summary: 'Get all inspection reports for a property dashboard',
    description:
      'Returns paginated inspections for a dashboard. Optionally filter by inspection title stored inside the `headerData` JSON field.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
    example: 'clx1234abcd5678efgh',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description:
      'Search term matched against headerData.inspectionTitle (case-insensitive)',
    example: '2024 Annual Roof',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (1-based)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Results per page',
    example: 10,
  })
  getDashboardInspections(
    @Param('dashboardId') dashboardId: string,
    @Query() filters: FindDashboardInspectionsDto,
  ) {
    return this.service.findAllForDashboard(dashboardId, filters);
  }

  // POST /dashboards/:dashboardId/folders
  @Post('folders')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create a new folder',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiResponse({ status: 201, description: 'Folder created.' })
  createFolder(
    @Param('dashboardId') dashboardId: string,
    @Body() dto: CreateFolderDto,
    @Req() req: Request,
  ) {
    return this.service.createFolder(dashboardId, dto, req.user?.userId);
  }

  // PATCH /dashboards/:dashboardId/folders/:folderId
  @Patch('folders/:folderId')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Rename a folder',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiParam({ name: 'folderId', description: 'CUID of the folder' })
  updateFolder(
    @Param('folderId') folderId: string,
    @Body() dto: UpdateFolderDto,
    @Req() req: Request,
  ) {
    return this.service.updateFolder(folderId, dto, req.user?.userId);
  }

  // DELETE /dashboards/:dashboardId/folders/:folderId
  @Delete('folders/:folderId')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a folder only — inspection reports are preserved',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiParam({ name: 'folderId', description: 'CUID of the folder' })
  deleteFolder(@Param('folderId') folderId: string, @Req() req: Request) {
    return this.service.deleteFolder(folderId, req.user?.userId);
  }

  // POST /dashboards/:dashboardId/folders/:folderId/inspections
  @Post('folders/:folderId/inspections')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Add inspections to a folder',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiParam({ name: 'folderId', description: 'CUID of the folder' })
  addInspections(
    @Param('folderId') folderId: string,
    @Body() dto: AddInspectionsToFolderDto,
    @Req() req: Request,
  ) {
    return this.service.addInspections(folderId, dto, req.user?.userId);
  }

  // DELETE /dashboards/:dashboardId/folders/:folderId/inspections/:inspectionId
  @Delete('folders/:folderId/inspections/:inspectionId')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove an inspection from a folder',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiParam({ name: 'folderId', description: 'CUID of the folder' })
  @ApiParam({ name: 'inspectionId', description: 'CUID of the inspection' })
  removeInspection(
    @Param('folderId') folderId: string,
    @Param('inspectionId') inspectionId: string,
    @Req() req: Request,
  ) {
    return this.service.removeInspection(
      folderId,
      inspectionId,
      req.user?.userId,
    );
  }
}
