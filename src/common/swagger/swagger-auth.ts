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
  },
};