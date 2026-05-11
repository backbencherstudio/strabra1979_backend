import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { LocalChunkUploadService } from './local-chunk-upload.service';
import { MinioMultipartService } from './minio-multipart.service';
import { MinioClientProvider } from './providers/minio-client.provider';

@Module({
  controllers: [UploadController],
  providers: [
    LocalChunkUploadService,
    MinioMultipartService,
    MinioClientProvider,
  ],
  exports: [LocalChunkUploadService, MinioMultipartService],
})
export class UploadModule {}
