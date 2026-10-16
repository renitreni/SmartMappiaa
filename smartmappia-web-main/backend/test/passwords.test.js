require('./helpers/pureEnv');
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../lib/passwords');

test('password hashes use independent salts and verify the right password', async () => {
  const [first, second] = await Promise.all([hashPassword('correct horse battery'), hashPassword('correct horse battery')]);
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse battery', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
});

test('password verification rejects malformed and excessive work factors', async () => {
  assert.equal(await verifyPassword('password', 'legacy-hash'), false);
  assert.equal(await verifyPassword('password', 'scrypt$262144$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), false);
});
