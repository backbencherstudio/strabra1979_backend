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
    example: '2026-10-15T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  nextInspectionDate?: string;

  @ApiPropertyOptional({
    description: 'Operational team user ID to assign',
    example: 'cmmlnbk3900030ou81inxlhw6',
  })
  @IsOptional()
  @IsString()
  assignedTo?: string;

  @ApiPropertyOptional({
    description: 'User ID of the Property Manager to assign',
    example: 'cmmlnbk2v00010ou8b7w5rcm0',
  })
  @IsOptional()
  @IsString()
  propertyManagerId?: string;
}

// ─── Schedule Inspection (separate action from property card)

export class ScheduleInspectionDto {
  @ApiProperty({ example: '2026-10-01T10:00:00Z' })
  @IsDateString()
  scheduledAt: string;

  @ApiProperty({
    description: 'Operational team user ID to assign',
    example: 'cmmlnbk3900030ou81inxlhw6',
  })
  @IsString()
  assignedTo: string;
}

// ─── Assign Property Manager (separate action from property card)

export class AssignPropertyUserDto {
  @ApiProperty({ example: 'clxyz123abc', description: 'User ID to assign' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    example: '2025-12-31T00:00:00.000Z',
    description:
      'Optional expiry date for time-limited access. ' +
      'Only applies to non-PROPERTY_MANAGER roles. ' +
      'Omit or pass null for permanent access.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
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
