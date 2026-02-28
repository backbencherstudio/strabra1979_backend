import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsArray,
  IsInt,
  ArrayMinSize,
  ValidateIf,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL FIELD DTOs  (sent by user at criteria creation time)
// These all become isSystem=true — locked from deletion forever.
// key is user-supplied so inspection records can reference them by a stable,
// meaningful identifier (e.g. "roofSystemType" in headerData JSON).
// order is derived from array position, not sent by the user.
// ─────────────────────────────────────────────────────────────────────────────

export class InitialHeaderFieldDto {
  @ApiProperty({
    example: 'roofSystemType',
    description: 'Unique camelCase key. Used as the field identifier in inspection headerData JSON.',
  })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ example: 'Roof System Type' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ example: 'Select roof system' })
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  required: boolean;

  @ApiProperty({ example: true, description: 'If true, renders as a dropdown select' })
  @IsBoolean()
  isDropdown: boolean;

  @ApiPropertyOptional({
    example: ['TPO', 'Metal', 'Shingle'],
    description: 'Required when isDropdown is true',
    type: [String],
  })
  @ValidateIf((o) => o.isDropdown === true)
  @IsArray()
  @ArrayMinSize(1, { message: 'Dropdown must have at least one option' })
  @IsString({ each: true })
  options?: string[];
}

export class InitialScoringCategoryDto {
  @ApiProperty({
    example: 'surfaceCondition',
    description: 'Unique camelCase key. Used as the category identifier in inspection scores JSON.',
  })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ example: 'Surface Condition' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ example: 25, description: 'Max points (1–100). Total across all must not exceed 100.' })
  @IsInt()
  @Min(1)
  @Max(100)
  maxPoints: number;
}

