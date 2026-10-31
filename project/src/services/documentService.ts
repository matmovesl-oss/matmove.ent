import type { DocumentType, UploadedDocument } from '@/types';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'File is too large. Maximum size is 10 MB.' };
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Unsupported format. Use JPG, PNG, WebP, or PDF.' };
  }
  return { valid: true };
}

export async function uploadKycDocument(
  file: File,
  type: DocumentType,
  onProgress: (progress: number) => void
): Promise<UploadedDocument> {
  const validation = validateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  return new Promise<UploadedDocument>((resolve) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 22 + 8;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        onProgress(100);
        const doc: UploadedDocument = {
          type,
          fileName: file.name,
          fileSize: file.size,
          uploadProgress: 100,
          status: 'uploaded',
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        };
        resolve(doc);
      } else {
        onProgress(Math.round(progress));
      }
    }, 180);
  });
}

export async function deleteKycDocument(_type: DocumentType): Promise<void> {
  await delay(300);
}
