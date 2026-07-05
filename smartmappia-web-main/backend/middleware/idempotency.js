// ---------------------------------------------------------------------
// Idempotency middleware for checkout / payment endpoints.
//
// Clients send an `Idempotency-Key` header; retries of the same request
// (same user + route + key) replay the ORIGINAL response instead of
// re-executing — so a flaky network can't create two orders or double-
// record a payment. In-memory per process, which matches how rate
// limiting already works here (single VPS; best-effort per instance on
// serverless). Gateway webhooks get DB-level idempotency on top via the
// unique order_payments.gateway_transaction_id index.
// ---------------------------------------------------------------------

const TTL_MS = 10 * 60 * 1000; // remember completed requests for 10 minutes
const MAX_ENTRIES = 1000;

const store = new Map(); // key -> { state: 'pending'|'done', status, body, at }

function prune() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.at > TTL_MS) store.delete(key);
  }
  // Hard cap so a key-spamming client can't grow memory unbounded.
  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value);
  }
}

function idempotent(req, res, next) {
  const key = req.get('idempotency-key');
  if (!key) return next(); // header is optional; without it behave normally

  const mapKey = `${req.userId || 'anon'}:${req.method}:${req.baseUrl}${req.path}:${key}`;
  prune();

  const existing = store.get(mapKey);
  if (existing) {
    if (existing.state === 'pending') {
      return res.status(409).json({ error: 'This request is already being processed' });
    }
    res.set('Idempotency-Replayed', 'true');
    return res.status(existing.status).json(existing.body);
  }

  store.set(mapKey, { state: 'pending', at: Date.now() });

  // Capture the response so an identical retry can replay it.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    store.set(mapKey, { state: 'done', status: res.statusCode, body, at: Date.now() });
    return originalJson(body);
  };

  // If the request dies without a JSON response, forget the key so the
  // client's retry actually runs.
  res.on('close', () => {
    const entry = store.get(mapKey);
    if (entry && entry.state === 'pending') store.delete(mapKey);
  });

  return next();
}

module.exports = { idempotent };
