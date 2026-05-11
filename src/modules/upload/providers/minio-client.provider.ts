import { Provider } from '@nestjs/common';
import * as AWS from 'aws-sdk';
import appConfig from 'src/config/app.config';

export const MINIO_CLIENT = 'MINIO_CLIENT';
export const MINIO_PUBLIC_CLIENT = 'MINIO_PUBLIC_CLIENT';

// Internal client (for backend operations)
export const MinioClientProvider: Provider = {
  provide: MINIO_CLIENT,
  useFactory: () => {
    const config = appConfig();
    const isDevelopment = config.app.node_env === 'development';

    // For development: use local IP
    // For production: use localhost (internal)
    const endpoint = isDevelopment
      ? appConfig().fileSystems.s3.endpoint || 'http://192.168.7.68:9005'
      : appConfig().fileSystems.s3.publicEndpoint ||
        'https://backend.roofwellnesshub.com';

    const s3Config: AWS.S3.ClientConfiguration = {
      endpoint,
      region: config.fileSystems.s3.region || 'us-east-1',
      credentials: {
        accessKeyId: config.fileSystems.s3.key || 'minioadmin',
        secretAccessKey: config.fileSystems.s3.secret || 'minioadmin',
      },
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
      httpOptions: {
        timeout: 300000,
      },
    };

    console.log(
      `[MinIO Internal] Environment: ${config.app.node_env}, Endpoint: ${endpoint}`,
    );
    return new AWS.S3(s3Config);
  },
};

// Public client (for presigned URLs)
export const MinioPublicClientProvider: Provider = {
  provide: MINIO_PUBLIC_CLIENT,
  useFactory: () => {
    const config = appConfig();
    const isDevelopment = config.app.node_env === 'development';

    // For development: use local IP
    // For production: use localhost (internal)
    const endpoint = isDevelopment
      ? appConfig().fileSystems.s3.endpoint || 'http://192.168.7.68:9005'
      : appConfig().fileSystems.s3.publicEndpoint ||
        'https://backend.roofwellnesshub.com';

    const s3Config: AWS.S3.ClientConfiguration = {
      endpoint,
      region: config.fileSystems.s3.region || 'us-east-1',
      credentials: {
        accessKeyId: config.fileSystems.s3.key || 'minioadmin',
        secretAccessKey: config.fileSystems.s3.secret || 'minioadmin',
      },
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
      httpOptions: {
        timeout: 300000,
      },
    };

    console.log(
      `[MinIO Public] Environment: ${config.app.node_env}, Endpoint: ${endpoint}`,
    );
    return new AWS.S3(s3Config);
  },
};
