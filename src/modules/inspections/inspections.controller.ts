import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFiles,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SubmitInspectionDto } from './dto/inspection.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { Request } from 'express';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';
import { InspectionService } from './inspections.service';
import { InspectionStatus } from 'prisma/generated/enums';

@ApiTags('Inspections')
@ApiBearerAuth(SWAGGER_AUTH.admin)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inspections')
export class InspectionController {
  constructor(private readonly service: InspectionService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'List all inspections (Admin)',
    description:
      'Returns paginated inspections across all properties with filters.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: InspectionStatus,
    description: 'Filter by inspection status',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by property name, address, or inspector name',
  })
  @ApiOkResponse({
    description: 'Paginated inspection list.',
    schema: {
      example: {
        success: true,
        message: 'Inspections fetched successfully',
        data: [
          {
            id: 'clxyz003',
            status: 'SUBMITTED',
            createdAt: '2026-01-16T02:06:00.000Z',
            property: {
              name: 'Sunset Office Park',
              address: '123 Main St, Dallas, TX',
              propertyType: 'Commercial',
            },
          },
        ],
        meta: {
          total: 42,
          page: 1,
          limit: 10,
          total_pages: 5,
          has_next_page: true,
          has_prev_page: false,
        },
      },
    },
  })
  findAllInspections(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll({ page, limit, status, search });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — GET FORM
  // Operational team hits this first to build the form dynamically
  // Returns all criteria fields — nothing is hardcoded on the frontend
  // ─────────────────────────────────────────────────────────────────────────

  @Get('property/:dashboardId/form')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({
    summary: 'Get inspection form config',
    description:
      'Called when the operational team opens the inspection form. ' +
      'Returns the full form structure built from the linked InspectionCriteria: ' +
      'headerFields (text/dropdown inputs at the top), ' +
      'scoringCategories (scored checklist), ' +
      'mediaFields (upload slots — file/embed/document), ' +
      'repairPlanningConfig (status dropdown options), ' +
      'nteConfig (NTE input label+placeholder), ' +
      'additionalNotesConfig (notes textarea label+placeholder), ' +
      'healthThresholdConfig (score ranges for Good/Fair/Poor). ' +
      'Frontend renders the form entirely from this response.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiOkResponse({
    description: 'Form config returned. Frontend builds the form from this.',
    schema: {
      example: {
        success: true,
        data: {
          dashboardId: 'clxyz001',
          criteriaId: 'clxyz002',
          form: {
            headerFields: [
              {
                key: 'inspectionTitle',
                label: 'Inspection Title',
                type: 'text',
                required: true,
                order: 1,
                options: null,
              },
              {
                key: 'propertyType',
                label: 'Property Type',
                type: 'dropdown',
                required: false,
                order: 2,
                options: ['Commercial', 'Residential'],
              },
              {
                key: 'roofSystemType',
                label: 'Roof System Type',
                type: 'dropdown',
                required: false,
                order: 3,
                options: ['TPO', 'Metal', 'Shingle'],
              },
              {
                key: 'drainageType',
                label: 'Drainage Type',
                type: 'dropdown',
                required: false,
                order: 4,
                options: ['Internal', 'External'],
              },
            ],
            scoringCategories: [
              {
                key: 'surfaceCondition',
                label: 'Surface Condition',
                maxPoints: 25,
                order: 1,
              },
              {
                key: 'seamsFlashings',
                label: 'Seams & Flashings',
                maxPoints: 20,
                order: 2,
              },
              {
                key: 'drainagePonding',
                label: 'Drainage & Ponding',
                maxPoints: 15,
                order: 3,
              },
              {
                key: 'penetrations',
                label: 'Penetrations & Accessories',
                maxPoints: 10,
                order: 4,
              },
              {
                key: 'repairsHistory',
                label: 'Repairs & Patch History',
                maxPoints: 10,
                order: 5,
              },
              {
                key: 'ageExpectedLife',
                label: 'Age vs. Expected Life',
                maxPoints: 10,
                order: 6,
              },
            ],
            mediaFields: [
              {
                key: 'mediaFiles',
                label: 'Media Files',
                type: 'file',
                accept: ['image/*', 'video/*'],
                order: 1,
              },
              {
                key: 'aerialMap',
                label: 'Aerial Map',
                type: 'file',
                accept: ['image/*'],
                order: 2,
              },
              {
                key: 'tour3d',
                label: '3D Tours',
                type: 'embed',
                accept: null,
                order: 3,
              },
              {
                key: 'documents',
                label: 'Documents',
                type: 'document',
                accept: null,
                order: 4,
              },
            ],
            repairPlanningConfig: {
              statuses: ['Urgent', 'Maintenance', 'Replacement Planning'],
            },
            nteConfig: {
              label: 'NTE (Not-To-Exceed)',
              placeholder: 'Enter NTE',
            },
            additionalNotesConfig: {
              label: 'Additional Notes/Comments',
              placeholder: 'Type Any Additional Notes/Comments',
            },
            healthThresholdConfig: {
              good: {
                minScore: 70,
                maxScore: 100,
                remainingLifeMinYears: 5,
                remainingLifeMaxYears: 7,
              },
              fair: {
                minScore: 30,
                maxScore: 69,
                remainingLifeMinYears: 3,
                remainingLifeMaxYears: 5,
              },
              poor: {
                minScore: 0,
                maxScore: 29,
                remainingLifeMinYears: 0,
                remainingLifeMaxYears: 2,
              },
            },
          },
        },
      },
    },
  })
  getForm(@Param('dashboardId') dashboardId: string) {
    return this.service.getInspectionForm(dashboardId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — SUBMIT (single API call — all data + all files together)
  //
  // multipart/form-data layout:
  //   data           → JSON string of SubmitInspectionDto fields
  //   files          → one or more file fields (files[0], files[1], ...)
  //   mediaFieldKeys → parallel array — maps each file index to a criteria slot key
  //
  // Example curl:
  //   curl -X POST /inspections/property/clxyz001/submit \
  //     -F 'data={"headerData":{...},"scores":{...},"repairItems":[...],"nteValue":7500}' \
  //     -F 'files=@roof-photo.jpg' \
  //     -F 'files=@aerial.png' \
  //     -F 'mediaFieldKeys=mediaFiles' \
  //     -F 'mediaFieldKeys=aerialMap'
  // ─────────────────────────────────────────────────────────────────────────

  @Post('property/:dashboardId/submit')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @UseInterceptors(FilesInterceptor('files', 50)) // up to 50 files per submission
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Submit a completed inspection with all data and media files',
    description:
      'Single API call — sends everything at once as multipart/form-data. ' +
      '\n\n**Form fields:**\n' +
      '- `data` — JSON string containing headerData, scores, repairItems, nteValue, additionalComments, inspectedAt, mediaFieldKeys\n' +
      '- `files` — one or more binary file uploads (images, videos, PDFs)\n' +
      '- `mediaFieldKeys` — parallel string array mapping each file to its criteria slot key\n' +
      '\n\n**What happens on submit:**\n' +
      '1. Validates required headerFields are filled\n' +
      '2. Validates each score against its maxPoints\n' +
      '3. Validates each repairItem status against repairPlanningConfig.statuses\n' +
      '4. Validates each mediaFieldKey exists in criteria.mediaFields\n' +
      '5. Computes overallScore from all category scores\n' +
      '6. Derives healthLabel (Good/Fair/Poor) and remainingLife from healthThresholdConfig\n' +
      '7. Creates the Inspection row with status=SUBMITTED\n' +
      '8. Creates one MediaFile row per uploaded file with the correct mediaFieldKey',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'string',
          description: 'JSON string of the inspection payload',
          example: JSON.stringify({
            headerData: {
              inspectionTitle: '2024 Annual Roof Inspection',
              propertyType: 'Commercial',
              roofSystemType: 'TPO',
              drainageType: 'Internal',
            },
            scores: {
              surfaceCondition: { score: 22, notes: 'Minor cracks observed' },
              seamsFlashings: { score: 18, notes: 'Good overall' },
              drainagePonding: { score: 14, notes: '' },
              penetrations: { score: 9, notes: '' },
              repairsHistory: { score: 8, notes: 'One prior patch' },
              ageExpectedLife: { score: 7, notes: '12 years old' },
            },
            repairItems: [
              {
                title: 'Emergency Leak Repair',
                status: 'Urgent',
                description: 'Moisture stains on north parapet...',
              },
            ],
            nteValue: 7500,
            additionalComments: 'No active leaks at time of inspection.',
            inspectedAt: '2024-06-15T09:00:00.000Z',
            mediaFieldKeys: ['mediaFiles', 'aerialMap'],
          }),
        },
        files: {
          type: 'array',
          description:
            'Binary files — each index maps to the matching mediaFieldKeys entry',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Inspection submitted. overallScore, healthLabel, remainingLife computed and saved.',
    schema: {
      example: {
        success: true,
        message: 'Inspection submitted successfully',
        data: {
          id: 'clxyz003',
          dashboardId: 'clxyz001',
          status: 'SUBMITTED',
          overallScore: 78,
          healthLabel: 'Good',
          remainingLife: '5-7 Years',
          nteValue: 7500,
          additionalComments: 'No active leaks at time of inspection.',
          headerData: {
            inspectionTitle: '2024 Annual Roof Inspection',
            propertyType: 'Commercial',
          },
          scores: {
            surfaceCondition: { score: 22, notes: 'Minor cracks observed' },
          },
          repairItems: [
            {
              id: 'repair_1748291001_0',
              title: 'Emergency Leak Repair',
              status: 'Urgent',
              description: 'Moisture stains...',
            },
          ],
          mediaFiles: [
            {
              id: 'clxyz010',
              fileName: 'roof-north.jpg',
              fileType: 'PHOTO',
              url: 'https://...',
              mediaFieldKey: 'mediaFiles',
            },
            {
              id: 'clxyz011',
              fileName: 'aerial-view.png',
              fileType: 'PHOTO',
              url: 'https://...',
              mediaFieldKey: 'aerialMap',
            },
          ],
          summary: {
            overallScore: 78,
            healthLabel: 'Good',
            remainingLife: '5-7 Years',
          },
        },
      },
    },
  })
  submitInspection(
    @Param('dashboardId') dashboardId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('data') rawData: string,
    @Req() req: Request,
  ) {
    // Parse the JSON string sent in the "data" field
    let dto: SubmitInspectionDto;
    try {
      dto = JSON.parse(rawData);
    } catch {
      throw new Error('Invalid JSON in "data" field.');
    }

    return this.service.submitInspection(
      dashboardId,
      req.user.userId,
      dto,
      files ?? [],
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET SINGLE INSPECTION
  // ─────────────────────────────────────────────────────────────────────────

  @Get(':inspectionId')
  @Roles(Role.ADMIN, Role.OPERATIONAL, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'Get a single inspection with all data and media files',
    description:
      'Returns the full submitted inspection: headerData, scores, repairItems, ' +
      'nteValue, additionalComments, overallScore, healthLabel, remainingLife, ' +
      'inspector details, and all MediaFile rows. ' +
      'MediaFiles are grouped by mediaFieldKey so the UI knows which slot each file belongs to.',
  })
  @ApiParam({ name: 'inspectionId', description: 'CUID of the Inspection' })
  @ApiOkResponse({ description: 'Full inspection record returned.' })
  findOne(@Param('inspectionId') inspectionId: string) {
    return this.service.findOne(inspectionId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LIST ALL FOR A DASHBOARD
  // ─────────────────────────────────────────────────────────────────────────

  @Get('property/:dashboardId')
  @Roles(Role.ADMIN, Role.OPERATIONAL, Role.PROPERTY_MANAGER)
  @ApiOperation({
    summary: 'List all inspections for a property dashboard',
    description:
      'Returns all inspection records for a dashboard, newest first. ' +
      'Includes inspector name/avatar and a media file summary per inspection.',
  })
  @ApiParam({
    name: 'dashboardId',
    description: 'CUID of the PropertyDashboard',
  })
  @ApiOkResponse({ description: 'List of inspections.' })
  findAllForDashboard(@Param('dashboardId') dashboardId: string) {
    return this.service.findAllForDashboard(dashboardId);
  }
}
