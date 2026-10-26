import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';
import type { EventMediaType } from './types.js';

const bucket = 'event-media';
const maxFileSize = 50 * 1024 * 1024;

const fileExtensions: Record<EventMediaType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

interface StorageConfig {
  baseUrl: string;
  serviceRoleKey: string;
}

function storageConfig(): StorageConfig {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(503, 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para enviar mídias.');
  }
  let baseUrl: string;
  try {
    baseUrl = new URL(url).origin;
  } catch {
    throw new HttpError(500, 'SUPABASE_URL não é uma URL válida.');
  }
  return { baseUrl, serviceRoleKey };
}

function storageHeaders(config: StorageConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };
}

function publicMediaUrl(baseUrl: string, objectPath: string): string {
  return `${baseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
}

export function isEventMediaType(value: unknown): value is EventMediaType {
  return typeof value === 'string' && Object.hasOwn(fileExtensions, value);
}

export async function createEventMediaUpload(mediaType: EventMediaType, fileSize: number) {
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > maxFileSize) {
    throw new HttpError(400, 'O arquivo deve ter até 50 MB.');
  }
  const config = storageConfig();
  const objectPath = `${randomUUID()}.${fileExtensions[mediaType]}`;
  const signedUrlResponse = await fetch(
    `${config.baseUrl}/storage/v1/object/upload/sign/${bucket}/${objectPath}`,
    {
      method: 'POST',
      headers: { ...storageHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({ upsert: false }),
    },
  );
  if (!signedUrlResponse.ok) {
    throw new HttpError(502, 'Não foi possível preparar o envio da mídia ao Supabase Storage.');
  }
  const signedUrlData: unknown = await signedUrlResponse.json();
  if (typeof signedUrlData !== 'object' || signedUrlData === null || !('token' in signedUrlData) || typeof signedUrlData.token !== 'string') {
    throw new HttpError(502, 'O Supabase Storage retornou uma URL temporária inválida.');
  }
  const uploadUrl = `${config.baseUrl}/storage/v1/object/upload/sign/${bucket}/${objectPath}?token=${encodeURIComponent(signedUrlData.token)}`;
  return { uploadUrl, objectPath, mediaType };
}

export async function verifyUploadedEventMedia(objectPath: unknown): Promise<{ mediaPath: string; mediaType: EventMediaType }> {
  if (typeof objectPath !== 'string') throw new HttpError(400, 'Arquivo de mídia inválido.');
  const extension = objectPath.match(/^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$/i)?.[1]?.toLowerCase();
  const mediaType = extension
    ? Object.entries(fileExtensions).find(([, value]) => value === extension)?.[0]
    : undefined;
  if (!mediaType || !isEventMediaType(mediaType)) throw new HttpError(400, 'Arquivo de mídia inválido.');

  const config = storageConfig();
  const verification = await fetch(publicMediaUrl(config.baseUrl, objectPath), { method: 'HEAD' });
  if (!verification.ok) throw new HttpError(400, 'O arquivo enviado não foi encontrado no Supabase Storage.');
  if (verification.headers.get('content-type')?.split(';')[0] !== mediaType) {
    throw new HttpError(400, 'O tipo do arquivo enviado não corresponde ao formato esperado.');
  }
  const fileSize = Number(verification.headers.get('content-length'));
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > maxFileSize) {
    throw new HttpError(400, 'O arquivo deve ter até 50 MB.');
  }
  return { mediaPath: objectPath, mediaType };
}

export function getPublicEventMediaUrl(objectPath: string): string {
  const { baseUrl } = storageConfig();
  return publicMediaUrl(baseUrl, objectPath);
}
