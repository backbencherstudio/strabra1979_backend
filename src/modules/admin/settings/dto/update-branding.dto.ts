import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBrandingDto {
  @ApiPropertyOptional({ description: 'Platform display name', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  platform_name?: string;

  @ApiPropertyOptional({ description: 'URL to the platform logo image' })
  @IsOptional()
  @IsString()
  platform_logo_url?: string;

  @ApiPropertyOptional({ description: 'URL to the signup onboarding image' })
  @IsOptional()
  @IsString()
  signup_onboarding_image_url?: string;

  @ApiPropertyOptional({ description: 'URL to the login onboarding image' })
  @IsOptional()
  @IsString()
  login_onboarding_image_url?: string;

  @ApiPropertyOptional({
    description: 'Primary hex color (e.g. #1A2B3C)',
    maxLength: 7,
  })
  @IsOptional()
  @IsString()
  @MaxLength(7)
  @Matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, {
    message: 'primary_color must be a valid hex color (e.g. #FFF or #1A2B3C)',
  })
  primary_color?: string;

  @ApiPropertyOptional({
    description: 'Human-readable label for the primary color',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  primary_color_label?: string;
}
