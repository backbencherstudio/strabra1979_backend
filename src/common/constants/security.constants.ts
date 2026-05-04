export const SUSPICIOUS_PATHS = [
  // Version control & config
  /\.env/i,
  /\.git/i,
  /\.ssh/i,
  /\.aws/i,
  /\.docker/i,
  /config\.json/i,
  /credentials\.json/i,
  /secrets\.yml/i,
  /database\.yml/i,
  /settings\.py/i,
  /serverless\.yml/i,

  // Framework specific
  /wp-config/i,
  /wp-includes/i,
  /wp-admin/i,
  /terraform/i,
  /\.well-known/i,

  // Common scan targets
  /robots\.txt/i,
  /favicon\.ico/i,
  /sitemap/i,
  /pip\.conf/i,
  /npmrc/i,
  /yarnrc/i,

  // API documentation (if not wanted)
  /swagger/i,
  /api-docs/i,
  /openapi/i,
  /graphql/i,

  // System files
  /version/i,
  /info/i,
  /status/i,
  /healthz/i,
  /_health/i,

  // Backup files
  /\.bak$/i,
  /\.old$/i,
  /\.backup$/i,
  /~$/i,
];

export const SUSPICIOUS_USER_AGENTS = [
  // Scanning tools
  /nmap/i,
  /sqlmap/i,
  /nikto/i,
  /dirbuster/i,
  /gobuster/i,
  /masscan/i,
  /zgrab/i,
  /nessus/i,
  /openvas/i,
  /burp/i,
  /owasp/i,
  /zap/i,
  /wpscan/i,
  /joomscan/i,

  // Bots (legitimate ones should be allowed)
  /python-requests/i,
  /curl/i,
  /wget/i,
  /httpie/i,
  /Go-http-client/i,
  /Java/i,
  /perl/i,
  /ruby/i,

  // Vulnerability scanners
  /acunetix/i,
  /appscan/i,
  /webinspect/i,
  /netsparker/i,
  /qualys/i,
  /nessus/i,

  // Mass scanners
  /masscan/i,
  /zmap/i,
  /zgrab/i,
];

export const RATE_LIMITS = {
  GENERAL: { windowMs: 15 * 60 * 1000, max: 100 }, // 100 per 15 min
  AUTH: { windowMs: 15 * 60 * 1000, max: 20 }, // 20 per 15 min
  STRICT: { windowMs: 15 * 60 * 1000, max: 5 }, // 5 per 15 min
  RELAXED: { windowMs: 15 * 60 * 1000, max: 30 }, // 30 per 15 min
};

export const CORS_OPTIONS = {
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  maxAge: 86400,
};

export const REQUEST_LIMITS = {
  JSON_SIZE: '10mb',
  TIMEOUT_MS: 30000,
  FILE_SIZE: '50mb',
};
