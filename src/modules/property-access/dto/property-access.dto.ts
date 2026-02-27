import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Authorized Viewer: Request access to a property ──────────────────────────

export class RequestPropertyAccessDto {
  @ApiPropertyOptional({
    description:
      'Optional message to the Property Manager explaining why access is needed',
    example:
      'I am the assigned insurer for this building and need to review the inspection reports.',
  })
  @IsOptional()
  @IsString()
  message?: string;
}

// ── Property Manager / Admin: Review (approve or decline) a request ──────────

export class ReviewAccessRequestDto {
  @ApiProperty({
    description: 'Action to take on the access request',
    enum: ['APPROVED', 'DECLINED'],
    example: 'APPROVED',
  })
  @IsString()
  @IsNotEmpty()
  action: 'APPROVED' | 'DECLINED';

  @ApiPropertyOptional({
    description: 'Required when declining — reason shown to the requester',
    example: 'Access is only available after contract signing.',
  })
  @IsOptional()
  @IsString()
  declineReason?: string;

  @ApiPropertyOptional({
    description:
      'ISO date-time for when access should expire (optional, for time-limited access)',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

// ── Property Manager / Admin: Share dashboard directly (Image 1) ─────────────

export class ShareDashboardDto {
  @ApiProperty({
    description: 'Email address or user ID to invite',
    example: 'insurer@example.com',
  })
  @IsString()
  @IsNotEmpty()
  emailOrUserId: string;

  @ApiPropertyOptional({
    description: 'ISO date-time for when this shared access should expire',
    example: '2026-06-30T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

// ── Property Manager / Admin: Revoke access ───────────────────────────────────

export class RevokeAccessDto {
  @ApiPropertyOptional({
    description: 'Optional reason for revocation (stored in audit log)',
    example: 'Contract expired.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
