// ---------------------------------------------------------------------
// Saved payment methods ("card on file") — business rules, shared by all
// three verticals.
//
// THE OWNERSHIP RULE LIVES HERE AND NOWHERE ELSE. loadOwnedMethod is the
// only function that can produce chargeable gateway references, and it
// resolves by (id AND user_id) in a single query predicate. Charging
// another customer's card is the worst thing this feature can do, so there
// is exactly one door and it cannot be opened without a user id.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { config } = require('./config');
const tap = require('./tap');
const { logAudit } = require('./audit');

// The ONLY column list that may reach a browser. The three gateway
// references are absent by construction, not by remembering to omit them:
// a client holding gateway_card_id + gateway_customer_id could mint a
// charge token against that card.
const PUBLIC_COLUMNS =
  'id, brand, funding, last4, exp_month, exp_year, is_default, last_used_at, created_at';

// A card is dead once its expiry month has passed. Tap will reject it
// anyway; computing it locally means the UI never offers a card we already
// know will fail.
function isExpired(method, now = new Date()) {
  if (!method || !method.exp_year || !method.exp_month) return false;
  const endOfMonth = new Date(Date.UTC(Number(method.exp_year), Number(method.exp_month), 1));
  return now >= endOfMonth;
}

function expiringSoon(method, now = new Date()) {
  if (!method || !method.exp_year || !method.exp_month) return false;
  const endOfMonth = new Date(Date.UTC(Number(method.exp_year), Number(method.exp_month), 1));
  const soon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  return endOfMonth > now && endOfMonth <= soon;
}

