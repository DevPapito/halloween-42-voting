import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

const SESSION_TTL_SECONDS = 12 * 60 * 60;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET deve ter pelo menos 32 caracteres.');
  }
  return secret;
}

function signature(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function createAdminSession(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({ username, expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
  ).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyAdminSession(token: string): boolean {
  const [payload, providedSignature, extra] = token.split('.');
  if (!payload || !providedSignature || extra) return false;

  const expectedSignature = signature(payload);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;

  try {
    const session: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      typeof session !== 'object' ||
      session === null ||
      !('username' in session) ||
      !('expiresAt' in session) ||
      typeof session.username !== 'string' ||
      typeof session.expiresAt !== 'number'
    ) {
      return false;
    }
    return session.username === process.env.ADMIN_USERNAME && session.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function requireSessionConfiguration(): void {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    throw new HttpError(500, 'As credenciais administrativas não estão configuradas no servidor.');
  }
  sessionSecret();
}
