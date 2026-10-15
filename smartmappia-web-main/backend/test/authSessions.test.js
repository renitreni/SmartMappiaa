require('./helpers/pureEnv');
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SESSION_SQLITE_PATH = ':memory:';
process.env.SESSION_ENCRYPTION_KEY = 'test-encryption-key';
const { getAuthStore } = require('../lib/authStore');
const { supabase } = require('../lib/supabase');
const { AuthClient } = require('@supabase/auth-js');
const sessions = require('../lib/appSessions');
const controller = require('../controllers/authController');
const { config } = require('../lib/config');

const user = { id: 'user-a', email: 'test@example.com' };
function req(token, body = {}) {
  return { body, ip: '127.0.0.1', get: (name) => name === 'authorization' ? `Bearer ${token}` : 'test-agent' };
}
function response() {
  return { statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

test('session tokens are hashed, authenticate via Supabase, and are invalid after logout', async (t) => {
  t.mock.method(supabase.auth.admin, 'getUserById', async () => ({ data: { user }, error: null }));
  const session = await sessions.createSession(user, req());
  assert.equal(getAuthStore().getSession(session.token, Date.now()), undefined);
  assert.ok(getAuthStore().getSession(sessions.hashToken(session.token), Date.now()));
  assert.equal((await sessions.findSession(req(session.token))).user.id, user.id);
  await sessions.revokeSession(req(session.token));
  assert.equal(await sessions.findSession(req(session.token)), null);
});

test('recovery exchanges encrypted SQLite state once and revokes sessions on password change', async (t) => {
  t.mock.method(supabase.auth.admin, 'getUserById', async () => ({ data: { user }, error: null }));
  const session = await sessions.createSession(user, req());
  const state = 'test-state';
  getAuthStore().saveResetFlow({ state_hash: sessions.hashToken(state),
    verifier_ciphertext: sessions.encrypt(JSON.stringify({ verifier: 'test-verifier' })),
    expires_at: Date.now() + 60000 });
  t.mock.method(AuthClient.prototype, 'exchangeCodeForSession', async function (code) {
    assert.equal(code, 'test-code');
    assert.equal(await this.storage.getItem('verifier'), 'test-verifier');
    return { data: { user }, error: null };
  });
  const exchange = response();
  await controller.exchangePasswordReset(req(null, { state, code: 'test-code' }), exchange);
  assert.equal(exchange.statusCode, 200);
  assert.ok(exchange.body.ticket);
  const replay = response();
  await controller.exchangePasswordReset(req(null, { state, code: 'test-code' }), replay);
  assert.equal(replay.statusCode, 400);
  const update = t.mock.method(supabase.auth.admin, 'updateUserById', async (id, { password }) => {
    assert.equal(id, user.id);
    assert.equal(password, 'test-new-password');
    return { error: null };
  });
  const body = { ticket: exchange.body.ticket, password: 'test-new-password' };
  const complete = response();
  await controller.completePasswordReset(req(null, body), complete);
  assert.equal(complete.statusCode, 204);
  assert.equal(await sessions.findSession(req(session.token)), null);
  const completeReplay = response();
  await controller.completePasswordReset(req(null, body), completeReplay);
  assert.equal(completeReplay.statusCode, 400);
  assert.equal(update.mock.callCount(), 1);
});

test('recovery request stores encrypted state locally and keeps its public response generic', async (t) => {
  const oldUrl = config.publicUrls.web;
  config.publicUrls.web = 'https://example.com';
  t.after(() => { config.publicUrls.web = oldUrl; });
  t.mock.method(supabase, 'from', () => { throw new Error('Recovery must not query Supabase tables'); });
  let state;
  const reset = t.mock.method(AuthClient.prototype, 'resetPasswordForEmail', async function (email, options) {
    assert.equal(email, user.email);
    state = new URL(options.redirectTo).searchParams.get('state');
    await this.storage.setItem('verifier', 'test-verifier');
    return { error: null };
  });
  const accepted = response();
  await controller.requestPasswordReset(req(null, { email: user.email }), accepted);
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(accepted.body, { accepted: true });
  const flow = getAuthStore().claimResetFlow(sessions.hashToken(state), Date.now());
  assert.ok(flow);
  assert.equal(flow.verifier_ciphertext.includes('test-verifier'), false);
  assert.equal(JSON.parse(sessions.decrypt(flow.verifier_ciphertext)).verifier, 'test-verifier');
  const invalid = response();
  await controller.requestPasswordReset(req(null, { email: 'invalid' }), invalid);
  assert.equal(invalid.statusCode, 202);
  assert.deepEqual(invalid.body, accepted.body);
  assert.equal(reset.mock.callCount(), 1);
});

test.after(() => getAuthStore().close());
