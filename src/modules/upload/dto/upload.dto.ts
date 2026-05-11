import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Max,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InitiateUploadDto {
  @ApiProperty({ description: 'Original file name', example: 'video.mp4' })
  @IsString()
  fileName: string;

  @ApiProperty({ description: 'MIME type of file', example: 'video/mp4' })
  @IsString()
  mimeType: string;

  @ApiProperty({ description: 'File size in bytes', example: 104857600 })
  @IsInt()
  @Min(1)
  fileSize: number;
}

export class PartETagDto {
  @ApiProperty({ description: 'Part number', example: 1 })
  @IsInt()
  @Min(1)
  partNumber: number;

  @ApiProperty({
    description: 'ETag from MinIO upload response',
    example: '"abc123..."',
  })
  @IsString()
  eTag: string;
}

export class MultiplePresignedUrlsDto {
  @ApiProperty({
    description: 'Array of part numbers',
    example: [1, 2, 3, 4, 5],
  })
  @IsArray()
  @IsInt({ each: true })
  partNumbers: number[];
}

export class UploadPartDto {
  @ApiProperty({ description: 'Part number', example: 1 })
  @IsInt()
  @Min(1)
  partNumber: number;
}

export class CompleteUploadResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '/public/storage/inspections/1634567890_video.mp4' })
  location: string;

  @ApiProperty({ example: 'inspections/user123/1634567890_video.mp4' })
  key: string;

  @ApiProperty({
    example:
      'http://localhost:9005/bucket/inspections/user123/1634567890_video.mp4',
  })
  url: string;

  @ApiProperty({ example: 'video.mp4' })
  fileName: string;

  @ApiProperty({ example: 104857600 })
  fileSize: number;
}

export class UploadStatusResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'ABORTED', 'FAILED'] })
  status: string;

  @ApiProperty({ example: 5 })
  uploadedParts: number;

  @ApiProperty({ example: 10 })
  totalParts: number;

  @ApiProperty({ example: 50 })
  progress: number;

  @ApiProperty({ example: 'video.mp4' })
  fileName: string;

  @ApiProperty({ example: 104857600 })
  fileSize: number;
}
