import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UploadStatus } from 'prisma/generated/enums';
import { v4 as uuid } from 'uuid';
import * as AWS from 'aws-sdk';
import {
  MINIO_CLIENT,
  MINIO_PUBLIC_CLIENT,
} from './providers/minio-client.provider';
import appConfig from 'src/config/app.config';

@Injectable()
export class MinioMultipartService {
  private bucketName: string;
  private readonly CHUNK_SIZE = 10 * 1024 * 1024; // 10MB default chunk size

  constructor(
    @Inject(MINIO_CLIENT) private readonly s3Client: AWS.S3,
    @Inject(MINIO_PUBLIC_CLIENT) private readonly s3Public: AWS.S3,
    private readonly prisma: PrismaService,
  ) {
    this.bucketName = appConfig().fileSystems.s3.bucket || 'your-bucket';
    this.ensureBucket();
  }

  private async ensureBucket() {
    try {
      const buckets = await this.s3Client.listBuckets().promise();
      const bucketExists = buckets.Buckets?.some(
        (b) => b.Name === this.bucketName,
      );
      if (!bucketExists) {
        await this.s3Client.createBucket({ Bucket: this.bucketName }).promise();
        console.log(`Bucket ${this.bucketName} created successfully`);
      }
    } catch (error) {
      console.error('Error ensuring bucket:', error);
    }
  }

  async initiateUpload(
    userId: string,
    fileName: string,
    mimeType: string,
    fileSize: number,
  ) {
    const objectKey = `inspections/${userId}/${Date.now()}_${fileName.replace(/\s/g, '_')}`;

    const params: AWS.S3.CreateMultipartUploadRequest = {
      Bucket: this.bucketName,
      Key: objectKey,
      ContentType: mimeType,
      Metadata: {
        'original-name': fileName,
        'user-id': userId,
        'uploaded-at': new Date().toISOString(),
      },
    };

    const response = await this.s3Client
      .createMultipartUpload(params)
      .promise();
    const uploadId = response.UploadId;

    if (!uploadId) {
      throw new BadRequestException('Failed to initiate multipart upload');
    }

    const sessionId = uuid();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const session = await this.prisma.uploadSession.create({
      data: {
        id: sessionId,
        userId,
        fileName,
        fileSize,
        mimeType,
        key: objectKey,
        uploadId: uploadId,
        partETags: [],
        status: UploadStatus.PENDING,
        expiresAt,
      },
    });

    return {
      sessionId: session.id,
      uploadId,
      objectKey,
      chunkSize: this.CHUNK_SIZE,
    };
  }

  async getPresignedUrl(
    sessionId: string,
    partNumber: number,
  ): Promise<string> {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== UploadStatus.PENDING) {
      throw new BadRequestException('Upload already completed or aborted');
    }

    const params = {
      Bucket: this.bucketName,
      Key: session.key,
      UploadId: session.uploadId,
      PartNumber: partNumber,
    };

    let url = await this.s3Public.getSignedUrlPromise('uploadPart', {
      ...params,
      Expires: 3600,
    });

    // Replace production URL with development URL
    const isDevelopment = appConfig().app.node_env === 'development';
    if (isDevelopment) {
      url = url.replace(
        'https://backend.roofwellnesshub.com',
        appConfig().fileSystems.s3.endpoint || 'http://192.168.7.68:9005',
      );
    }

    return url;
  }

  async getMultiplePresignedUrls(
    sessionId: string,
    partNumbers: number[],
  ): Promise<{ partNumber: number; url: string }[]> {
    const urls = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.getPresignedUrl(sessionId, partNumber),
      })),
    );
    return urls;
  }

  async savePartETag(sessionId: string, partNumber: number, eTag: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new NotFoundException('Session not found');

    const partETags = (session.partETags as any[]) || [];
    const existingIndex = partETags.findIndex(
      (p) => p.partNumber === partNumber,
    );

    if (existingIndex >= 0) {
      partETags[existingIndex] = { partNumber, eTag };
    } else {
      partETags.push({ partNumber, eTag });
    }

    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { partETags },
    });

    return { success: true };
  }

  async completeUpload(sessionId: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== UploadStatus.PENDING) {
      throw new BadRequestException('Upload already completed or aborted');
    }

    const parts = (session.partETags as any[])
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => ({
        PartNumber: part.partNumber,
        ETag: part.eTag,
      }));

    if (parts.length === 0) {
      throw new BadRequestException('No parts uploaded');
    }

    const params: AWS.S3.CompleteMultipartUploadRequest = {
      Bucket: this.bucketName,
      Key: session.key,
      UploadId: session.uploadId,
      MultipartUpload: {
        Parts: parts,
      },
    };

    await this.s3Client.completeMultipartUpload(params).promise();

    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadStatus.COMPLETED },
    });

    // Determine the correct public endpoint based on environment
    const isDevelopment = appConfig().app.node_env === 'development';
    let publicEndpoint: string;

    if (isDevelopment) {
      publicEndpoint =
        appConfig().fileSystems.s3.endpoint || 'http://192.168.7.68:9005';
    } else {
      publicEndpoint =
        appConfig().fileSystems.s3.publicEndpoint ||
        'https://backend.roofwellnesshub.com';
    }

    // Construct the final URL
    const url = `${publicEndpoint}/${this.bucketName}/${session.key}`;

    return {
      location: url,
      key: session.key,
      url,
      fileName: session.fileName,
      fileSize: session.fileSize,
    };
  }

  async abortUpload(sessionId: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) return { message: 'Session not found' };
    if (session.status !== UploadStatus.PENDING) {
      return { message: 'Upload already completed or aborted' };
    }

    try {
      const params: AWS.S3.AbortMultipartUploadRequest = {
        Bucket: this.bucketName,
        Key: session.key,
        UploadId: session.uploadId,
      };

      await this.s3Client.abortMultipartUpload(params).promise();
    } catch (error) {
      console.error('Error aborting upload:', error);
    }

    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadStatus.ABORTED },
    });

    return { message: 'Upload aborted successfully' };
  }

  async getUploadStatus(sessionId: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new NotFoundException('Session not found');

    const uploadedParts = (session.partETags as any[]).length;
    const totalParts = Math.ceil(session.fileSize / this.CHUNK_SIZE);

    return {
      status: session.status,
      uploadedParts,
      totalParts,
      progress: totalParts > 0 ? (uploadedParts / totalParts) * 100 : 0,
      fileName: session.fileName,
      fileSize: session.fileSize,
    };
  }

  async listUploadedParts(sessionId: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new NotFoundException('Session not found');

    try {
      const params: AWS.S3.ListPartsRequest = {
        Bucket: this.bucketName,
        Key: session.key,
        UploadId: session.uploadId,
      };

      const response = await this.s3Client.listParts(params).promise();
      return response.Parts || [];
    } catch (error) {
      console.error('Error listing parts:', error);
      return [];
    }
  }
}
