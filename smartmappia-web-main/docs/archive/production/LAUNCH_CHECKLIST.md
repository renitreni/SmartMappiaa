# Production launch checklist

Things to do **before** going to real production (real money and/or public sign-ups).
These are safe to leave as-is during the closed pilot, but must be handled before launch.

> See also [SECURITY_TODO.md](SECURITY_TODO.md) for the security hardening notes (RLS, CORS,
> rate limiting, error sanitization, etc.).

## TODO before launch

- [ ] **CRITICAL — swap the frontend Supabase key + rotate service_role.**
  `VITE_SUPABASE_ANON_KEY` in `frontend/.env` currently holds the **service_role** key (decodes to
  `role: service_role`) and `VITE_*` ships in the browser bundle — full DB access, RLS bypassed.
  Replace it with the real **anon** key (Supabase dashboard -> Settings -> API), ROTATE the
  service_role key, and update `backend/.env`. `.env` is gitignored so it did not leak via git, but
  this must be fixed before any build/deploy. See [SECURITY_TODO.md](SECURITY_TODO.md).

- [x] **Turn off test payment auto-verify.** Done locally: `AUTO_VERIFY_STCPAY_TEST_MODE=false` and
  `PAYMENT_MODE=stcpay_manual` in `backend/.env`; admin manual verification tested end-to-end.
  Set the same on the production backend env (auto-verify MUST be false in production).

- [x] **Online payment gateway (Tap) off.** `VITE_TAP_ENABLED=false` -> "Pay online (coming soon)"
  placeholder; manual STC Pay is the working path. Keep off until the Tap backend is built.

- [ ] **Re-enable the driver verification gate.**
  Migration `0004` was NOT applied to the current Supabase (nothing to reverse). Revert the
  auto-approve line in `backend/controllers/authController.js` back to
  `role === 'admin' ? true : (existing ? existing.driver_approved : false)`, keep
  `profiles.driver_approved` default `false`, and do not run `0004` on production. Then build
  document-based driver verification per [PICK_AND_DROP.md](PICK_AND_DROP.md) section 4.
  Why: while auto-approve is on, anyone who signs up as a driver can accept rides with no ID/vehicle checks.

- [ ] **Rate limiting behind the proxy.** Per-endpoint limits are in place
  (`backend/middleware/rateLimiters.js`). On the VPS behind Nginx, set `app.set('trust proxy', 1)`
  in `backend/app.js` so limits key on the real client IP, not the proxy.

## Already verified on the current Supabase project (pilot)

- Migrations 0001–0003 applied; all 7 tables present
  (`profiles`, `bookings`, `payment_proofs`, `payments`, `tracking_events`, `driver_locations`,
  `ledger_entries`).
- `payment-proofs` storage bucket exists and is **private** (keep it private — proofs are served
  via signed URLs).
- Supabase: the current project is **provisioned via the Vercel Marketplace** (billing managed by
  Vercel). Since we are dropping Vercel for Hostinger, migrate to a **standalone Supabase account**
  and upgrade *that* project to Pro — see [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md).
