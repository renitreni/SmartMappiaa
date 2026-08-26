// ---------------------------------------------------------------------
// Admin: read and triage the error_logs table (migration 0042).
//
// The rows are written by lib/errorLog.js, which intercepts every
// console.error in the app. This is the only way anyone reads them —
// error_logs is revoked from anon and authenticated, so there is no
// client path to it that does not come through here, behind requireAdmin
// (applied router-wide in routes/admin.js).
//
// Pagination follows listBookings in adminController.js — the same
// { total, limit, offset, ... } contract, so the frontend pager has one
// shape to learn.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { logAudit } = require('../lib/audit');

// Stack traces are large and useless in a list; getError fetches the one
// row the admin actually opened.
const LIST_COLS =
  'id, occurred_at, severity, label, message, error_name, method, path, status_code, ' +
  'request_id, user_id, user_email, user_role, fingerprint, suppressed_count, ' +
  'resolved_at, resolved_by';

const SINCE_HOURS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

// PostgREST treats these as operators inside an or()/ilike() filter.
// Escaped rather than rejected: an admin searching a stack trace will
// paste punctuation.
function escapeLike(term) {
  return term.replace(/[%_,()]/g, (ch) => `\\${ch}`);
}

// --- GET /api/admin/errors -------------------------------------------
async function listErrors(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
      .from('error_logs')
      .select(LIST_COLS, { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const status = req.query.status || 'open';
    if (status === 'open') query = query.is('resolved_at', null);
    else if (status === 'resolved') query = query.not('resolved_at', 'is', null);

    const hours = SINCE_HOURS[req.query.since];
    if (hours) {
      query = query.gte('occurred_at', new Date(Date.now() - hours * 3600_000).toISOString());
    }

    if (req.query.severity) query = query.eq('severity', req.query.severity);
    if (req.query.label) query = query.eq('label', req.query.label);
    if (req.query.fingerprint) query = query.eq('fingerprint', req.query.fingerprint);
    if (req.query.user_id) query = query.eq('user_id', req.query.user_id);

    const term = (req.query.q || '').trim();
    if (term) {
      const like = `%${escapeLike(term)}%`;
      query = query.or(
        `label.ilike.${like},message.ilike.${like},path.ilike.${like},user_email.ilike.${like}`
      );
    }

    const { data, error, count } = await query;
    if (error) {
      console.error('listErrors query error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }

    return res.json({ total: count ?? data.length, limit, offset, errors: data });
  } catch (err) {
    console.error('listErrors error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- GET /api/admin/errors/summary -----------------------------------
async function errorSummary(req, res) {
  try {
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();

    const [open, last24h, recent] = await Promise.all([
      supabase.from('error_logs').select('id', { count: 'exact', head: true }).is('resolved_at', null),
      supabase.from('error_logs').select('id', { count: 'exact', head: true }).gte('occurred_at', dayAgo),
      // PostgREST has no group by and an RPC for one small rollup is not
      // worth a migration, so it is grouped below. Bounded to 500 rows so
      // the cost is fixed however big the table gets.
      supabase
        .from('error_logs')
        .select('label, fingerprint, message, suppressed_count, occurred_at')
        .is('resolved_at', null)
        .gte('occurred_at', dayAgo)
        .order('occurred_at', { ascending: false })
        .limit(500),
    ]);

    if (recent.error) {
      console.error('errorSummary query error:', recent.error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }

    const groups = new Map();
    for (const row of recent.data || []) {
      const g = groups.get(row.fingerprint) || {
        fingerprint: row.fingerprint,
        label: row.label,
        message: row.message,
        occurrences: 0,
        last_seen: row.occurred_at,
      };
      g.occurrences += (row.suppressed_count || 0) + 1;
      if (row.occurred_at > g.last_seen) g.last_seen = row.occurred_at;
      groups.set(row.fingerprint, g);
    }

    const top = [...groups.values()].sort((a, b) => b.occurrences - a.occurrences).slice(0, 10);

    return res.json({ open: open.count ?? 0, last24h: last24h.count ?? 0, top });
  } catch (err) {
    console.error('errorSummary error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- GET /api/admin/errors/:id ---------------------------------------
async function getError(req, res) {
  try {
    const { data: row, error } = await supabase
      .from('error_logs')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) {
      console.error('getError query error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
    if (!row) return res.status(404).json({ error: 'Error log not found' });

    // The other times this bug fired: the fastest way to see whether it
    // hits one user or everyone.
    const { data: related } = await supabase
      .from('error_logs')
      .select('id, occurred_at, user_email, path, suppressed_count')
      .eq('fingerprint', row.fingerprint)
      .neq('id', row.id)
      .order('occurred_at', { ascending: false })
      .limit(20);

    return res.json({ error_log: row, related: related || [] });
  } catch (err) {
    console.error('getError error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- POST /api/admin/errors/:id/resolve -------------------------------
// Resolving the whole fingerprint rather than the single row: the admin is
// saying "this bug is dealt with", and clearing one of two hundred
// identical rows would leave the list exactly as noisy as before.
async function resolveError(req, res) {
  try {
    const resolved = req.body && req.body.resolved === false ? false : true;

    const { data: row, error: findErr } = await supabase
      .from('error_logs')
      .select('id, fingerprint, label')
      .eq('id', req.params.id)
      .maybeSingle();

    if (findErr) {
      console.error('resolveError lookup error:', findErr);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
    if (!row) return res.status(404).json({ error: 'Error log not found' });

    const patch = resolved
      ? { resolved_at: new Date().toISOString(), resolved_by: req.adminId }
      : { resolved_at: null, resolved_by: null };

    const { error: updErr, count } = await supabase
      .from('error_logs')
      .update(patch, { count: 'exact' })
      .eq('fingerprint', row.fingerprint);

    if (updErr) {
      console.error('resolveError update error:', updErr);
      return res.status(500).json({ error: 'Unexpected server error' });
    }

    logAudit({
      actorId: req.adminId,
      action: resolved ? 'admin_error_resolved' : 'admin_error_reopened',
      resourceType: 'error_log',
      resourceId: row.id,
      meta: { label: row.label, fingerprint: row.fingerprint, rows: count ?? null },
    });

    return res.json({ ok: true, resolved, updated: count ?? null });
  } catch (err) {
    console.error('resolveError error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { listErrors, errorSummary, getError, resolveError };
