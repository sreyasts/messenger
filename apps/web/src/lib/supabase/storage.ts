// apps/web/src/lib/supabase/storage.ts
import { supabase, isLiveSupabaseConfigured } from '@/lib/supabase/client';
import { MediaType } from '@/types/database';

export const MAX_SUPABASE_STORAGE_BYTES = 50 * 1024 * 1024; // 50 MB (52,428,800 bytes)
export const MAX_P2P_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB (1,073,741,824 bytes)

const EXTENSION_MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function sanitizeFileName(rawName: string): string {
  const base = (rawName || 'attachment').split(/[/\\]/).pop() || 'attachment';
  const lastDot = base.lastIndexOf('.');
  const stem = lastDot > 0 ? base.slice(0, lastDot) : base;
  const ext = lastDot > 0 ? base.slice(lastDot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';

  const cleanStem = stem
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 80) || 'file';

  return ext ? `${cleanStem}.${ext}` : cleanStem;
}

export function inferMimeType(fileName: string, providedType?: string): string {
  const trimmed = (providedType || '').trim().toLowerCase();
  if (trimmed && trimmed !== 'application/octet-stream') {
    return trimmed;
  }
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MIME_MAP[ext] || trimmed || 'application/octet-stream';
}

export function resolveMediaType(fileName: string, mimeType?: string): MediaType {
  const mime = inferMimeType(fileName, mimeType);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${idx === 0 ? value : value.toFixed(1)} ${units[idx]}`;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file into memory'));
    reader.readAsDataURL(blob);
  });
}

function uploadWithProgressXhr(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const pct = Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 100)));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          message = parsed?.message || parsed?.error || message;
        } catch {}
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during file upload'));
    xhr.onabort = () => reject(new Error('File upload cancelled'));
    xhr.send(file);
  });
}

export interface UploadResult {
  publicUrl: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export async function uploadToSupabaseBucket(
  bucket: 'chat-attachments' | 'avatars' | 'stickers' | 'wallpapers',
  file: File | Blob,
  options: {
    folder: string;
    fileName: string;
    mimeType?: string;
    maxBytes?: number;
    onProgress?: (pct: number) => void;
  }
): Promise<UploadResult> {
  const safeName = sanitizeFileName(options.fileName);
  const mimeType = inferMimeType(safeName, options.mimeType || (file instanceof File ? file.type : undefined));
  const maxBytes = options.maxBytes ?? MAX_SUPABASE_STORAGE_BYTES;

  if (file.size > maxBytes) {
    throw new Error(`File exceeds the ${formatFileSize(maxBytes)} bucket limit.`);
  }

  const uniqueId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  const cleanFolder = options.folder.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9/_-]/g, '_');
  const storagePath = `${cleanFolder}/${Date.now()}_${uniqueId}_${safeName}`;

  if (!isLiveSupabaseConfigured()) {
    options.onProgress?.(35);
    let url: string;
    if (file.size <= 4 * 1024 * 1024) {
      url = await readAsDataUrl(file);
    } else {
      url = URL.createObjectURL(file);
    }
    options.onProgress?.(100);
    return {
      publicUrl: url,
      storagePath,
      fileName: safeName,
      mimeType,
      fileSize: file.size,
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (accessToken && typeof XMLHttpRequest !== 'undefined') {
    const encodedPath = storagePath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const uploadEndpoint = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encodedPath}`;

    try {
      await uploadWithProgressXhr(
        uploadEndpoint,
        file,
        {
          Authorization: `Bearer ${accessToken}`,
          apikey: supabaseAnonKey,
          'Content-Type': mimeType,
          'x-upsert': 'false',
        },
        options.onProgress
      );
    } catch (xhrErr) {
      // Fallback to official SDK upload if XHR hits an unexpected edge
      const { error: sdkError } = await supabase.storage.from(bucket).upload(storagePath, file, {
        contentType: mimeType,
        upsert: false,
      });
      if (sdkError) {
        throw new Error(sdkError.message || (xhrErr instanceof Error ? xhrErr.message : 'Upload failed'));
      }
      options.onProgress?.(100);
    }
  } else {
    const { error: sdkError } = await supabase.storage.from(bucket).upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });
    if (sdkError) {
      throw new Error(sdkError.message || 'Failed to upload file to storage');
    }
    options.onProgress?.(100);
  }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  if (!urlData?.publicUrl) {
    throw new Error('Could not resolve public storage URL after upload');
  }

  return {
    publicUrl: urlData.publicUrl,
    storagePath,
    fileName: safeName,
    mimeType,
    fileSize: file.size,
  };
}

export async function downloadFileUrl(url: string, fileName?: string): Promise<void> {
  if (!url) return;
  const targetName = sanitizeFileName(fileName || 'download');

  // Direct download for data: and blob: URLs
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = targetName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  // For remote URLs (including cross-origin Supabase Storage), fetch as Blob so `download` filename is honored
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = targetName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  } catch {
    // Fallback to Supabase download query param or direct tab open
    const separator = url.includes('?') ? '&' : '?';
    const downloadUrl = url.includes('/storage/v1/object/')
      ? `${url}${separator}download=${encodeURIComponent(targetName)}`
      : url;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = targetName;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
