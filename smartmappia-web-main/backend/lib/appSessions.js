const crypto = require('crypto');
const { authClient } = require('./authClient');
const { supabase } = require('./supabase');
const { getAuthStore } = require('./authStore');

const IDLE_DAYS = 30;
const ABSOLUTE_DAYS = 90;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_ENCRYPTION_KEY) {
  throw new Error('SESSION_ENCRYPTION_KEY is required in production');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function secretKey() {
  const raw = process.env.SESSION_ENCRYPTION_KEY;
  return crypto.createHash('sha256').update(raw || process.env.SUPABASE_SERVICE_ROLE_KEY).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value) {
  const [iv, tag, body] = String(value).split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

function bearer(req) {
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const store = getAuthStore();
  store.prune(now);
  store.insertSession({
    token_hash: hashToken(token),
    user_id: user.id,
    now,
    idle_expires_at: now + IDLE_DAYS * 86400000,
    absolute_expires_at: now + ABSOLUTE_DAYS * 86400000,
    user_agent: String(req.get('user-agent') || '').slice(0, 500) || null,
    ip: req.ip || null,
  });
  return { token, user: { id: user.id, email: user.email } };
}

async function findSession(req) {
  const token = bearer(req);
  if (!token) return null;
  const now = Date.now();
  const store = getAuthStore();
  const data = store.getSession(hashToken(token), now);
  if (!data) return null;

  if (now - data.last_seen_at >= TOUCH_EVERY_MS) {
    store.touchSession(data.id, now, now + IDLE_DAYS * 86400000);
  }
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(data.user_id);
  if (userError || !userData?.user) return null;
  return { id: data.id, user: userData.user };
}

async function revokeSession(req) {
  const token = bearer(req);
  if (!token) return;
  getAuthStore().revokeSession(hashToken(token), Date.now());
}

async function revokeAll(userId) {
  getAuthStore().revokeAll(userId, Date.now());
}

module.exports = {
  authClient,
  bearer,
  createSession,
  findSession,
  revokeSession,
  revokeAll,
  hashToken,
  encrypt,
  decrypt,
};
