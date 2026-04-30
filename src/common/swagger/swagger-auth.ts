import { DocumentBuilder } from '@nestjs/swagger';
import appConfig from 'src/config/app.config';

export const SWAGGER_AUTH = {
  admin: 'admin-token',
  property_manager: 'property_manager-token',
  authorized_viewer: 'authorized_viewer-token',
  operational: 'operational-token',
} as const;

export type SwaggerAuthKey = keyof typeof SWAGGER_AUTH;

export function buildSwaggerOptions() {
  const builder = new DocumentBuilder()
    .setTitle(`${process.env.APP_NAME} API`)
    .setVersion('1.0')
    .addServer(appConfig().app.url || 'http://localhost:3000');

  Object.values(SWAGGER_AUTH).forEach((name) => {
    builder.addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      name,
    );
  });

  return builder.build();
}

export const swaggerUiOptions = {
  swaggerOptions: {
    persistAuthorization: true,
    defaultModelsExpandDepth: -1,
    filter: true,
    docExpansion: 'none',
    responseInterceptor: function (response: any) {
      try {
        if (response.url && response.url.indexOf('/auth/login') !== -1) {
          if (response.status === 200 || response.status === 201) {
            let data = response.obj || response.body || response.data;
            if (typeof data === 'string') data = JSON.parse(data);

            const payload = data && data.data;
            const token = payload && payload.access_token;
            const role = payload && payload.role;

            if (!token || !role) {
              console.warn('[Swagger] Token or role missing in login response');
              return response;
            }

            const roleKeyMap: Record<string, string> = {
              ADMIN: 'admin-token',
              PROPERTY_MANAGER: 'property_manager-token',
              AUTHORIZED_VIEWER: 'authorized_viewer-token',
              OPERATIONAL: 'operational-token',
            };

            const key = roleKeyMap[role.toUpperCase()];
            if (!key) {
              console.warn('[Swagger] Unknown role:', role);
              return response;
            }

            const ui = (window as any)['ui'];
            if (ui) {
              const authObj: Record<string, any> = {};
              authObj[key] = {
                name: key,
                schema: {
                  type: 'http',
                  scheme: 'bearer',
                  bearerFormat: 'JWT',
                },
                value: token,
              };

              ui.authActions.authorize(authObj);

              // Manually persist in Swagger's expected localStorage format
              try {
                const stored = localStorage.getItem('authorized');
                const parsed = stored ? JSON.parse(stored) : {};
                parsed[key] = authObj[key];
                localStorage.setItem('authorized', JSON.stringify(parsed));
                console.log(
                  '[Swagger] ✅ Auto-authorized + persisted as',
                  role,
                  '→',
                  key,
                );
              } catch (storageErr) {
                console.warn(
                  '[Swagger] Failed to persist to localStorage',
                  storageErr,
                );
              }
            } else {
              console.warn('[Swagger] UI instance not found on window');
            }
          }
        }
      } catch (err) {
        console.error('[Swagger] Auto-auth failed:', err);
      }
      return response;
    },
  },
};
