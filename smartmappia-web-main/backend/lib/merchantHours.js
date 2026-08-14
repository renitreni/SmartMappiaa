// ---------------------------------------------------------------------
// Reads and writes for merchant opening hours + the "closed now" switch
// (migration 0038). Shared by food and shop, and by the admin and the
// owner portals — one merchant_hours table, one set of rules.
//
// Writes replace the whole week rather than patching single windows. An
// hours editor submits the full schedule anyway, and replace-all removes a
// class of bug (orphaned windows from a day the user cleared) for the cost
// of a slightly larger request.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Accepts [{ weekday, opens_at, closes_at }]. Returns { ok, error, rows }.
// A window with closes_at === opens_at is rejected: as a zero-length window
// it would be dead config, and as a 24h window it is better expressed as
// 00:00-23:59 than as an ambiguous equal pair.
function validateWindows(windows) {
  if (!Array.isArray(windows)) return { ok: false, error: 'hours must be an array' };
  if (windows.length > 50) return { ok: false, error: 'Too many opening windows' };

  const rows = [];
  const seen = new Set();
  for (const w of windows) {
    const weekday = Number(w.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, error: 'weekday must be 0 (Sunday) to 6 (Saturday)' };
    }
    const opens = String(w.opens_at || '').slice(0, 5);
    const closes = String(w.closes_at || '').slice(0, 5);
    if (!HHMM.test(opens) || !HHMM.test(closes)) {
      return { ok: false, error: 'Times must be HH:MM (24-hour)' };
    }
    if (opens === closes) {
      return { ok: false, error: 'Opening and closing time cannot be the same' };
    }
    // Matches the unique(merchant_id, weekday, opens_at) constraint, caught
    // here so the user gets a sentence instead of a 23505.
    const key = `${weekday}-${opens}`;
    if (seen.has(key)) {
      return { ok: false, error: 'Two windows on the same day cannot start at the same time' };
    }
    seen.add(key);
    rows.push({ weekday, opens_at: opens, closes_at: closes });
  }
  return { ok: true, rows };
}

async function listHours(merchantId) {
  const { data, error } = await supabase
    .from('merchant_hours')
    .select('weekday, opens_at, closes_at')
    .eq('merchant_id', merchantId)
    .order('weekday')
    .order('opens_at');
  if (error) throw error;
  return data || [];
}

async function replaceHours(merchantId, windows) {
  const check = validateWindows(windows);
  if (!check.ok) return check;

  const { error: delErr } = await supabase
    .from('merchant_hours')
    .delete()
    .eq('merchant_id', merchantId);
  if (delErr) throw delErr;

  // An empty schedule is legitimate and means "always open" (see 0038).
  if (check.rows.length > 0) {
    const { error: insErr } = await supabase
      .from('merchant_hours')
      .insert(check.rows.map((r) => ({ ...r, merchant_id: merchantId })));
    if (insErr) throw insErr;
  }
  return { ok: true, rows: check.rows };
}

async function setAcceptingOrders(merchantId, accepting) {
  const { error } = await supabase
    .from('merchants')
    .update({ accepting_orders: !!accepting })
    .eq('id', merchantId);
  if (error) throw error;
}

module.exports = { validateWindows, listHours, replaceHours, setAcceptingOrders };
