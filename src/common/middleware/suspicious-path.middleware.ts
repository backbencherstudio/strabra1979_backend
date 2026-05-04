import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  SUSPICIOUS_PATHS,
  SUSPICIOUS_USER_AGENTS,
} from '../constants/security.constants';

@Injectable()
export class SuspiciousPathMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const path = req.path;
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.socket.remoteAddress;

    // Block suspicious paths
    if (SUSPICIOUS_PATHS.some((pattern) => pattern.test(path))) {
      console.log(
        `🔒 Blocked suspicious path: ${req.method} ${path} from ${ip}`,
      );
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Block suspicious user agents
    if (SUSPICIOUS_USER_AGENTS.some((pattern) => pattern.test(userAgent))) {
      console.log(`🔒 Blocked suspicious user-agent: ${userAgent} from ${ip}`);
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    next();
  }
}
