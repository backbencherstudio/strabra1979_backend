import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { LocalChunkUploadService } from './local-chunk-upload.service';
import { MinioMultipartService } from './minio-multipart.service';
import { MinioClientProvider, MinioPublicClientProvider } from './providers/minio-client.provider';

@Module({
  controllers: [UploadController],
  providers: [
    LocalChunkUploadService,
    MinioMultipartService,
    MinioClientProvider,
    MinioPublicClientProvider,
  ],
  exports: [LocalChunkUploadService, MinioMultipartService],
})
export class UploadModule {}
