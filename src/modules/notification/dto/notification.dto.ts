import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class TakeNotificationActionDto {
  @ApiProperty({ enum: ['ACCEPT', 'DECLINE'] })
  @IsIn(['ACCEPT', 'DECLINE'])
  action: 'ACCEPT' | 'DECLINE';
}
