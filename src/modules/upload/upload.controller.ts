import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
  Delete,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { Request } from 'express';
import { LocalChunkUploadService } from './local-chunk-upload.service';
import { MinioMultipartService } from './minio-multipart.service';
import {
  InitiateUploadDto,
  PartETagDto,
  MultiplePresignedUrlsDto,
  CompleteUploadResponseDto,
  UploadStatusResponseDto,
} from './dto/upload.dto';
import { SWAGGER_AUTH } from 'src/common/swagger/swagger-auth';

@ApiTags('Uploads')
@ApiBearerAuth(SWAGGER_AUTH.admin)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('uploads')
export class UploadController {
  constructor(
    private localUploadService: LocalChunkUploadService,
    private minioUploadService: MinioMultipartService,
  ) {}

  // ==================== LOCAL STORAGE ENDPOINTS ====================

  @Post('local/initiate')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[Local] Start a multipart upload session' })
  @ApiResponse({ status: 201, description: 'Upload session created' })
  async initiateLocalUpload(
    @Body() dto: InitiateUploadDto,
    @Req() req: Request,
  ) {
    const session = await this.localUploadService.initiateUpload(
      req.user.userId,
      dto.fileName,
      dto.mimeType,
      dto.fileSize,
    );
    return { success: true, sessionId: session.id };
  }

  @Post('local/:sessionId/part/:partNumber')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @UseInterceptors(FileInterceptor('chunk'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '[Local] Upload a single part' })
  @ApiParam({ name: 'sessionId', type: String })
  @ApiParam({ name: 'partNumber', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        chunk: { type: 'string', format: 'binary' },
      },
    },
  })
  async uploadLocalPart(
    @Param('sessionId') sessionId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
    @UploadedFile() chunk: Express.Multer.File,
  ) {
    if (!chunk) throw new BadRequestException('No chunk file provided');
    await this.localUploadService.uploadPart(
      sessionId,
      partNumber,
      chunk.buffer,
    );
    return { success: true, partNumber };
  }

  @Post('local/:sessionId/complete')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[Local] Complete upload and merge parts' })
  @ApiParam({ name: 'sessionId', type: String })
  async completeLocalUpload(@Param('sessionId') sessionId: string) {
    const result = await this.localUploadService.completeUpload(sessionId);
    return { success: true, fileUrl: result.url };
  }

  @Delete('local/:sessionId')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[Local] Abort upload session' })
  async abortLocalUpload(@Param('sessionId') sessionId: string) {
    await this.localUploadService.abortUpload(sessionId);
    return { success: true };
  }

  // ==================== MINIO MULTIPART ENDPOINTS ====================

  @Post('minio/initiate')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[MinIO] Start multipart upload' })
  async initiateMinioUpload(
    @Body() dto: InitiateUploadDto,
    @Req() req: Request,
  ) {
    const result = await this.minioUploadService.initiateUpload(
      req.user.userId,
      dto.fileName,
      dto.mimeType,
      dto.fileSize,
    );
    return { success: true, ...result };
  }

  @Get('minio/:sessionId/presigned-url/:partNumber')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[MinIO] Get presigned URL for a part' })
  async getPresignedUrl(
    @Param('sessionId') sessionId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
  ) {
    const url = await this.minioUploadService.getPresignedUrl(
      sessionId,
      partNumber,
    );
    return { success: true, partNumber, url, expiresIn: 3600 };
  }

  @Post('minio/:sessionId/presigned-urls')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[MinIO] Get multiple presigned URLs' })
  async getMultiplePresignedUrls(
    @Param('sessionId') sessionId: string,
    @Body() body: MultiplePresignedUrlsDto,
  ) {
    const urls = await this.minioUploadService.getMultiplePresignedUrls(
      sessionId,
      body.partNumbers,
    );
    return { success: true, urls };
  }

  @Post('minio/:sessionId/part/complete')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[MinIO] Save part ETag' })
  async savePartETag(
    @Param('sessionId') sessionId: string,
    @Body() body: PartETagDto,
  ) {
    await this.minioUploadService.savePartETag(
      sessionId,
      body.partNumber,
      body.eTag,
    );
    return { success: true };
  }

  @Post('minio/:sessionId/complete')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[MinIO] Complete multipart upload' })
  async completeMinioUpload(@Param('sessionId') sessionId: string) {
    const result = await this.minioUploadService.completeUpload(sessionId);
    return { success: true, ...result };
  }

  @Delete('minio/:sessionId')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[MinIO] Abort upload' })
  async abortMinioUpload(@Param('sessionId') sessionId: string) {
    const result = await this.minioUploadService.abortUpload(sessionId);
    return { success: true, ...result };
  }

  // ==================== GENERAL ENDPOINTS ====================

  @Get(':sessionId/status')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: 'Get upload status' })
  async getUploadStatus(@Param('sessionId') sessionId: string) {
    const status = await this.minioUploadService.getUploadStatus(sessionId);
    return { success: true, ...status };
  }

  @Get('minio/:sessionId/parts')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({ summary: '[MinIO] List uploaded parts' })
  async listParts(@Param('sessionId') sessionId: string) {
    const parts = await this.minioUploadService.listUploadedParts(sessionId);
    return { success: true, parts };
  }

  @Post('smart/initiate')
  @Roles(Role.ADMIN, Role.OPERATIONAL)
  @ApiOperation({
    summary: '[Smart] Auto-detect best upload method based on file size',
  })
  async smartInitiate(@Body() dto: InitiateUploadDto, @Req() req: Request) {
    const USE_MINIO_THRESHOLD = 50 * 1024 * 1024; // 50MB

    if (dto.fileSize > USE_MINIO_THRESHOLD) {
      const result = await this.minioUploadService.initiateUpload(
        req.user.userId,
        dto.fileName,
        dto.mimeType,
        dto.fileSize,
      );
      return { success: true, method: 'minio', ...result };
    } else {
      const session = await this.localUploadService.initiateUpload(
        req.user.userId,
        dto.fileName,
        dto.mimeType,
        dto.fileSize,
      );
      return { success: true, method: 'local', sessionId: session.id };
    }
  }
}
