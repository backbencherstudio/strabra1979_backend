import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PropertyType {
  COMMERCIAL = 'Commercial',
  RESIDENTIAL = 'Residential',
  INDUSTRIAL = 'Industrial',
  MIXED_USE = 'Mixed Use',
}

// ─── Step 1: Create Property

export class CreatePropertyDto {
  @ApiProperty({
    description: 'Full name of the property',
    example: 'Sunset Office Complex',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Full street address of the property',
    example: '1234 Sunset Blvd, Los Angeles, CA 90028',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiPropertyOptional({
    description: 'Type/category of the property',
    enum: PropertyType,
    example: PropertyType.COMMERCIAL,
  })
  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @ApiPropertyOptional({
    description: 'ISO date string for the next scheduled inspection',
    example: '2025-05-15T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  nextInspectionDate?: string;

  @ApiPropertyOptional({
    description: 'User ID of the Property Manager to assign',
    example: 'clxyz123abc',
  })
  @IsOptional()
  @IsString()
  propertyManagerId?: string;

  @ApiPropertyOptional({
    description:
      'Dashboard Template ID to use. If omitted the system will use the default active template.',
    example: 'clxyz456def',
  })
  @IsOptional()
  @IsString()
  templateId?: string;
}

// ─── Schedule Inspection (separate action from property card)

export class ScheduleInspectionDto {
  @ApiProperty({
    description: 'ISO date-time string for the scheduled inspection',
    example: '2026-02-08T10:00:00.000Z',
  })
  @IsDateString()
  scheduledAt: string;
}

// ─── Assign Property Manager (separate action from property card)

export class AssignPropertyManagerDto {
  @ApiProperty({
    description: 'User ID of the Property Manager to assign',
    example: 'clxyz123abc',
  })
  @IsString()
  @IsNotEmpty()
  propertyManagerId: string;
}

// ─── Manage Property Access

export class GrantPropertyAccessDto {
  @ApiProperty({
    description: 'User ID to grant access to this property dashboard',
    example: 'clxyz789ghi',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description:
      'ISO date string when access should automatically expire (for insurers / consultants)',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  accessExpiresAt?: string;
}

export class RevokePropertyAccessDto {
  @ApiProperty({
    description: 'User ID whose access should be revoked',
    example: 'clxyz789ghi',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class SetAccessExpirationDto {
  @ApiProperty({
    description: 'User ID whose access expiration is being updated',
    example: 'clxyz789ghi',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'New expiration date-time in ISO format',
    example: '2026-06-30T23:59:59.000Z',
  })
  @IsDateString()
  accessExpiresAt: string;
}

// ─── Update Property

export class UpdatePropertyDto {
  @ApiPropertyOptional({ example: 'Sunset Office Complex – Building B' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '1234 Sunset Blvd, Los Angeles, CA 90028' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ enum: PropertyType })
  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @ApiPropertyOptional({ example: '2025-11-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  nextInspectionDate?: string;
}