export interface UploadSessionResponse {
  sessionId: string;
  uploadId?: string;
  objectKey?: string;
  chunkSize?: number;
}

export interface PresignedUrlResponse {
  partNumber: number;
  url: string;
}

export interface CompleteUploadResponse {
  success: boolean;
  location: string;
  key: string;
  url: string;
  fileName: string;
  fileSize: number;
}

export interface UploadStatusResponse {
  status: string;
  uploadedParts: number;
  totalParts: number;
  progress: number;
  fileName: string;
  fileSize: number;
}

export interface PartETag {
  partNumber: number;
  eTag: string;
}
