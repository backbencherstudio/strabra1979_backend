import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPassword123!',
    description: 'Current password',
  })
  @IsString()
  current_password: string;

  @ApiProperty({
    example: 'NewPassword123!',
    description: 'New password (min 8 characters)',
  })
  @IsString()
  @MinLength(8)
  new_password: string;

  @ApiProperty({
    example: 'NewPassword123!',
    description: 'Must match new_password',
  })
  @IsString()
  confirm_new_password: string;
}