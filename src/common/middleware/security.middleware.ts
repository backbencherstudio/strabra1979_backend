import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  SUSPICIOUS_PATHS,
  SUSPICIOUS_USER_AGENTS,
} from '../constants/security.constants';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const path = req.path;
    const userAgent = req.headers['user-agent'] || '';
    const ip =
      req.ip ||
      req.socket.remoteAddress ||
      (req.headers['x-forwarded-for'] as string);

    // 1. Block suspicious paths (config files, git, ssh, etc.)
    if (SUSPICIOUS_PATHS.some((pattern) => pattern.test(path))) {
      console.log(
        `🔒 Security: Blocked suspicious path - ${req.method} ${path} from ${ip}`,
      );
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Block suspicious user agents (scanners, bots, etc.)
    if (SUSPICIOUS_USER_AGENTS.some((pattern) => pattern.test(userAgent))) {
      console.log(
        `🔒 Security: Blocked suspicious user-agent - ${userAgent} from ${ip}`,
      );
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Block common HTTP methods abuse
    const dangerousMethods = ['TRACE', 'TRACK', 'DELETE', 'CONNECT'];
    if (dangerousMethods.includes(req.method) && !req.path.startsWith('/api')) {
      console.log(
        `🔒 Security: Blocked dangerous method - ${req.method} ${path} from ${ip}`,
      );
      return res.status(405).json({
        success: false,
        message: 'Method not allowed',
      });
    }

    // 4. Add security headers (additional to Helmet)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private',
    );
    res.setHeader('Pragma', 'no-cache');

    // 5. Log suspicious patterns (without blocking)
    const suspiciousPatterns = [
      /\%[0-9a-fA-F]{2}/, // URL encoded characters
      /\.\.\//, // Directory traversal
      /union.*select/i, // SQL injection patterns
      /<script/i, // XSS patterns
    ];

    if (suspiciousPatterns.some((pattern) => pattern.test(path))) {
      console.log(
        `⚠️ Security: Suspicious pattern detected - ${req.method} ${path} from ${ip}`,
      );
      // Log but don't block (could be false positive)
    }

    next();
  }
}
