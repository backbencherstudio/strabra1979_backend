import helmet from 'helmet';

export const helmetConfig = () => {
  return helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        connectSrc: [`'self'`, `https:`, `wss:`],
        scriptSrc: [`'self'`, `'unsafe-inline'`, `'unsafe-eval'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, `data:`, `https:`, `http:`],
        workerSrc: [`'self'`, `blob:`],
        frameSrc: [`'self'`],
        fontSrc: [`'self'`, `data:`],
        objectSrc: [`'none'`],
        mediaSrc: [`'self'`],
        frameAncestors: [`'none'`],
        baseUri: [`'self'`],
        formAction: [`'self'`],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    ieNoOpen: true,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
    originAgentCluster: true,
  });
};
