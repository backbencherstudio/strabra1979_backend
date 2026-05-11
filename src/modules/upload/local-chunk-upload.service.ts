import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UploadStatus } from 'prisma/generated/enums';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream, createReadStream } from 'fs';
import { v4 as uuid } from 'uuid';

@Injectable()
export class LocalChunkUploadService {
  private tempDir = path.join(process.cwd(), 'temp', 'chunks');
  private publicDir = path.join(process.cwd(), 'public', 'storage');

  constructor(private prisma: PrismaService) {
    // ensure directories exist
    this.ensureDirectories();
  }

  private async ensureDirectories() {
    await fs.mkdir(this.tempDir, { recursive: true });
    await fs.mkdir(this.publicDir, { recursive: true });
  }

  async initiateUpload(
    userId: string,
    fileName: string,
    mimeType: string,
    fileSize: number,
  ) {
    const sessionId = uuid();
    const sessionDir = path.join(this.tempDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const session = await this.prisma.uploadSession.create({
      data: {
        id: sessionId,
        userId,
        fileName,
        fileSize,
        mimeType,
        key: sessionDir,
        uploadId: sessionId,
        partETags: [],
        status: UploadStatus.PENDING,
        expiresAt,
      },
    });
    return session;
  }

  async uploadPart(sessionId: string, partNumber: number, chunkBuffer: Buffer) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Upload session not found');
    if (session.status !== UploadStatus.PENDING)
      throw new BadRequestException('Upload already completed or aborted');

    const partPath = path.join(session.key, `part_${partNumber}`);
    await fs.writeFile(partPath, chunkBuffer);

    const partETags = (session.partETags as any[]) || [];
    partETags.push({ partNumber, eTag: `part_${partNumber}` });
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { partETags },
    });
    return { partNumber };
  }

  async completeUpload(sessionId: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== UploadStatus.PENDING)
      throw new BadRequestException('Upload already completed');

    const partFiles = await fs.readdir(session.key);
    const sortedParts = partFiles
      .filter((f) => f.startsWith('part_'))
      .sort((a, b) => {
        const numA = parseInt(a.split('_')[1], 10);
        const numB = parseInt(b.split('_')[1], 10);
        return numA - numB;
      });

    if (sortedParts.length === 0) {
      throw new BadRequestException('No parts uploaded');
    }

    const finalFileName = `${Date.now()}_${session.fileName.replace(/\s/g, '_')}`;
    const finalDir = path.join(this.publicDir, 'inspections');
    await fs.mkdir(finalDir, { recursive: true });
    const finalPath = path.join(finalDir, finalFileName);

    // Merge parts using streams
    const writeStream = createWriteStream(finalPath);

    for (const partFile of sortedParts) {
      const partPath = path.join(session.key, partFile);
      const readStream = createReadStream(partPath);

      await new Promise<void>((resolve, reject) => {
        readStream.pipe(writeStream, { end: false });
        readStream.on('end', () => resolve());
        readStream.on('error', reject);
      });

      await fs.unlink(partPath);
    }

    writeStream.end();
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
    });

    await fs.rmdir(session.key);

    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadStatus.COMPLETED },
    });

    const url = `/public/storage/inspections/${finalFileName}`;
    return {
      location: url,
      key: finalPath,
      url,
    };
  }

  async abortUpload(sessionId: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return;
    try {
      await fs.rm(session.key, { recursive: true, force: true });
    } catch (e) {}
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadStatus.ABORTED },
    });
  }
}
