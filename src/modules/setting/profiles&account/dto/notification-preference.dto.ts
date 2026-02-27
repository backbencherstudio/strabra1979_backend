import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Each role has its own notification fields on the User model.
 * The API accepts all fields but only the ones matching the
 * user's role will be meaningful. Unknown/irrelevant fields
 * are simply ignored by the service.
 */
export class UpdateNotificationPreferencesDto {
  // ── Property Manager ──────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_pm_new_property_dashboard_assigned?: boolean;   // ✅

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_pm_property_dashboard_access_request?: boolean; // ✅

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_pm_property_dashboard_update?: boolean;         // ✅

  // ── Authorized Viewer ─────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_av_new_property_dashboard_invitation?: boolean; // ✅

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_av_access_request_update?: boolean;             // ✅

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_av_property_dashboard_update?: boolean;         // ✅

  // ── Operational Team ──────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_ot_new_inspection_assigned?: boolean;           // ✅

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_ot_due_inspection?: boolean;                    // ✅

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_ot_incomplete_inspection_report?: boolean;      // ✅

  // ── Admin ─────────────────────────────────────────────────────────────
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_admin_new_user_registration?: boolean;          // ✅

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_admin_due_inspection?: boolean;                 // ✅

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notif_admin_new_inspection_report_update?: boolean;   // ✅
}