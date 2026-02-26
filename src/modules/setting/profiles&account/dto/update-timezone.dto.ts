import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateTimezoneDto {
  @ApiProperty({
    example: false,
    description: 'If true, timezone is set automatically from browser/system',
  })
  @IsBoolean()
  auto_timezone: boolean;

  @ApiPropertyOptional({
    example: 'America/Guatemala',
    description:
      'IANA timezone string. Required when auto_timezone is false.',
  })
  @IsOptional()
  @IsString()
  timezone?: string;
}