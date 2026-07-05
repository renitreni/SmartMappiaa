// ---------------------------------------------------------------------
// Audit logging (SDAIA / PCI-DSS access control, PRD §8.4).
//
// Writes an immutable who-did-what-when row to audit_logs (migration
// 0012) for every privileged action and access to sensitive data:
// admin suspend/reconcile, payment verification, credit charges, etc.
// Best-effort like logNotification — an audit failure is logged but
// never breaks the request that triggered it. Never put secrets, tokens,
// or raw payment data in `meta`.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');

async function logAudit({ actorId = null, action, resourceType = null, resourceId = null, meta = null }) {
  try {
    await supabase.from('audit_logs').insert({
      actor_id: actorId,
      action,
      resource_type: resourceType,
      resource_id: resourceId != null ? String(resourceId) : null,
      meta,
    });
  } catch (err) {
    console.error('logAudit error:', err.message || err);
  }
}

module.exports = { logAudit };
