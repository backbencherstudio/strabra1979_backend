import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Notify when a new property dashboard is assigned to the user',
  })
  @IsOptional()
  @IsBoolean()
  notif_new_property_dashboard_assigned?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Notify when a property dashboard access request is made',
  })
  @IsOptional()
  @IsBoolean()
  notif_property_dashboard_access_request?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Notify when a property dashboard is updated',
  })
  @IsOptional()
  @IsBoolean()
  notif_property_dashboard_update?: boolean;
}