async function listMethods(userId) {
  const { data, error } = await supabase
    .from('saved_payment_methods')
    .select(PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const now = new Date();
  return (data || []).map((m) => ({
    ...m,
    expired: isExpired(m, now),
    expiringSoon: expiringSoon(m, now),
  }));
}

// The IDOR gate.
//
// user_id is a QUERY PREDICATE, not a post-fetch comparison: an
// `if (row.user_id !== userId)` after a plain .eq('id', ...) is one
// refactor away from being dropped, and by then the chargeable references
// are already in memory.
//
// There is deliberately NO admin bypass here, unlike every guard in
// middleware/auth.js and unlike assertOwner in the order controllers.
// Support staff have no legitimate reason to charge a customer's card.
//
// A miss returns null and the caller answers 404, never 403 — a 403 would
// confirm that some other user owns that id.
async function loadOwnedMethod(userId, methodId) {
  if (!userId || !methodId) return null;
  const { data } = await supabase
    .from('saved_payment_methods')
    .select(
      'id, user_id, gateway_customer_id, gateway_card_id, payment_agreement_id, brand, last4, exp_month, exp_year'
    )
    .eq('id', methodId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  return data || null;
}

// One Tap customer per person, created lazily and cached. Tap's charge API
// requires a customer on every request, so this runs on the first card
// payment and never again.
async function ensureCustomer(profile) {
  const { data: existing, error: readErr } = await supabase
    .from('payment_customers')
    .select('gateway_customer_id')
    .eq('user_id', profile.id)
    .eq('provider', 'tap')
    .maybeSingle();
  // A failed read is not "no customer yet". Carrying on would create a Tap
  // customer the insert below can't save either, and a fresh orphan at Tap
  // on every retry.
  if (readErr) throw readErr;
  if (existing && existing.gateway_customer_id) return existing.gateway_customer_id;

  const customer = await tap.createCustomer(profile);
  const gatewayCustomerId = customer && customer.id;
  if (!gatewayCustomerId) {
    throw new tap.TapError('gateway', 'The payment gateway did not return a customer');
  }

  const { error } = await supabase
    .from('payment_customers')
    .insert({ user_id: profile.id, provider: 'tap', gateway_customer_id: gatewayCustomerId });
  if (error) {
    // 23505: a concurrent request created it first. Theirs wins — re-read
    // rather than ending up with two customers for one person.
    if (error.code === '23505') {
      const { data } = await supabase
        .from('payment_customers')
        .select('gateway_customer_id')
        .eq('user_id', profile.id)
        .eq('provider', 'tap')
        .maybeSingle();
      if (data && data.gateway_customer_id) return data.gateway_customer_id;
    }
    throw error;
  }
  return gatewayCustomerId;
}

// Persist the card references Tap minted on a successful save_card charge.
//
// Called from the webhook (the only place guaranteed to observe a completed
// 3DS charge) and from the synchronous non-3DS path. Idempotent: the two
// can both fire for one charge and the second is a no-op.
async function saveMethodFromCharge({ userId, charge, consentReference }) {
  const card = (charge && charge.card) || (charge && charge.source) || null;
  const cardId = card && card.id;
  const customerId = charge && charge.customer && charge.customer.id;
  if (!cardId || !customerId || !String(cardId).startsWith('card_')) return null;

  const agreementId =
    (charge.payment_agreement && charge.payment_agreement.id) || null;
  const details = tap.safeCardDetails(card);

  const { data: existing } = await supabase
    .from('saved_payment_methods')
    .select('id, user_id, deleted_at')
    .eq('gateway_card_id', cardId)
    .maybeSingle();

  if (existing) {
    // Should be impossible — uq_spm_card_global makes one card id global,
    // and Tap issues card ids per customer. If it ever happens, refusing is
    // the only safe answer: attaching it would hand one person's card to
    // another account.
    if (existing.user_id !== userId) {
      console.error('saveMethodFromCharge: card already owned by another user', {
        cardId,
        existingId: existing.id,
      });
      return null;
    }
    await supabase
      .from('saved_payment_methods')
      .update({
        gateway_customer_id: customerId,
        // An agreement can appear later (Tap activates it, or the first
        // charge predated activation) — take it whenever it shows up, but
        // never overwrite a good one with null.
        ...(agreementId ? { payment_agreement_id: agreementId } : {}),
        brand: details.brand,
        funding: details.funding,
        last4: details.last4,
        exp_month: details.expMonth,
        exp_year: details.expYear,
        // Re-adding a card the customer previously removed revives the row.
        deleted_at: null,
      })
      .eq('id', existing.id);
    return existing.id;
  }

  // First card becomes the default so the picker always has a preselection.
  const { count } = await supabase
    .from('saved_payment_methods')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null);

  const { data: inserted, error } = await supabase
    .from('saved_payment_methods')
    .insert({
      user_id: userId,
      provider: 'tap',
      gateway_customer_id: customerId,
      gateway_card_id: cardId,
      payment_agreement_id: agreementId,
      brand: details.brand,
      funding: details.funding,
      last4: details.last4,
      exp_month: details.expMonth,
      exp_year: details.expYear,
      is_default: !count,
      consent_reference: consentReference || null,
    })
    .select('id')
    .single();

  if (error) {
    // 23505: the other of the two paths (webhook / synchronous) got there
    // first. Already saved is a success.
    if (error.code === '23505') return null;
    throw error;
  }

  logAudit({
    actorId: userId,
    action: 'payment_method_saved',
    resourceType: 'saved_payment_method',
    resourceId: inserted.id,
    // brand + last4 only. Never the card id, never the customer id.
    meta: { brand: details.brand, last4: details.last4, reference: consentReference || null },
  });
  return inserted.id;
}

// Revoke at Tap FIRST, then soft-delete locally.
//
// The order matters. A dead local row is harmless — the next charge fails
// and cleans it up. A live chargeable card at Tap with no local record is
// not. If Tap refuses, still soft-delete: the customer asked us to stop
// using it, and we honour that even if the revoke needs chasing.
async function softDeleteMethod(userId, methodId) {
  const method = await loadOwnedMethod(userId, methodId);
  if (!method) return null;

  try {
    await tap.deleteCard(method.gateway_customer_id, method.gateway_card_id);
  } catch (err) {
    console.error('softDeleteMethod: gateway revoke failed, removing locally anyway', {
      methodId,
      kind: err.kind || null,
    });
  }

  await supabase
    .from('saved_payment_methods')
    .update({ deleted_at: new Date().toISOString(), is_default: false })
    .eq('id', method.id)
    .eq('user_id', userId);

  logAudit({
    actorId: userId,
    action: 'payment_method_removed',
    resourceType: 'saved_payment_method',
    resourceId: method.id,
    meta: { brand: method.brand, last4: method.last4 },
  });
  return method.id;
}

// Moving the default is a single statement in Postgres because
// uq_spm_one_default would otherwise make "clear old, set new" a 23505 race.
async function setDefault(userId, methodId) {
  const { data, error } = await supabase.rpc('set_default_payment_method', {
    p_user_id: userId,
    p_id: methodId,
  });
  if (error) throw error;
  return data === true;
}

async function markUsed(methodId) {
  await supabase
    .from('saved_payment_methods')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', methodId);
}

// Drop a card we have learned is no longer usable (expired, or Tap no
// longer recognises it). Local only — there is nothing left to revoke.
async function retireMethod(methodId, reason) {
  await supabase
    .from('saved_payment_methods')
    .update({ deleted_at: new Date().toISOString(), is_default: false })
    .eq('id', methodId);
  console.warn('Retired saved payment method:', methodId, reason);
}

// Lazy reconciliation, run when the customer opens the manage screen.
// Anything Tap no longer lists is soft-deleted so the picker stops offering
// a card that cannot be charged.
//
// Deliberately one-way: a card Tap knows about but we did not save has no
// consent evidence behind it and must never become chargeable here.
async function reconcileWithGateway(userId) {
  const { data: rows } = await supabase
    .from('saved_payment_methods')
    .select('id, gateway_customer_id, gateway_card_id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .limit(config.tap.maxSavedCards);
  if (!rows || !rows.length) return;

  const customerId = rows[0].gateway_customer_id;
  let live;
  try {
    live = await tap.listCards(customerId);
  } catch (err) {
    // A gateway blip must not empty someone's wallet. Leave the rows alone.
    console.error('reconcileWithGateway: could not list cards', { kind: err.kind || null });
    return;
  }
  const liveIds = new Set(live.map((c) => c.id));
  for (const row of rows) {
    if (!liveIds.has(row.gateway_card_id)) {
      await retireMethod(row.id, 'not present at gateway');
    }
  }
}

module.exports = {
  PUBLIC_COLUMNS,
  isExpired,
  listMethods,
  loadOwnedMethod,
  ensureCustomer,
  saveMethodFromCharge,
  softDeleteMethod,
  setDefault,
  markUsed,
  retireMethod,
  reconcileWithGateway,
};
