import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserLevelNotificationsDto {
  // ── Property Manager ──────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pm_new_property_dashboard_assigned?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pm_property_dashboard_access_request?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pm_property_dashboard_update?: boolean;

  // ── Authorized Viewer ─────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  av_new_property_dashboard_invitation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  av_access_request_update?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  av_property_dashboard_update?: boolean;

  // ── Operational Team ──────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ot_new_inspection_assigned?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ot_due_inspection?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ot_incomplete_inspection_report?: boolean;
}