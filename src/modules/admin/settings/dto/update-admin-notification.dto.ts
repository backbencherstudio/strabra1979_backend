import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAdminNotificationsDto {
  @ApiPropertyOptional({ description: 'Notify when a new user registers' })
  @IsOptional()
  @IsBoolean()
  notif_admin_new_user_registration?: boolean;

  @ApiPropertyOptional({ description: 'Notify when an inspection is due' })
  @IsOptional()
  @IsBoolean()
  notif_admin_due_inspection?: boolean;

  @ApiPropertyOptional({
    description: 'Notify when an inspection report is submitted or updated',
  })
  @IsOptional()
  @IsBoolean()
  notif_admin_new_inspection_report_update?: boolean;
}
