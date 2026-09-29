const test = require('node:test');
const assert = require('node:assert');

process.env.SESSION_ENCRYPTION_KEY ||= 'test-only-session-key-not-for-production';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role';

const { uploadGrant, verifyGrant } = require('../lib/fileGrants');

test('an upload grant preserves only its allowed operation and limits', () => {
  const token = uploadGrant('payment-proofs', 'SM-1/proof.jpg', {
    maxBytes: 123,
    allowedMimeTypes: ['image/jpeg'],
    ttlSeconds: 60,
  });
  const grant = verifyGrant(token, 'upload');
  assert.strictEqual(grant.bucket, 'payment-proofs');
  assert.strictEqual(grant.path, 'SM-1/proof.jpg');
  assert.strictEqual(grant.maxBytes, 123);
  assert.deepStrictEqual(grant.allowedMimeTypes, ['image/jpeg']);
  assert.throws(() => verifyGrant(token, 'download'));
});

test('a modified upload grant is rejected', () => {
  const token = uploadGrant('avatars', 'user/avatar.jpg', {
    maxBytes: 123,
    allowedMimeTypes: ['image/jpeg'],
    ttlSeconds: 60,
  });
  const [body, signature] = token.split('.');
  const changed = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}.${signature}`;
  assert.throws(() => verifyGrant(changed, 'upload'));
});
