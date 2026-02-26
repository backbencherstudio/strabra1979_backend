import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Gustavo', description: 'First name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  first_name?: string;

  @ApiPropertyOptional({ example: 'Xavier', description: 'Last name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  last_name?: string;
}
