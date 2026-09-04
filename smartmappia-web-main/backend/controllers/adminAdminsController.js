// ---------------------------------------------------------------------
// Super-admin surface (migration 0043). Everything here sits behind
// requireSuperAdmin — a plain admin gets 403, not a hidden button.
//
//   listAdmins        : GET    /api/admin/admins
//   createAdmin       : POST   /api/admin/admins
//   updateAdmin       : PATCH  /api/admin/admins/:id
//   resetAdminPassword: POST   /api/admin/admins/:id/password
//   deactivateAdmin   : POST   /api/admin/admins/:id/deactivate
//   reactivateAdmin   : POST   /api/admin/admins/:id/reactivate
//   getSettings       : GET    /api/admin/settings
//   updateSettings    : PATCH  /api/admin/settings
//   listLoginEvents   : GET    /api/admin/login-events
//   loginEventSummary : GET    /api/admin/login-events/summary
//
// Account creation mirrors setStoreOwner in shop/adminShopController.js:
// create the Supabase auth user with a strong random password, then write
// the profile row. Passwords are generated server-side and returned ONCE
// in the create/reset response — they are never stored by us and cannot
// be read back afterwards.
//
// DEACTIVATION IS TWO WRITES, AND BOTH MATTER. Banning the auth user is
// what refuses a new signInWithPassword, because login happens
// client-side against Supabase and never reaches this backend. Setting
// disabled_at is what middleware/auth.js reads to reject a JWT that was
// already issued. One without the other leaves a hole.
// ---------------------------------------------------------------------
const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { config } = require('../lib/config');
const { logAudit } = require('../lib/audit');
const { getMaxDistanceKm, setMaxDistanceKm } = require('../lib/settings');

const ADMIN_SELECT =
  'id, email, full_name, mobile_number, whatsapp_number, role, is_super_admin, ' +
  'disabled_at, disabled_by, created_at';

// Supabase expresses a permanent ban as a very long duration; there is no
// "forever" literal. 876000h is 100 years.
const BAN_FOREVER = '876000h';

// Same generator as scripts/seed-admins.js: ~20 chars, 120 bits, and
// typeable over the phone without ambiguity about padding characters.
function strongPassword() {
  return crypto.randomBytes(15).toString('base64url');
}

// An admin listed in ADMIN_EMAILS cannot be demoted or deactivated here.
//
// syncProfile 403s any ADMIN_EMAILS address arriving on a profile that is
// not already role='admin' (the escalation guard). Demoting one therefore
// does not downgrade the account — it bricks it: they can still sign in to
// Supabase but every /api/auth/sync afterwards is refused, so the app is
// unusable and there is no in-portal way back. The env has to change first.
function isEnvAdmin(email) {
  return config.adminEmails.includes(String(email || '').toLowerCase());
}

async function loadAdmin(id) {
  const { data } = await supabase.from('profiles').select(ADMIN_SELECT).eq('id', id).maybeSingle();
  return data || null;
}

