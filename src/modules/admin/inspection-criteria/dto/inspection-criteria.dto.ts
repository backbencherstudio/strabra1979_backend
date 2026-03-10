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
// INITIAL FIELD DTOs  (sent once at creation — all become isSystem=true)
// ─────────────────────────────────────────────────────────────────────────────

export class InitialHeaderFieldDto {
  @ApiProperty({
    example: 'roofSystemType',
    description:
      'Unique camelCase key — used as the field identifier in Inspection.headerData JSON.',
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

  @ApiProperty({
    example: true,
    description: 'If true, renders as a dropdown select',
  })
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
    description:
      'Unique camelCase key — used as the category identifier in Inspection.scores JSON.',
  })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ example: 'Surface Condition' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({
    example: 25,
    description:
      'Max points (1–100). Total across all categories must not exceed 100.',
  })
  @IsInt()
  @Min(1)
  @Max(100)
  maxPoints: number;
}

export class InitialMediaFieldDto {
  @ApiProperty({
    example: 'aerialMap',
    description:
      'Unique camelCase key — used as MediaFile.mediaFieldKey to link uploaded files to this slot.',
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
// NTE CONFIG DTO
// Maps to InspectionCriteria.nteConfig Json
// { "label": "NTE (Not-To-Exceed)", "placeholder": "Enter NTE" }
// ─────────────────────────────────────────────────────────────────────────────

export class NteConfigDto {
  @ApiPropertyOptional({
    example: 'NTE (Not-To-Exceed)',
    description: 'Label shown above the NTE input on the inspection form',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional({
    example: 'Enter NTE',
    description: 'Placeholder text inside the NTE input',
  })
  @IsOptional()
  @IsString()
  placeholder?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL NOTES CONFIG DTO
// Maps to InspectionCriteria.additionalNotesConfig Json
// { "label": "Additional Notes/Comments", "placeholder": "Type Any Additional Notes/Comments" }
// ─────────────────────────────────────────────────────────────────────────────

export class AdditionalNotesConfigDto {
  @ApiPropertyOptional({
    example: 'Additional Notes/Comments',
    description: 'Label shown above the notes textarea',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional({
    example: 'Type Any Additional Notes/Comments',
    description: 'Placeholder text inside the notes textarea',
  })
  @IsOptional()
  @IsString()
  placeholder?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPAIR PLANNING CONFIG DTO
// Maps to InspectionCriteria.repairPlanningConfig Json
// { "statuses": ["Urgent", "Maintenance", "Replacement Planning"] }
// The actual repair items (title/status/description) are stored in Inspection.repairItems — not here.
// ─────────────────────────────────────────────────────────────────────────────

export class RepairPlanningConfigDto {
  @ApiProperty({
    example: ['Urgent', 'Maintenance', 'Replacement Planning'],
    description:
      'Status options the inspector can pick from when adding a repair item. The actual repair items are stored in Inspection.repairItems.',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one repair status is required' })
  @IsString({ each: true })
  statuses: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH THRESHOLD CONFIG DTOs
// Maps to InspectionCriteria.healthThresholdConfig Json
// {
//   "good": { "minScore": 70, "maxScore": 100, "remainingLifeMinYears": 5, "remainingLifeMaxYears": 7 },
//   "fair": { "minScore": 30, "maxScore": 69,  "remainingLifeMinYears": 3, "remainingLifeMaxYears": 5 },
//   "poor": { "minScore": 0,  "maxScore": 29,  "remainingLifeMinYears": 0, "remainingLifeMaxYears": 2 }
// }
// ─────────────────────────────────────────────────────────────────────────────

export class HealthTierDto {
  @ApiProperty({
    example: 70,
    description: 'Minimum score for this tier (inclusive)',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  minScore: number;

  @ApiProperty({
    example: 100,
    description: 'Maximum score for this tier (inclusive)',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  maxScore: number;

  @ApiProperty({
    example: 5,
    description: 'Minimum remaining life estimate in years',
  })
  @IsInt()
  @Min(0)
  remainingLifeMinYears: number;

  @ApiProperty({
    example: 7,
    description: 'Maximum remaining life estimate in years',
  })
  @IsInt()
  @Min(0)
  remainingLifeMaxYears: number;
}

export class HealthThresholdConfigDto {
  @ApiProperty({
    type: HealthTierDto,
    example: {
      minScore: 70,
      maxScore: 100,
      remainingLifeMinYears: 5,
      remainingLifeMaxYears: 7,
    },
  })
  @ValidateNested()
  @Type(() => HealthTierDto)
  good: HealthTierDto;

  @ApiProperty({
    type: HealthTierDto,
    example: {
      minScore: 30,
      maxScore: 69,
      remainingLifeMinYears: 3,
      remainingLifeMaxYears: 5,
    },
  })
  @ValidateNested()
  @Type(() => HealthTierDto)
  fair: HealthTierDto;

  @ApiProperty({
    type: HealthTierDto,
    example: {
      minScore: 0,
      maxScore: 29,
      remainingLifeMinYears: 0,
      remainingLifeMaxYears: 2,
    },
  })
  @ValidateNested()
  @Type(() => HealthTierDto)
  poor: HealthTierDto;
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE DTO — mirrors every Json column in InspectionCriteria exactly
// ─────────────────────────────────────────────────────────────────────────────

export class CreateInspectionCriteriaDto {
  // ── Scalar columns ──────────────────────────────────────────────────────────

  @ApiProperty({ example: 'Standard Roof Inspection' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    example: 'Default criteria for all commercial roof inspections',
  })
  @IsOptional()
  @IsString()
  description?: string;

  // ── headerFields Json ───────────────────────────────────────────────────────

  @ApiProperty({
    description:
      'Maps to InspectionCriteria.headerFields. ' +
      'Input fields shown at the top of the inspection form. ' +
      'All become isSystem=true (cannot be deleted, only label/placeholder/options editable). ' +
      'Keys must be unique. Order is derived from array position.',
    type: [InitialHeaderFieldDto],
    example: [
      {
        key: 'inspectionTitle',
        label: 'Inspection Title',
        placeholder: 'Enter title',
        required: true,
        isDropdown: false,
      },
      {
        key: 'propertyType',
        label: 'Property Type',
        placeholder: 'Select type',
        required: false,
        isDropdown: true,
        options: ['Commercial', 'Residential'],
      },
      {
        key: 'roofSystemType',
        label: 'Roof System Type',
        placeholder: 'Select roof system',
        required: false,
        isDropdown: true,
        options: ['TPO', 'Metal', 'Shingle'],
      },
      {
        key: 'drainageType',
        label: 'Drainage Type',
        placeholder: 'Select drainage',
        required: false,
        isDropdown: true,
        options: ['Internal', 'External'],
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one header field is required' })
  @ValidateNested({ each: true })
  @Type(() => InitialHeaderFieldDto)
  headerFields: InitialHeaderFieldDto[];

  // ── scoringCategories Json ──────────────────────────────────────────────────

  @ApiProperty({
    description:
      'Maps to InspectionCriteria.scoringCategories. ' +
      'Scored checklist categories. All become isSystem=true. ' +
      'Keys must be unique. Total maxPoints must not exceed 100.',
    type: [InitialScoringCategoryDto],
    example: [
      { key: 'surfaceCondition', label: 'Surface Condition', maxPoints: 25 },
      { key: 'seamsFlashings', label: 'Seams & Flashings', maxPoints: 20 },
      { key: 'drainagePonding', label: 'Drainage & Ponding', maxPoints: 15 },
      {
        key: 'penetrations',
        label: 'Penetrations & Accessories',
        maxPoints: 10,
      },
      {
        key: 'repairsHistory',
        label: 'Repairs & Patch History',
        maxPoints: 10,
      },
      { key: 'ageExpectedLife', label: 'Age vs. Expected Life', maxPoints: 10 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one scoring category is required' })
  @ValidateNested({ each: true })
  @Type(() => InitialScoringCategoryDto)
  scoringCategories: InitialScoringCategoryDto[];

  // ── mediaFields Json ────────────────────────────────────────────────────────

  @ApiProperty({
    description:
      'Maps to InspectionCriteria.mediaFields. ' +
      'Media upload slots in the Media Files tab. All become isSystem=true. ' +
      'isMediaFile=true → file upload. isEmbedded=true → URL/iframe textarea. ' +
      'Both false → document slot. Keys must be unique.',
    type: [InitialMediaFieldDto],
    example: [
      {
        key: 'mediaFiles',
        label: 'Media Files',
        placeholder: 'Upload Media file',
        isMediaFile: true,
        isEmbedded: false,
        accept: ['image/*', 'video/*'],
      },
      {
        key: 'aerialMap',
        label: 'Aerial Map',
        placeholder: 'Upload your file.',
        isMediaFile: true,
        isEmbedded: false,
        accept: ['image/*'],
      },
      {
        key: 'tour3d',
        label: '3D Tours',
        placeholder: 'Paste Source URL / iframe Code',
        isMediaFile: false,
        isEmbedded: true,
      },
      {
        key: 'documents',
        label: 'Documents',
        placeholder: 'Add Documents',
        isMediaFile: false,
        isEmbedded: false,
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one media field is required' })
  @ValidateNested({ each: true })
  @Type(() => InitialMediaFieldDto)
  mediaFields: InitialMediaFieldDto[];

  // ── nteConfig Json ──────────────────────────────────────────────────────────

  @ApiProperty({
    description:
      'Maps to InspectionCriteria.nteConfig. Label and placeholder for the NTE input field on the inspection form.',
    type: NteConfigDto,
    example: { label: 'NTE (Not-To-Exceed)', placeholder: 'Enter NTE' },
  })
  @ValidateNested()
  @Type(() => NteConfigDto)
  nteConfig: NteConfigDto;

  // ── additionalNotesConfig Json ──────────────────────────────────────────────

  @ApiProperty({
    description:
      'Maps to InspectionCriteria.additionalNotesConfig. Label and placeholder for the Additional Notes textarea.',
    type: AdditionalNotesConfigDto,
    example: {
      label: 'Additional Notes/Comments',
      placeholder: 'Type Any Additional Notes/Comments',
    },
  })
  @ValidateNested()
  @Type(() => AdditionalNotesConfigDto)
  additionalNotesConfig: AdditionalNotesConfigDto;

  // ── repairPlanningConfig Json ───────────────────────────────────────────────

  @ApiProperty({
    description:
      'Maps to InspectionCriteria.repairPlanningConfig. ' +
      'Defines the status options shown in the repair item dropdown. ' +
      'The actual repair items (title/status/description) are stored in Inspection.repairItems — not here.',
    type: RepairPlanningConfigDto,
    example: { statuses: ['Urgent', 'Maintenance', 'Replacement Planning'] },
  })
  @ValidateNested()
  @Type(() => RepairPlanningConfigDto)
  repairPlanningConfig: RepairPlanningConfigDto;

  // ── healthThresholdConfig Json ──────────────────────────────────────────────

  @ApiProperty({
    description:
      'Maps to InspectionCriteria.healthThresholdConfig. ' +
      'Score ranges and remaining life estimates for Good, Fair, and Poor tiers. ' +
      'Used to compute Inspection.healthLabel and Inspection.remainingLife.',
    type: HealthThresholdConfigDto,
    example: {
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
  })
  @ValidateNested()
  @Type(() => HealthThresholdConfigDto)
  healthThresholdConfig: HealthThresholdConfigDto;
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE DTO — top-level scalars only (name, description)
// Use dedicated PATCH sub-endpoints for each Json column
// ─────────────────────────────────────────────────────────────────────────────

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
// HEADER FIELD DTOs  — add/edit individual fields after creation
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

  @ApiProperty({
    example: false,
    description: 'If true, renders as a dropdown select',
  })
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
    description: 'Full replacement array. Omit an option to delete it.',
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
    description: 'Updated MIME types. Only for file upload fields.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accept?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG UPDATE DTOs — one per Json column, used by PATCH sub-endpoints
// PATCH /inspection-criteria/:id/nte-config
// PATCH /inspection-criteria/:id/additional-notes-config
// PATCH /inspection-criteria/:id/repair-planning-config
// PATCH /inspection-criteria/:id/health-threshold-config
// ─────────────────────────────────────────────────────────────────────────────

export class UpdateNteConfigDto {
  @ApiPropertyOptional({ example: 'NTE (Not-To-Exceed)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional({ example: 'Enter NTE' })
  @IsOptional()
  @IsString()
  placeholder?: string;
}

export class UpdateAdditionalNotesConfigDto {
  @ApiPropertyOptional({ example: 'Additional Notes/Comments' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional({ example: 'Type Any Additional Notes/Comments' })
  @IsOptional()
  @IsString()
  placeholder?: string;
}

export class UpdateRepairPlanningConfigDto {
  @ApiProperty({
    example: ['Urgent', 'Maintenance', 'Replacement Planning'],
    description:
      'Full replacement statuses array. Send the complete desired list — omit a status to remove it.',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one repair status is required' })
  @IsString({ each: true })
  statuses: string[];
}

export class UpdateHealthTierDto {
  @ApiPropertyOptional({ example: 70 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxScore?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  remainingLifeMinYears?: number;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  remainingLifeMaxYears?: number;
}

export class UpdateHealthThresholdConfigDto {
  @ApiPropertyOptional({
    type: UpdateHealthTierDto,
    description:
      'Partially update Good tier — omitted fields keep current values',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateHealthTierDto)
  good?: UpdateHealthTierDto;

  @ApiPropertyOptional({
    type: UpdateHealthTierDto,
    description: 'Partially update Fair tier',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateHealthTierDto)
  fair?: UpdateHealthTierDto;

  @ApiPropertyOptional({
    type: UpdateHealthTierDto,
    description: 'Partially update Poor tier',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateHealthTierDto)
  poor?: UpdateHealthTierDto;
}
