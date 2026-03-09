import { IsString, IsArray, IsOptional, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