export class InitialMediaFieldDto {
  @ApiProperty({
    example: 'aerialMap',
    description: 'Unique camelCase key.',
  })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ example: 'Aerial Map' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ example: 'Upload your file.' })
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiProperty({
    example: true,
    description: 'true → file upload widget (Aerial Map style). Set isEmbedded=false.',
  })
  @IsBoolean()
  isMediaFile: boolean;

  @ApiProperty({
    example: false,
    description: 'true → URL/iframe textarea (3D Tours style). Set isMediaFile=false.',
  })
  @IsBoolean()
  isEmbedded: boolean;

  @ApiPropertyOptional({
    example: ['image/*'],
    description: 'Accepted MIME types. Only used when isMediaFile=true.',
    type: [String],
  })
  @ValidateIf((o) => o.isMediaFile === true)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accept?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIA DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class CreateInspectionCriteriaDto {
  @ApiProperty({ example: 'Standard Roof Inspection' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Default criteria for all commercial roof inspections' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description:
      'Initial header input fields shown at the top of the inspection form. ' +
      'All become isSystem=true (cannot be deleted later, only label/placeholder/options editable). ' +
      'Keys must be unique. Order is derived from array position.',
    type: [InitialHeaderFieldDto],
    example: [
      { key: 'inspectionTitle', label: 'Inspection Title', placeholder: 'Enter title',       required: true,  isDropdown: false },
      { key: 'propertyType',    label: 'Property Type',    placeholder: 'Select type',        required: false, isDropdown: true, options: ['Commercial', 'Residential'] },
      { key: 'roofSystemType',  label: 'Roof System Type', placeholder: 'Select roof system', required: false, isDropdown: true, options: ['TPO', 'Metal', 'Shingle'] },
      { key: 'drainageType',    label: 'Drainage Type',    placeholder: 'Select drainage',    required: false, isDropdown: true, options: ['Internal', 'External'] },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one header field is required' })
  @ValidateNested({ each: true })
  @Type(() => InitialHeaderFieldDto)
  headerFields: InitialHeaderFieldDto[];

  @ApiProperty({
    description:
      'Initial scoring categories for the checklist. ' +
      'All become isSystem=true (label editable, maxPoints locked). ' +
      'Keys must be unique. Total maxPoints must not exceed 100.',
    type: [InitialScoringCategoryDto],
    example: [
      { key: 'surfaceCondition', label: 'Surface Condition',          maxPoints: 25 },
      { key: 'seamsFlashings',   label: 'Seams & Flashings',          maxPoints: 20 },
      { key: 'drainagePonding',  label: 'Drainage & Ponding',         maxPoints: 15 },
      { key: 'penetrations',     label: 'Penetrations & Accessories', maxPoints: 10 },
      { key: 'repairsHistory',   label: 'Repairs & Patch History',    maxPoints: 10 },
      { key: 'ageExpectedLife',  label: 'Age vs. Expected Life',      maxPoints: 10 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one scoring category is required' })
  @ValidateNested({ each: true })
  @Type(() => InitialScoringCategoryDto)
  scoringCategories: InitialScoringCategoryDto[];

  @ApiProperty({
    description:
      'Initial media input fields shown in the Media Files tab. ' +
      'All become isSystem=true (label/placeholder editable, type locked). ' +
      'isMediaFile=true → file upload. isEmbedded=true → URL/iframe textarea. ' +
      'Both false → document slot (one required for the documents section). ' +
      'Keys must be unique.',
    type: [InitialMediaFieldDto],
    example: [
      { key: 'mediaFiles', label: 'Media Files', placeholder: 'Upload Media file',             isMediaFile: true,  isEmbedded: false, accept: ['image/*', 'video/*'] },
      { key: 'aerialMap',  label: 'Aerial Map',  placeholder: 'Upload your file.',             isMediaFile: true,  isEmbedded: false, accept: ['image/*'] },
      { key: 'tour3d',     label: '3D Tours',    placeholder: 'Paste Source URL / iframe Code', isMediaFile: false, isEmbedded: true },
      { key: 'documents',  label: 'Documents',   placeholder: 'Add Documents',                 isMediaFile: false, isEmbedded: false },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one media field is required' })
  @ValidateNested({ each: true })
  @Type(() => InitialMediaFieldDto)
  mediaFields: InitialMediaFieldDto[];
}

export class UpdateInspectionCriteriaDto {
  @ApiPropertyOptional({ example: 'Updated Roof Inspection' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER FIELD DTOs  (add/edit individual fields after creation)
// ─────────────────────────────────────────────────────────────────────────────

export class AddHeaderFieldDto {
  @ApiProperty({ example: 'Inspector Company' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ example: 'Enter company name' })
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  required: boolean;

  @ApiProperty({ example: false, description: 'If true, renders as a dropdown select' })
  @IsBoolean()
  isDropdown: boolean;

  @ApiPropertyOptional({
    example: ['Sunny', 'Cloudy', 'Rainy'],
    description: 'Required when isDropdown is true',
    type: [String],
  })
  @ValidateIf((o) => o.isDropdown === true)
  @IsArray()
  @ArrayMinSize(1, { message: 'Dropdown must have at least one option' })
  @IsString({ each: true })
  options?: string[];
}

export class UpdateHeaderFieldDto {
  @ApiPropertyOptional({ example: 'Weather Condition' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional({ example: 'Select current weather' })
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    example: ['Sunny', 'Cloudy', 'Rainy', 'Windy'],
    description: 'Full replacement options array. To remove an option, send the array without it.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Dropdown must have at least one option' })
  @IsString({ each: true })
  options?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING CATEGORY DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class AddScoringCategoryDto {
  @ApiProperty({ example: 'Structural Integrity' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ example: 20, description: 'Maximum points (1–100)' })
  @IsInt()
  @Min(1)
  @Max(100)
  maxPoints: number;
}

export class UpdateScoringCategoryDto {
  @ApiPropertyOptional({ example: 'Structural Integrity' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxPoints?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA FIELD DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class AddMediaFieldDto {
  @ApiProperty({ example: 'Site Plan' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ example: 'Upload your file.' })
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiProperty({
    example: true,
    description: 'true → file upload widget. Set isEmbedded=false.',
  })
  @IsBoolean()
  isMediaFile: boolean;

  @ApiProperty({
    example: false,
    description: 'true → URL/iframe textarea. Set isMediaFile=false.',
  })
  @IsBoolean()
  isEmbedded: boolean;

  @ApiPropertyOptional({
    example: ['image/*', 'video/*'],
    description: 'Accepted MIME types. Only used when isMediaFile=true.',
    type: [String],
  })
  @ValidateIf((o) => o.isMediaFile === true)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accept?: string[];
}

export class UpdateMediaFieldDto {
  @ApiPropertyOptional({ example: 'Updated Label' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional({ example: 'Upload your updated file here.' })
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiPropertyOptional({
    example: ['image/*'],
    description: 'Updated accepted MIME types. Only for file upload fields.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accept?: string[];
}