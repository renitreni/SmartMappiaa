const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { supabase } = require('./supabase');

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

function authClient(storage) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: !!storage,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
      ...(storage ? { storage } : {}),
    },
  });
}

function bearer(req) {
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const { error } = await supabase.from('app_sessions').insert({
    token_hash: hashToken(token),
    user_id: user.id,
    idle_expires_at: new Date(now + IDLE_DAYS * 86400000).toISOString(),
    absolute_expires_at: new Date(now + ABSOLUTE_DAYS * 86400000).toISOString(),
    user_agent: String(req.get('user-agent') || '').slice(0, 500) || null,
    ip: req.ip || null,
  });
  if (error) throw error;
  // Bounded opportunistic cleanup; correctness never depends on this.
  supabase.from('app_sessions').delete().lt('absolute_expires_at', new Date().toISOString())
    .then(({ error: pruneError }) => {
      if (pruneError) console.error('session prune failed:', pruneError);
    });
  return { token, user: { id: user.id, email: user.email } };
}

async function findSession(req) {
  const token = bearer(req);
  if (!token) return null;
  const now = new Date();
  const { data, error } = await supabase
    .from('app_sessions')
    .select('id,user_id,last_seen_at,idle_expires_at,absolute_expires_at,revoked_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  if (new Date(data.idle_expires_at) <= now || new Date(data.absolute_expires_at) <= now) return null;

  if (now - new Date(data.last_seen_at) >= TOUCH_EVERY_MS) {
    const idle = new Date(Math.min(
      now.getTime() + IDLE_DAYS * 86400000,
      new Date(data.absolute_expires_at).getTime()
    ));
    supabase.from('app_sessions').update({
      last_seen_at: now.toISOString(),
      idle_expires_at: idle.toISOString(),
    }).eq('id', data.id).then(({ error: touchError }) => {
      if (touchError) console.error('session touch failed:', touchError);
    });
  }
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(data.user_id);
  if (userError || !userData?.user) return null;
  return { id: data.id, user: userData.user };
}

async function revokeSession(req) {
  const token = bearer(req);
  if (!token) return;
  await supabase.from('app_sessions').update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', hashToken(token));
}

async function revokeAll(userId) {
  await supabase.from('app_sessions').update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId).is('revoked_at', null);
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
