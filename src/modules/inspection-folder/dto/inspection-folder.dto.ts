import { IsString, IsArray, IsOptional, MinLength, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateFolderDto {
  @ApiProperty({ example: '2024 Inspection' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ example: ['inspectionId1', 'inspectionId2'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  inspectionIds?: string[];
}

export class UpdateFolderDto {
  @ApiPropertyOptional({ example: '2024 Annual Inspections' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}

export class AddInspectionsToFolderDto {
  @ApiProperty({ example: ['inspectionId1', 'inspectionId2'] })
  @IsArray()
  @IsString({ each: true })
  inspectionIds: string[];
}

export class RemoveInspectionFromFolderDto {
  @ApiProperty({ example: 'inspectionId1' })
  @IsString()
  inspectionId: string;
}

export class FindDashboardInspectionsDto {
  @ApiPropertyOptional({
    description:
      'Search by inspection title (matches headerData.inspectionTitle)',
    example: '2024 Annual Roof',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of results per page',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}