import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsObject,
  IsPositive,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RepairItemDto {
  @ApiProperty({ example: 'Emergency Leak Repair' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example: 'Urgent',
    description: 'Must match criteria.repairPlanningConfig.statuses',
  })
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiPropertyOptional({ example: 'Moisture stains on north parapet wall...' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class SubmitInspectionDto {
  @ApiProperty({
    description:
      'Key-value answers for criteria.headerFields. Keys must match criteria.headerFields[].key. Required fields must be present.',
    example: {
      inspectionTitle: '2024 Annual Roof',
      propertyType: 'Commercial',
      roofSystemType: 'TPO',
      drainageType: 'Internal',
    },
  })
  @IsObject()
  headerData: Record<string, string>;

  @ApiProperty({
    description:
      'Scores keyed by criteria.scoringCategories[].key. score must be 0..maxPoints.',
    example: {
      surfaceCondition: { score: 22, notes: 'Minor cracks' },
      seamsFlashings: { score: 18, notes: '' },
    },
  })
  @IsObject()
  scores: Record<string, { score: number; notes?: string }>;

  @ApiPropertyOptional({
    description:
      'Repair items. Each status must match criteria.repairPlanningConfig.statuses.',
    type: [RepairItemDto],
    example: [
      {
        title: 'Emergency Leak Repair',
        status: 'Urgent',
        description: 'Moisture stains...',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepairItemDto)
  repairItems?: RepairItemDto[];

  @ApiPropertyOptional({
    example: 7500,
    description: 'NTE value. Label from criteria.nteConfig.label.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  nteValue?: number;

  @ApiPropertyOptional({ example: 'No active leaks at time of inspection.' })
  @IsOptional()
  @IsString()
  additionalComments?: string;

  @ApiPropertyOptional({
    example: '2024-06-15T09:00:00.000Z',
    description: 'Defaults to now.',
  })
  @IsOptional()
  @IsString()
  inspectedAt?: string;

  @ApiPropertyOptional({
    description:
      'Maps each uploaded file to its criteria slot. Index matches files[] array. Keys must match criteria.mediaFields[].key.',
    example: ['mediaFiles', 'mediaFiles', 'aerialMap', 'tour3d'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaFieldKeys?: string[];

  @ApiPropertyOptional({
    description:
      'Embed URL fields keyed by mediaFieldKey (e.g. tour3d, virtualWalkthrough)',
    example: { tour3d: 'https://my3dtour.com/abc123' },
  })
  @IsOptional()
  @IsObject()
  embedFields?: Record<string, string>;
}

export class UpdateInspectionDto {
  @ApiPropertyOptional({
    description:
      'Partial or full update of header field values. Keys must match criteria.headerFields[].key.',
    example: {
      inspectionTitle: 'Updated 2024 Annual Roof Inspection',
      propertyType: 'Commercial',
    },
  })
  @IsOptional()
  @IsObject()
  headerData?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Scores keyed by criteria.scoringCategories[].key. score must be 0..maxPoints. Replaces entire scores object if provided.',
    example: {
      surfaceCondition: { score: 24, notes: 'Updated — cracks repaired' },
      seamsFlashings: { score: 19, notes: 'Good overall' },
    },
  })
  @IsOptional()
  @IsObject()
  scores?: Record<string, { score: number; notes?: string }>;

  @ApiPropertyOptional({
    description:
      'Fully replaces repair items array if provided. Each status must match criteria.repairPlanningConfig.statuses.',
    type: [RepairItemDto],
    example: [
      {
        title: 'Emergency Leak Repair',
        status: 'Urgent',
        description: 'Updated — moisture stains on north parapet wall.',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepairItemDto)
  repairItems?: RepairItemDto[];

  @ApiPropertyOptional({
    example: 8000,
    description: 'Updated NTE value.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  nteValue?: number;

  @ApiPropertyOptional({
    example: 'Updated — no active leaks confirmed after re-inspection.',
    description: 'Updated additional notes.',
  })
  @IsOptional()
  @IsString()
  additionalComments?: string;

  @ApiPropertyOptional({
    description:
      'Maps each newly uploaded file to its criteria slot. Index must match files[] array. Keys must match criteria.mediaFields[].key.',
    example: ['mediaFiles', 'aerialMap'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaFieldKeys?: string[];

  @ApiPropertyOptional({
    description: 'Updated embed URL fields keyed by mediaFieldKey.',
    example: { tour3d: 'https://my3dtour.com/updated123' },
  })
  @IsOptional()
  @IsObject()
  embedFields?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'IDs of existing MediaFile records to delete before adding new ones.',
    example: ['cmmn96p1s0003fql0sz0t3940', 'cmmn96p1s0004fql0sz0t3941'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removeMediaFileIds?: string[];
}