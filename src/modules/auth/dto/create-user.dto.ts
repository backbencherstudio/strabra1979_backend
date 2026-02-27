import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';
import { Role } from 'prisma/generated/enums';

export class CreateUserDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({ example: 'john_doe' })
  username: string;

  @IsNotEmpty()
  @IsEnum(Role)
  @ApiProperty({ enum: Role, example: Role.AUTHORIZED_VIEWER })
  role: Role;

  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({ example: 'john@gmail.com' })
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @ApiProperty({ example: '12345678' })
  password: string;
}

export class LoginDto {
  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({ example: 'john@gmail.com' })
  email: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ example: '12345678' })
  password: string;
}

export class RefreshTokenDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.refresh.token.example',
  })
  refresh_token: string;
}

export class ForgotPasswordDto {
  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    example: 'john@example.com',
    description: 'User email to receive OTP',
  })
  email: string;
}

export class VerifyEmailDto {
  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: '123456' })
  otp: string;
}

export class ResendVerificationDto {
  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ example: 'john@example.com' })
  email: string;
}

export class ResetPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({
    example: 'john@example.com',
    description: 'User email',
  })
  email: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    example: '28ee058c678f5c0d7260',
    description: 'OTP or reset token received in email',
  })
  reset_token: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, {
    message: 'Password must be at least 8 characters',
  })
  @ApiProperty({
    example: 'NewStrongPass123',
    description: 'New password after OTP verification',
  })
  new_password: string;
}
