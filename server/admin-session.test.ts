import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminSession, verifyAdminSession } from './admin-session.js';

test('assina e valida sessão administrativa com prazo de expiração', () => {
  const previousUsername = process.env.ADMIN_USERNAME;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.ADMIN_USERNAME = 'test-admin';
  process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';

  try {
    const token = createAdminSession('test-admin');
    assert.equal(verifyAdminSession(token), true);
    assert.equal(verifyAdminSession(`${token}invalid`), false);
    process.env.ADMIN_USERNAME = 'another-admin';
    assert.equal(verifyAdminSession(token), false);
  } finally {
    if (previousUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = previousUsername;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
