const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { config } = require('./config');

// Only API-owned sessions and recovery state live here. Accounts and passwords
// continue to be managed by Supabase Auth. All timestamps are epoch milliseconds.
function openAuthStore(filename) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    // Create with restrictive permissions before SQLite opens the file/WAL.
    fs.closeSync(fs.openSync(filename, 'a', 0o600));
    fs.chmodSync(filename, 0o600);
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
      idle_expires_at INTEGER NOT NULL, absolute_expires_at INTEGER NOT NULL,
      revoked_at INTEGER, user_agent TEXT, ip TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON app_sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON app_sessions(idle_expires_at);
    CREATE TABLE IF NOT EXISTS password_reset_flows (
      state_hash TEXT PRIMARY KEY, verifier_ciphertext TEXT NOT NULL,
      expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS flows_expiry ON password_reset_flows(expires_at);
    CREATE TABLE IF NOT EXISTS password_reset_tickets (
      ticket_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS tickets_expiry ON password_reset_tickets(expires_at);
    CREATE INDEX IF NOT EXISTS tickets_user ON password_reset_tickets(user_id);
  `);
  const insertSession = db.prepare(`INSERT INTO app_sessions
    (id, token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, user_agent, ip)
    VALUES (@id, @token_hash, @user_id, @now, @now, @idle_expires_at, @absolute_expires_at, @user_agent, @ip)`);
  const session = db.prepare(`SELECT * FROM app_sessions WHERE token_hash = ?
    AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ?`);
  const touch = db.prepare(`UPDATE app_sessions SET last_seen_at = MAX(last_seen_at, @now),
    idle_expires_at = MIN(absolute_expires_at, MAX(idle_expires_at, @idle))
    WHERE id = @id AND revoked_at IS NULL AND idle_expires_at > @now AND absolute_expires_at > @now`);
  const revoke = db.prepare('UPDATE app_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL');
  const revokeUser = db.prepare('UPDATE app_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL');
  const saveFlow = db.prepare(`INSERT INTO password_reset_flows (state_hash, verifier_ciphertext, expires_at)
    VALUES (@state_hash, @verifier_ciphertext, @expires_at)`);
  const claimFlow = db.prepare(`UPDATE password_reset_flows SET consumed_at = ?
    WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING *`);
  const saveTicket = db.prepare(`INSERT INTO password_reset_tickets (ticket_hash, user_id, expires_at)
    VALUES (@ticket_hash, @user_id, @expires_at)`);
  const claimTicket = db.prepare(`UPDATE password_reset_tickets SET consumed_at = ?
    WHERE ticket_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING user_id`);
  const prune = db.transaction((now) => {
    db.prepare('DELETE FROM app_sessions WHERE idle_expires_at <= ? OR absolute_expires_at <= ?').run(now, now);
    db.prepare('DELETE FROM password_reset_flows WHERE expires_at <= ?').run(now);
    db.prepare('DELETE FROM password_reset_tickets WHERE expires_at <= ?').run(now);
  });
  const deleteUser = db.transaction((userId) => {
    db.prepare('DELETE FROM app_sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM password_reset_tickets WHERE user_id = ?').run(userId);
  });
  return {
    insertSession: (row) => insertSession.run({ id: randomUUID(), ...row }),
    getSession: (hash, now) => session.get(hash, now, now),
    touchSession: (id, now, idle) => touch.run({ id, now, idle }),
    revokeSession: (hash, now) => revoke.run(now, hash),
    revokeAll: (userId, now) => revokeUser.run(now, userId),
    saveResetFlow: (row) => saveFlow.run(row),
    claimResetFlow: (hash, now) => claimFlow.get(now, hash, now),
    saveResetTicket: (row) => saveTicket.run(row),
    claimResetTicket: (hash, now) => claimTicket.get(now, hash, now),
    prune,
    deleteUser,
    backup: (destination) => db.backup(destination),
    close: () => db.close(),
  };
}

let store;
function getAuthStore() {
  if (!store) store = openAuthStore(config.sessions.sqlitePath);
  return store;
}

module.exports = { openAuthStore, getAuthStore };
