import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventMediaUpload, isEventMediaType } from './event-media.js';
import { HttpError } from './errors.js';

test('aceita somente formatos de mídia permitidos e rejeita arquivos acima do limite', async () => {
  assert.equal(isEventMediaType('image/png'), true);
  assert.equal(isEventMediaType('video/mp4'), true);
  assert.equal(isEventMediaType('application/pdf'), false);
  await assert.rejects(
    createEventMediaUpload('video/mp4', 50 * 1024 * 1024 + 1),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
});

test('gera URL temporária de upload no bucket de mídia', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  let requestUrl = '';

  globalThis.fetch = async (input) => {
    requestUrl = String(input);
    return Response.json({ token: 'temporary-token' });
  };

  try {
    const upload = await createEventMediaUpload('image/png', 1024);
    assert.match(requestUrl, /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/upload\/sign\/event-media\/[0-9a-f-]{36}\.png$/);
    assert.match(upload.uploadUrl, /\?token=temporary-token$/);
    assert.match(upload.objectPath, /^[0-9a-f-]{36}\.png$/);
    assert.equal(upload.mediaType, 'image/png');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
