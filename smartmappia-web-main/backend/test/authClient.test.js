const test = require('node:test');
const assert = require('node:assert/strict');
const { authClient } = require('../lib/authClient');

function withoutWebSocket(t) {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    socket: Object.getOwnPropertyDescriptor(globalThis, 'WebSocket'),
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: undefined });
  t.after(() => {
    for (const [name, value] of [['SUPABASE_URL', previous.url], ['SUPABASE_SERVICE_ROLE_KEY', previous.key]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (previous.socket) Object.defineProperty(globalThis, 'WebSocket', previous.socket);
    else delete globalThis.WebSocket;
  });
}

test('password login reaches Auth over HTTP without WebSocket support', async (t) => {
  withoutWebSocket(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ message: 'Invalid login credentials', error_code: 'invalid_credentials' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  });

  const { error } = await authClient().auth.signInWithPassword({ email: 'test@example.com', password: 'test-password' });
  assert.equal(error.status, 400);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.apikey, 'test-service-key');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-service-key');
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test('password recovery preserves the PKCE verifier between HTTP clients', async (t) => {
  withoutWebSocket(t);
  const values = {};
  const storage = {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
    removeItem: (key) => { delete values[key]; },
  };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const { error } = await authClient(storage).auth.resetPasswordForEmail('test@example.com', {
    redirectTo: 'https://example.com/reset-password',
  });
  assert.equal(error, null);
  const verifier = JSON.parse(values['sb-example-auth-token-code-verifier']);
  assert.ok(verifier);
  assert.ok(requests[0].body.code_challenge);
  await authClient(storage).auth.exchangeCodeForSession('test-code');
  assert.equal(requests[1].url, 'https://example.supabase.co/auth/v1/token?grant_type=pkce');
  assert.equal(requests[1].body.auth_code, 'test-code');
  assert.equal(requests[1].body.code_verifier, verifier.split('/')[0]);
});
