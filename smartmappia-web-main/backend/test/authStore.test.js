const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openAuthStore } = require('../lib/authStore');

function insert(store, hash = 'hash-a', user = 'user-a', now = 1000, idle = 2000, absolute = 3000) {
  store.insertSession({ token_hash: hash, user_id: user, now, idle_expires_at: idle,
    absolute_expires_at: absolute, user_agent: 'test', ip: null });
}
function memory(t) {
  const store = openAuthStore(':memory:');
  t.after(() => store.close());
  return store;
}

test('sessions reject unknown tokens and both expiry boundaries', (t) => {
  const store = memory(t);
  insert(store);
  assert.equal(store.getSession('unknown', 1001), undefined);
  assert.equal(store.getSession('hash-a', 1999).user_id, 'user-a');
  assert.equal(store.getSession('hash-a', 2000), undefined);
  insert(store, 'absolute', 'user-a', 1000, 4000, 3000);
  assert.equal(store.getSession('absolute', 3000), undefined);
});

test('activity extends idle expiry but never absolute expiry or a revoked session', (t) => {
  const store = memory(t);
  insert(store);
  const row = store.getSession('hash-a', 1500);
  store.touchSession(row.id, 1500, 5000);
  assert.equal(store.getSession('hash-a', 2500).idle_expires_at, 3000);
  store.revokeSession('hash-a', 2500);
  assert.equal(store.touchSession(row.id, 2600, 6000).changes, 0);
  assert.equal(store.getSession('hash-a', 2600), undefined);
  insert(store, 'expired');
  assert.equal(store.touchSession(store.getSession('expired', 1500).id, 2000, 6000).changes, 0);
});

test('logout and password reset revoke only the intended sessions', (t) => {
  const store = memory(t);
  insert(store);
  insert(store, 'hash-b');
  insert(store, 'hash-c', 'user-b');
  store.revokeSession('hash-a', 1500);
  assert.equal(store.getSession('hash-a', 1500), undefined);
  assert.ok(store.getSession('hash-b', 1500));
  store.revokeAll('user-a', 1500);
  assert.equal(store.getSession('hash-b', 1500), undefined);
  assert.ok(store.getSession('hash-c', 1500));
});

test('sessions and recovery state survive reopening; claims are single-use across connections', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmappia-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'auth.sqlite');
  let store = openAuthStore(filename);
  insert(store);
  store.saveResetFlow({ state_hash: 'state', verifier_ciphertext: 'encrypted', expires_at: 2000 });
  store.saveResetTicket({ ticket_hash: 'ticket', user_id: 'user-a', expires_at: 2000 });
  store.close();
  store = openAuthStore(filename);
  const other = openAuthStore(filename);
  t.after(() => { other.close(); store.close(); });
  assert.ok(store.getSession('hash-a', 1500));
  assert.equal(store.claimResetFlow('state', 1500).verifier_ciphertext, 'encrypted');
  assert.equal(other.claimResetFlow('state', 1500), undefined);
  assert.equal(other.claimResetTicket('ticket', 1500).user_id, 'user-a');
  assert.equal(store.claimResetTicket('ticket', 1500), undefined);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
});

test('expired recovery state cannot be claimed and is pruned', (t) => {
  const store = memory(t);
  store.saveResetFlow({ state_hash: 'state', verifier_ciphertext: 'encrypted', expires_at: 2000 });
  store.saveResetTicket({ ticket_hash: 'ticket', user_id: 'user-a', expires_at: 2000 });
  assert.equal(store.claimResetFlow('state', 2000), undefined);
  assert.equal(store.claimResetTicket('ticket', 2000), undefined);
  insert(store);
  store.prune(2000);
  assert.equal(store.getSession('hash-a', 1500), undefined);
  // Reinserting the same hashes proves expired rows were removed.
  store.saveResetFlow({ state_hash: 'state', verifier_ciphertext: 'encrypted', expires_at: 4000 });
  store.saveResetTicket({ ticket_hash: 'ticket', user_id: 'user-a', expires_at: 4000 });
});

test('account deletion removes its local sessions and recovery tickets', (t) => {
  const store = memory(t);
  insert(store);
  insert(store, 'other', 'user-b');
  store.saveResetTicket({ ticket_hash: 'ticket', user_id: 'user-a', expires_at: 2000 });
  store.deleteUser('user-a');
  assert.equal(store.getSession('hash-a', 1500), undefined);
  assert.equal(store.claimResetTicket('ticket', 1500), undefined);
  assert.ok(store.getSession('other', 1500));
});

test('online backup includes committed sessions while the WAL database remains open', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmappia-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = openAuthStore(path.join(dir, 'auth.sqlite'));
  t.after(() => source.close());
  insert(source);
  const destination = path.join(dir, 'backup.sqlite');
  await source.backup(destination);
  const backup = openAuthStore(destination);
  t.after(() => backup.close());
  assert.equal(backup.getSession('hash-a', 1500).user_id, 'user-a');
});