// --- Read -------------------------------------------------------------
async function listAdmins(req, res) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(ADMIN_SELECT)
      .eq('role', 'admin')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('listAdmins error:', error);
      return res.status(500).json({ error: 'Could not load admins' });
    }

    // envManaged tells the UI why deactivate is unavailable on a row,
    // rather than leaving a disabled button with no explanation.
    return res.json({
      admins: (data || []).map((a) => ({ ...a, env_managed: isEnvAdmin(a.email) })),
    });
  } catch (err) {
    console.error('listAdmins error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Create -----------------------------------------------------------
async function createAdmin(req, res) {
  try {
    const b = req.body; // validated by the route schema
    const email = String(b.email).trim().toLowerCase();

    const password = strongPassword();
    let userId;
    let reusedExistingAccount = false;

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no confirmation email — an admin is provisioned, not self-registered
    });

    if (createErr) {
      // The address may already belong to a passenger or driver. Promoting
      // an existing account is legitimate and is how a staff member who
      // already uses the app becomes an admin, so reuse it rather than
      // refusing. Their password is reset either way, because whoever is
      // being handed the portal needs credentials they can be told.
      const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = (list?.users || []).find((u) => (u.email || '').toLowerCase() === email);
      if (!match) {
        console.error('createAdmin createUser error:', createErr);
        return res.status(400).json({ error: 'Could not create this account. Check the email address.' });
      }
      userId = match.id;
      reusedExistingAccount = true;
      const { error: pwErr } = await supabase.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        ban_duration: 'none', // a previously deactivated account is being re-issued
      });
      if (pwErr) {
        console.error('createAdmin updateUserById error:', pwErr);
        return res.status(500).json({ error: 'Could not set the password for this account' });
      }
    } else {
      userId = created.user.id;
    }

    // driver_approved: true matches what the seed scripts write — admins
    // bypass the approval gate anyway (requireApprovedDriver), and leaving
    // it false makes the row read as a pending driver in admin lists.
    const { error: profileErr } = await supabase.from('profiles').upsert(
      {
        id: userId,
        role: 'admin',
        email,
        full_name: b.full_name,
        mobile_number: b.mobile_number ?? null,
        whatsapp_number: b.whatsapp_number ?? null,
        driver_approved: true,
        is_super_admin: !!b.is_super_admin,
        disabled_at: null,
        disabled_by: null,
      },
      { onConflict: 'id' }
    );
    if (profileErr) {
      console.error('createAdmin profile upsert error:', profileErr);
      return res.status(500).json({ error: 'The account was created but its profile could not be saved' });
    }

    await logAudit({
      actorId: req.superAdminId,
      action: 'admin.create',
      resourceType: 'profile',
      resourceId: userId,
      meta: { email, is_super_admin: !!b.is_super_admin, reused_existing_account: reusedExistingAccount },
    });

    // The only time this password is ever visible. Not stored anywhere.
    return res.status(201).json({
      admin: await loadAdmin(userId),
      password,
      reused_existing_account: reusedExistingAccount,
    });
  } catch (err) {
    console.error('createAdmin error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Update -----------------------------------------------------------
async function updateAdmin(req, res) {
  try {
    const b = req.body;
    const target = await loadAdmin(req.params.id);
    if (!target) return res.status(404).json({ error: 'Admin not found' });

    const patch = {};
    if (b.full_name !== undefined) patch.full_name = b.full_name;
    if (b.mobile_number !== undefined) patch.mobile_number = b.mobile_number;
    if (b.whatsapp_number !== undefined) patch.whatsapp_number = b.whatsapp_number;

    if (b.is_super_admin !== undefined && b.is_super_admin !== target.is_super_admin) {
      // Dropping your own super-admin flag is a one-way door: the moment it
      // is written you can no longer reach this endpoint to undo it.
      if (target.id === req.superAdminId && !b.is_super_admin) {
        return res.status(409).json({
          error: 'You cannot remove your own super admin access. Ask another super admin to do it.',
        });
      }
      if (!b.is_super_admin && (await countOtherSuperAdmins(target.id)) === 0) {
        return res.status(409).json({
          error: 'This is the last super admin. Promote someone else first.',
        });
      }
      patch.is_super_admin = !!b.is_super_admin;
    }

    if (!Object.keys(patch).length) return res.json({ admin: target });

    const { error } = await supabase.from('profiles').update(patch).eq('id', target.id);
    if (error) {
      console.error('updateAdmin error:', error);
      return res.status(500).json({ error: 'Could not save the changes' });
    }

    await logAudit({
      actorId: req.superAdminId,
      action: 'admin.update',
      resourceType: 'profile',
      resourceId: target.id,
      meta: { email: target.email, changed: Object.keys(patch) },
    });
    return res.json({ admin: await loadAdmin(target.id) });
  } catch (err) {
    console.error('updateAdmin error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// How many OTHER active super admins exist. Used by both the demote and
// the deactivate guards: the platform must never end up with none, because
// nothing outside this endpoint can grant the flag back except SQL.
async function countOtherSuperAdmins(excludeId) {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_super_admin', true)
    .is('disabled_at', null)
    .neq('id', excludeId);
  return (data || []).length;
}

// --- Password reset ---------------------------------------------------
async function resetAdminPassword(req, res) {
  try {
    const target = await loadAdmin(req.params.id);
    if (!target) return res.status(404).json({ error: 'Admin not found' });

    const password = strongPassword();
    const { error } = await supabase.auth.admin.updateUserById(target.id, { password });
    if (error) {
      console.error('resetAdminPassword error:', error);
      return res.status(500).json({ error: 'Could not reset the password' });
    }

    // The new password is deliberately NOT in meta: audit_logs is readable
    // by every admin, and a credential does not belong in a log row.
    await logAudit({
      actorId: req.superAdminId,
      action: 'admin.password_reset',
      resourceType: 'profile',
      resourceId: target.id,
      meta: { email: target.email },
    });
    return res.json({ password });
  } catch (err) {
    console.error('resetAdminPassword error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Deactivate / reactivate ------------------------------------------
async function deactivateAdmin(req, res) {
  try {
    const target = await loadAdmin(req.params.id);
    if (!target) return res.status(404).json({ error: 'Admin not found' });

    if (target.id === req.superAdminId) {
      return res.status(409).json({ error: 'You cannot deactivate your own account.' });
    }
    if (isEnvAdmin(target.email)) {
      return res.status(409).json({
        error:
          'This account is listed in ADMIN_EMAILS. Remove it from the server environment first, ' +
          'otherwise the account is locked out rather than deactivated cleanly.',
      });
    }
    if (target.is_super_admin && (await countOtherSuperAdmins(target.id)) === 0) {
      return res.status(409).json({ error: 'This is the last super admin. Promote someone else first.' });
    }

    // Ban first: it is the half that stops a NEW sign-in. If the profile
    // write below fails, the account is already locked out rather than
    // still open — the safe direction to fail in.
    const { error: banErr } = await supabase.auth.admin.updateUserById(target.id, {
      ban_duration: BAN_FOREVER,
    });
    if (banErr) {
      console.error('deactivateAdmin ban error:', banErr);
      return res.status(500).json({ error: 'Could not deactivate the account' });
    }

    const { error } = await supabase
      .from('profiles')
      .update({ disabled_at: new Date().toISOString(), disabled_by: req.superAdminId })
      .eq('id', target.id);
    if (error) {
      console.error('deactivateAdmin error:', error);
      return res.status(500).json({ error: 'The account was locked out but its profile could not be updated' });
    }

    await logAudit({
      actorId: req.superAdminId,
      action: 'admin.deactivate',
      resourceType: 'profile',
      resourceId: target.id,
      meta: { email: target.email },
    });
    return res.json({ admin: await loadAdmin(target.id) });
  } catch (err) {
    console.error('deactivateAdmin error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function reactivateAdmin(req, res) {
  try {
    const target = await loadAdmin(req.params.id);
    if (!target) return res.status(404).json({ error: 'Admin not found' });

    const { error: banErr } = await supabase.auth.admin.updateUserById(target.id, {
      ban_duration: 'none',
    });
    if (banErr) {
      console.error('reactivateAdmin unban error:', banErr);
      return res.status(500).json({ error: 'Could not reactivate the account' });
    }

    const { error } = await supabase
      .from('profiles')
      .update({ disabled_at: null, disabled_by: null })
      .eq('id', target.id);
    if (error) {
      console.error('reactivateAdmin error:', error);
      return res.status(500).json({ error: 'Could not reactivate the account' });
    }

    await logAudit({
      actorId: req.superAdminId,
      action: 'admin.reactivate',
      resourceType: 'profile',
      resourceId: target.id,
      meta: { email: target.email },
    });
    return res.json({ admin: await loadAdmin(target.id) });
  } catch (err) {
    console.error('reactivateAdmin error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Settings ---------------------------------------------------------
async function getSettings(req, res) {
  try {
    return res.json({ max_distance_km: await getMaxDistanceKm() });
  } catch (err) {
    console.error('getSettings error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function updateSettings(req, res) {
  try {
    const b = req.body;
    // null is meaningful (no limit), so `undefined` is the only "not sent".
    if (b.max_distance_km === undefined) {
      return res.status(400).json({ error: 'max_distance_km is required (a number, or null for no limit)' });
    }
    const value = b.max_distance_km === null ? null : Number(b.max_distance_km);
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      return res.status(400).json({ error: 'max_distance_km must be a positive number, or null for no limit' });
    }

    await setMaxDistanceKm(value, req.superAdminId);
    await logAudit({
      actorId: req.superAdminId,
      action: 'settings.update',
      resourceType: 'app_settings',
      resourceId: 'max_distance_km',
      meta: { max_distance_km: value },
    });
    return res.json({ max_distance_km: await getMaxDistanceKm() });
  } catch (err) {
    console.error('updateSettings error:', err);
    return res.status(500).json({ error: 'Could not save the setting' });
  }
}

// --- Login activity ---------------------------------------------------
async function listLoginEvents(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let q = supabase
      .from('admin_login_events')
      .select('id, occurred_at, profile_id, email, role, ip, user_agent', { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.profile_id) q = q.eq('profile_id', req.query.profile_id);
    if (req.query.since) q = q.gte('occurred_at', req.query.since);

    const { data, error, count } = await q;
    if (error) {
      console.error('listLoginEvents error:', error);
      return res.status(500).json({ error: 'Could not load login activity' });
    }
    return res.json({ events: data || [], total: count ?? 0, limit, offset });
  } catch (err) {
    console.error('listLoginEvents error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// "How many admins are logging in, and when" — the counts behind the stat
// cards. Aggregated here rather than in SQL because the volume is tiny
// (admins only, pruned at 180 days) and a view would be one more thing to
// migrate.
async function loginEventSummary(req, res) {
  try {
    const windowDays = Math.min(Number(req.query.days) || 30, 180);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('admin_login_events')
      .select('profile_id, email, occurred_at')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false });
    if (error) {
      console.error('loginEventSummary error:', error);
      return res.status(500).json({ error: 'Could not load login activity' });
    }

    const rows = data || [];
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const byAdmin = new Map();
    for (const row of rows) {
      // Key on the email snapshot: profile_id goes null once an account is
      // deleted, which would otherwise collapse every deleted admin into one.
      const key = row.profile_id || row.email || 'unknown';
      const entry = byAdmin.get(key);
      if (entry) {
        entry.logins += 1;
      } else {
        // rows are newest-first, so the first one seen is the latest.
        byAdmin.set(key, {
          profile_id: row.profile_id,
          email: row.email,
          logins: 1,
          last_login: row.occurred_at,
        });
      }
    }

    const admins = [...byAdmin.values()].sort((a, b) => b.logins - a.logins);
    return res.json({
      window_days: windowDays,
      total_logins: rows.length,
      distinct_admins: admins.length,
      active_last_24h: admins.filter((a) => Date.parse(a.last_login) >= dayAgo).length,
      admins,
    });
  } catch (err) {
    console.error('loginEventSummary error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = {
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
  deactivateAdmin,
  reactivateAdmin,
  getSettings,
  updateSettings,
  listLoginEvents,
  loginEventSummary,
};
