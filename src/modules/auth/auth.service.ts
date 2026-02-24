// external imports
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

//internal imports
import appConfig from '../../config/app.config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SojebStorage } from '../../common/lib/Disk/SojebStorage';
import { DateHelper } from '../../common/helper/date.helper';
import { StringHelper } from '../../common/helper/string.helper';
import * as bcrypt from 'bcrypt';
import {
  CreateUserDto,
  LoginDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/create-user.dto';
import { UserStatus } from 'prisma/generated/enums';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private mailService: MailService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async me(userId: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: {
          id: userId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          role: true,
          created_at: true,
        },
      });

      if (!user) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      if (user.avatar) {
        user['avatar_url'] = SojebStorage.url(
          appConfig().storageUrl.avatar + user.avatar,
        );
      }

      if (user) {
        return {
          success: true,
          data: user,
        };
      } else {
        return {
          success: false,
          message: 'User not found',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async updateUser(
    userId: string,
    updateUserDto: UpdateUserDto,
    image?: Express.Multer.File,
  ) {}

  async login(data: LoginDto) {
    const foundUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!foundUser || !foundUser.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      data.password,
      foundUser.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (foundUser.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('User is not active');
    }

    const payload = {
      sub: foundUser.id,
      email: foundUser.email,
      role: foundUser.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '1h',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    await this.redis.set(
      `refresh_token:${foundUser.id}`,
      refreshToken,
      'EX',
      60 * 60 * 24 * 7,
    );

    return {
      success: true,
      message: 'Logged in successfully',
      data: {
        id: foundUser.id,
        type: 'bearer',
        access_token: accessToken,
        refresh_token: refreshToken,
        role: foundUser.role,
      },
    };
  }

  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    // Verify JWT signature + expiration
    let decoded: any;
    try {
      decoded = this.jwtService.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const userId = decoded.sub;

    const storedToken = await this.redis.get(`refresh_token:${userId}`);

    if (!storedToken || storedToken !== refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const newAccessToken = this.jwtService.sign(payload, {
      expiresIn: '1h',
    });

    return {
      success: true,
      message: 'Access token refreshed successfully',
      authorization: {
        type: 'bearer',
        access_token: newAccessToken,
      },
    };
  }

  async revokeRefreshToken(user_id: string) {
    try {
      const storedToken = await this.redis.get(`refresh_token:${user_id}`);
      if (!storedToken) {
        return {
          success: false,
          message: 'Refresh token not found',
        };
      }

      await this.redis.del(`refresh_token:${user_id}`);

      return {
        success: true,
        message: 'Refresh token revoked successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async validateUser(
    email: string,
    pass: string,
    token?: string,
  ): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(pass, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { password, ...result } = user;

    return result;
  }

  async registerUser(payload: CreateUserDto) {
    const { email, password, username, role } = payload;

    const existingUser = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(
      password,
      appConfig().security.salt,
    );

    const newUser = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: username,
        status: UserStatus.DEACTIVATED,
        role,
      },
    });

    return {
      success: true,
      message: 'User registered successfully',
      data: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
      },
    };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
    const hashedOtp = await bcrypt.hash(otp, 10);

    await this.prisma.user.update({
      where: { email },
      data: {
        password_reset_otp: hashedOtp,
        password_reset_otp_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        password_reset_token: null,
        password_reset_verified_at: null,
      },
    });

    console.log(otp)

    await this.mailService.sendOtpCodeToEmail({
      email: user.email,
      name: user.name,
      otp,
    });

    return {
      success: true,
      message: 'Otp code sent to your email address.',
      data: {
        otp,
      },
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (
      !user ||
      !user.password_reset_token ||
      !user.password_reset_expires_at
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Must have gone through OTP verification
    if (!user.password_reset_verified_at) {
      throw new ForbiddenException(
        'OTP verification required before resetting password',
      );
    }

    // Check token expiry
    if (new Date() > user.password_reset_expires_at) {
      throw new BadRequestException(
        'Reset token has expired. Please start over.',
      );
    }

    // Validate reset token
    const isMatch = await bcrypt.compare(
      dto.reset_token,
      user.password_reset_token,
    );
    if (!isMatch) {
      throw new BadRequestException('Invalid reset token');
    }

    const hashedPassword = await bcrypt.hash(dto.new_password, 10);

    await this.prisma.user.update({
      where: { email: dto.email },
      data: {
        password: hashedPassword,
        // Clear all reset fields
        password_reset_token: null,
        password_reset_expires_at: null,
        password_reset_verified_at: null,
      },
    });

    return { success: true, message: 'Password reset successfully' };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (
      !user ||
      !user.password_reset_otp ||
      !user.password_reset_otp_expires_at
    ) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Check expiry
    if (new Date() > user.password_reset_otp_expires_at) {
      throw new BadRequestException(
        'OTP has expired. Please request a new one.',
      );
    }

    // Check OTP match
    const isMatch = await bcrypt.compare(dto.otp, user.password_reset_otp);
    if (!isMatch) {
      throw new BadRequestException('Invalid OTP');
    }

    // OTP is valid — generate a short-lived reset token
    const resetToken = crypto.randomUUID();
    const hashedResetToken = await bcrypt.hash(resetToken, 10);

    await this.prisma.user.update({
      where: { email: dto.email },
      data: {
        password_reset_token: hashedResetToken,
        password_reset_expires_at: new Date(Date.now() + 15 * 60 * 1000), // 15 min
        password_reset_verified_at: new Date(), // mark OTP as verified
        password_reset_otp: null, // clear OTP — one use only
        password_reset_otp_expires_at: null,
      },
    });

    // Return plain token to frontend — frontend sends this on reset
    return {
      success: true,
      message: 'OTP verified',
      data: { reset_token: resetToken },
    };
  }

  async resendVerificationEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('User is not active');
    }

    // Generate OTP (6 digits)
    const token = Math.floor(100000 + Math.random() * 900000).toString();

    // Store token in Redis (10 minutes)
    await this.redis.set(`email_verify:${user.id}`, token, 'EX', 600);

    await this.mailService.sendOtpCodeToEmail({
      email: user.email,
      name: user.name,
      otp: token,
    });

    return {
      success: true,
      message: 'Verification email sent to your email address.',
    };
  }

  async changePassword({ user_id, oldPassword, newPassword }) {
    // try {
    //   const user = await this.userRepository.getUserDetails(user_id);
    //   if (user) {
    //     const _isValidPassword = await this.userRepository.validatePassword({
    //       email: user.email,
    //       password: oldPassword,
    //     });
    //     if (_isValidPassword) {
    //       await this.userRepository.changePassword({
    //         email: user.email,
    //         password: newPassword,
    //       });
    //       return {
    //         success: true,
    //         message: 'Password updated successfully',
    //       };
    //     } else {
    //       return {
    //         success: false,
    //         message: 'Invalid password',
    //       };
    //     }
    //   } else {
    //     return {
    //       success: false,
    //       message: 'Email not found',
    //     };
    //   }
    // } catch (error) {
    //   return {
    //     success: false,
    //     message: error.message,
    //   };
    // }
  }
}
