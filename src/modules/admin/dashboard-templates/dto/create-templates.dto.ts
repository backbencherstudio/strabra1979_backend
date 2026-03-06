import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsEnum,
  IsBoolean,
  ValidateNested,
  IsInt,
  Min,
  IsObject,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateStatus } from 'prisma/generated/enums';

// ─── Section Types ────────────────────────────────────────────────────────────

export enum SectionType {
  // Fixed (always present, non-removable)
  PRIORITY_REPAIR_PLANNING = 'priority_repair_planning',
  DOCUMENTS = 'documents',
  ADDITIONAL_INFORMATION = 'additional_information',

  // Dynamic — added by admin
  TEXT_FIELD = 'text_field',
  MEDIA_FIELD = 'media_field',
}

export enum MediaFieldType {
  MEDIA = 'media',       // Photos / videos uploaded directly
  EMBEDDED = 'embedded', // 3D tours, maps, external links
}

// ─── Style Sub-DTOs ───────────────────────────────────────────────────────────

export class TypographyStyleDto {
  @ApiPropertyOptional({ example: 'Poppins' })
  @IsString()
  @IsOptional()
  font?: string;

  @ApiPropertyOptional({ example: 'Regular' })
  @IsString()
  @IsOptional()
  weight?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsInt()
  @IsOptional()
  size?: number;

  @ApiPropertyOptional({ example: 'left', enum: ['left', 'center', 'right'] })
  @IsString()
  @IsOptional()
  align?: 'left' | 'center' | 'right';
}

export class FillStyleDto {
  @ApiPropertyOptional({ example: '#FFFFFF' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ example: 100, description: 'Opacity 0–100' })
  @IsInt()
  @IsOptional()
  opacity?: number;
}

export class SizeStyleDto {
  @ApiPropertyOptional({ example: 295 })
  @IsInt()
  @IsOptional()
  width?: number;

  @ApiPropertyOptional({ example: 'fixed', enum: ['fixed', 'fill'] })
  @IsString()
  @IsOptional()
  widthMode?: 'fixed' | 'fill';

  @ApiPropertyOptional({ example: 295 })
  @IsInt()
  @IsOptional()
  height?: number;

  @ApiPropertyOptional({ example: 'fixed', enum: ['fixed', 'fill'] })
  @IsString()
  @IsOptional()
  heightMode?: 'fixed' | 'fill';
}

export class LayoutStyleDto {
  @ApiPropertyOptional({ example: 'left', enum: ['left', 'center', 'right'] })
  @IsString()
  @IsOptional()
  align?: 'left' | 'center' | 'right';

  @ApiPropertyOptional({ example: 8 })
  @IsInt()
  @IsOptional()
  horizontalPadding?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsInt()
  @IsOptional()
  verticalPadding?: number;
}

export class SectionStyleDto {
  @ApiPropertyOptional({ type: TypographyStyleDto })
  @ValidateNested()
  @Type(() => TypographyStyleDto)
  @IsOptional()
  typography?: TypographyStyleDto;

  @ApiPropertyOptional({ type: FillStyleDto })
  @ValidateNested()
  @Type(() => FillStyleDto)
  @IsOptional()
  fill?: FillStyleDto;

  @ApiPropertyOptional({ type: SizeStyleDto })
  @ValidateNested()
  @Type(() => SizeStyleDto)
  @IsOptional()
  size?: SizeStyleDto;

  @ApiPropertyOptional({ type: LayoutStyleDto })
  @ValidateNested()
  @Type(() => LayoutStyleDto)
  @IsOptional()
  layout?: LayoutStyleDto;
}

// ─── Section Configs ──────────────────────────────────────────────────────────

/**
 * TEXT_FIELD config
 * Corresponds to "Add More Text Fields" modal
 */
export class TextFieldConfigDto {
  @ApiProperty({ example: 'NTE (Not-To-Exceed)' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ example: 'Enter amount...' })
  @IsString()
  @IsOptional()
  placeholder?: string;
}

/**
 * MEDIA_FIELD config
 * Corresponds to "Add More Supporting Media & Embedded Contents" modal
 */
export class MediaFieldConfigDto {
  @ApiProperty({ example: 'Aerial Map' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    enum: MediaFieldType,
    example: MediaFieldType.MEDIA,
    description: 'media = uploaded photos/videos | embedded = 3D tours, maps, external links',
  })
  @IsEnum(MediaFieldType)
  mediaType: MediaFieldType;

  @ApiPropertyOptional({
    example: 'https://my3dtour.com/embed/abc',
    description: 'Required when mediaType is EMBEDDED',
  })
  @ValidateIf((o) => o.mediaType === MediaFieldType.EMBEDDED)
  @IsString()
  @IsNotEmpty()
  embedUrl?: string;
}

// ─── Main Section DTO ─────────────────────────────────────────────────────────

export class TemplateSectionDto {
  @ApiProperty({ example: 1, description: 'Display order (1-based)' })
  @IsInt()
  @Min(1)
  order: number;

  @ApiProperty({ enum: SectionType })
  @IsEnum(SectionType)
  type: SectionType;

  @ApiProperty({ example: 'Media Files' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({
    description:
      'false = fixed section (cannot be removed by admin) | true = dynamically added',
    example: false,
  })
  @IsBoolean()
  isDynamic: boolean;

  @ApiPropertyOptional({
    description:
      'Shape depends on type: ' +
      'TEXT_FIELD → { label, placeholder? } | ' +
      'MEDIA_FIELD → { title, mediaType, embedUrl? } | ' +
      'Fixed sections → {}',
  })
  @IsObject()
  @IsOptional()
  config?: TextFieldConfigDto | MediaFieldConfigDto | Record<string, never>;

  @ApiPropertyOptional({
    description: 'Visual style overrides (typography, fill, size, layout)',
    type: SectionStyleDto,
  })
  @ValidateNested()
  @Type(() => SectionStyleDto)
  @IsOptional()
  style?: SectionStyleDto;
}

// ─── Create / Update ─────────────────────────────────────────────────────────

export class CreateDashboardTemplateDto {
  @ApiProperty({ example: 'Standard Roof Inspection Template' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'clx1234abc' })
  @IsString()
  @IsNotEmpty()
  criteriaId: string;

  @ApiPropertyOptional({ enum: TemplateStatus, default: TemplateStatus.ACTIVE })
  @IsEnum(TemplateStatus)
  @IsOptional()
  status?: TemplateStatus;

  @ApiProperty({
    type: [TemplateSectionDto],
    description:
      'Sections array. Must always include the 3 fixed sections ' +
      '(priority_repair_planning, documents, additional_information) with isDynamic: false. ' +
      'Additional text/media sections use isDynamic: true.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSectionDto)
  sections: TemplateSectionDto[];
}

// ─── Patch Helpers ────────────────────────────────────────────────────────────

export class UpdateSectionStyleDto {
  @ApiProperty({ description: 'Section order index to target' })
  @IsInt()
  @Min(1)
  order: number;

  @ApiProperty({ type: SectionStyleDto })
  @ValidateNested()
  @Type(() => SectionStyleDto)
  style: SectionStyleDto;
}

export class AddTextFieldDto extends TextFieldConfigDto {
  @ApiPropertyOptional({ type: SectionStyleDto })
  @ValidateNested()
  @Type(() => SectionStyleDto)
  @IsOptional()
  style?: SectionStyleDto;
}

export class AddMediaFieldDto extends MediaFieldConfigDto {
  @ApiPropertyOptional({ type: SectionStyleDto })
  @ValidateNested()
  @Type(() => SectionStyleDto)
  @IsOptional()
  style?: SectionStyleDto;
}