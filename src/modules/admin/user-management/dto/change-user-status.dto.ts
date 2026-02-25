import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserStatus } from 'prisma/generated/enums';

export class ChangeUserStatusDto {
  @IsNotEmpty()
  @IsEnum(UserStatus)
  @ApiProperty({
    enum: UserStatus,
    example: UserStatus.ACTIVE,
    description: 'New status to apply to the user',
  })
  status: UserStatus;
}