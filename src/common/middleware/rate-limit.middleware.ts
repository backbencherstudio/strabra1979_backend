import rateLimit from 'express-rate-limit';
import { RATE_LIMITS } from '../constants/security.constants';

export const createRateLimiter = (
  type: keyof typeof RATE_LIMITS,
  customConfig?: any,
) => {
  const config = RATE_LIMITS[type];

  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: {
      statusCode: 429,
      message: 'Too many requests, please try again later.',
      error: 'Too Many Requests',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    skip: (req) => {
      // Whitelist health check endpoints
      return req.path.includes('/health') || req.path.includes('/docs');
    },
    ...customConfig,
  });
};
