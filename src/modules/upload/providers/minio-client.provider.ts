import { Provider } from '@nestjs/common';
import * as AWS from 'aws-sdk';
import appConfig from 'src/config/app.config';

export const MINIO_CLIENT = 'MINIO_CLIENT';

export const MinioClientProvider: Provider = {
  provide: MINIO_CLIENT,
  useFactory: () => {
    const config = appConfig();

    const s3Config: AWS.S3.ClientConfiguration = {
      endpoint: config.fileSystems.s3.endpoint,
      region: config.fileSystems.s3.region || 'us-east-1',
      credentials: {
        accessKeyId: config.fileSystems.s3.key || 'minioadmin',
        secretAccessKey: config.fileSystems.s3.secret || 'minioadmin',
      },
      s3ForcePathStyle: true, // ✅ Important for MinIO
      signatureVersion: 'v4',
      httpOptions: {
        timeout: 300000, // 5 minutes timeout for large files
      },
    };

    return new AWS.S3(s3Config);
  },
};
