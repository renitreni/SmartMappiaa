# Security to-do (notes)

> **Notes only** — things to review/harden before production.
> Local doc (kept out of the repo with the rest of `docs/production/`).
> When ready to act, turn each item into a ticket.

## Done (24 June 2026)
- Helmet security headers + rate limiting (general + stricter on `/api/auth`) — `backend/app.js`.
- Central error handler + controller error-message sanitization — no raw DB/internal errors returned
  to clients (`backend/app.js`, all `backend/controllers/*.js`).
- CORS made env-configurable via `CORS_ORIGINS` (allow-all only when unset) — `backend/app.js`.
- `createBooking` input hardening (valid datetime, numeric coordinates) — `bookingsController.js`.
- Production source maps disabled — `frontend/vite.config.js`.
- `npm audit` clean on frontend and backend.
- `payment-proofs` bucket is private with short signed-URL TTLs.

Still open below (the items needing the standalone Supabase, Hostinger, Tap, or a go-live decision).

## Audit pass — 1 July 2026

Done this pass:
- **RLS confirmed ON** for all tables (owner/driver/admin policies + `is_admin()`, from
  `0001_init_smart_mappia.sql`). Re-verify on the standalone Supabase after migration.
- **Per-endpoint rate limiting added** — `backend/middleware/rateLimiters.js`, wired into
  bookings/tracking/driver routes: proof upload 10/min, public lookups (booking + tracking) 60/min,
  driver accept 20/min, driver location 30/min. Verified live (429 fires). Layered on the global 120/min.
- **IDOR review:** `cancelBooking` already checks owner-or-admin (`bookingsController.js`). Payment-proof
  and public lookup endpoints are code-gated by design (guest pay-by-link) — hardened via the new rate
  limits + adequate code entropy (see below). Driver actions verify `assigned_driver_id`. Admin routes
  behind `requireAdmin`.
- **Booking-code entropy:** `gen_booking_code()` = 31-char unambiguous alphabet x 8 (~40 bits, unique).
  Adequate with rate limiting. Optional future: `gen_random_bytes()` for crypto-grade codes.
- **Payment auto-verify turned OFF** (`AUTO_VERIFY_STCPAY_TEST_MODE=false`, `PAYMENT_MODE=stcpay_manual`);
  admin manual verification tested end-to-end (passes).
- **Online payment gateway (Tap) off** via `VITE_TAP_ENABLED=false` ("coming soon" placeholder kept).

CRITICAL — found this pass, still open:
- [ ] **Frontend was shipping the SERVICE_ROLE key.** `VITE_SUPABASE_ANON_KEY` in `frontend/.env`
  decodes to `role: service_role` (same token as the backend). `VITE_*` compiles into the browser
  bundle, so this exposes full DB access and nullifies RLS. `.env` is gitignored (not leaked via git),
  but before ANY build/deploy: replace it with the real ANON key (decodes to `role: anon`) from the
  Supabase dashboard, and ROTATE the service_role key, then update `backend/.env`. A warning comment
  is in `frontend/.env` above the key.

Driver-approval note:
- Migration `0004` (pilot auto-approve) was **NOT applied** to the current Supabase (column default
  `driver_approved = false`), so no DB reversal is needed. But drivers are still auto-approved
  **in code** (`authController.js`); revert that line at launch (see LAUNCH_CHECKLIST + PICK_AND_DROP §4).

## Critical

- [ ] **Confirm Supabase Row Level Security (RLS) is ON for every table, with correct policies.**
  The anon key is public (it ships in the frontend bundle), so without RLS anyone could read/write
  the database directly. The backend uses the `service_role` key, which *bypasses* RLS, so gaps are
  easy to miss. Verify this on the new standalone project after migration.
- [ ] **Keep the `service_role` key backend-only.** Never put it in a `VITE_` var or any frontend
  code — frontend gets the **anon** key only. (Currently correct; keep it that way and rotate keys
  if one was ever shared/exposed.)
- [ ] **Turn off `AUTO_VERIFY_STCPAY_TEST_MODE`** (also in LAUNCH_CHECKLIST.md). While on, a fake or
  blank "proof" auto-confirms a paid booking.
- [ ] **Re-enable driver verification** (also in LAUNCH_CHECKLIST.md). While auto-approve is on, an
  unvetted driver can accept real rides.
- [ ] **Booking codes must be unguessable.** `/track/:code` and `/pay/:code` are open by code (no
  login) and expose trip details + contact info. Confirm codes are random with enough entropy, and
  rate-limit lookups to prevent enumeration.

## High

- [ ] **Lock down CORS** to the production frontend origin(s) — not `*`. Mechanism is in place
  (`CORS_ORIGINS`, allow-all only when unset); set the prod origin value at launch.
- [x] **Rate limiting** — done (general + stricter on `/api/auth`, `backend/app.js`). Tune per-endpoint
  limits (booking, proof-upload, tracking) if abuse appears.
- [x] **Sanitize backend error messages** — done (central error handler + controller sanitization,
  `backend/app.js`); no raw DB/internal errors reach the client.
- [ ] **Force HTTPS.** Helmet security headers are done; still add the HTTP→HTTPS redirect at Nginx on
  the VPS.
- [ ] **Protect OSRM.** If self-hosted OSRM is reachable from the browser, restrict/proxy it so it
  isn't an open, abusable (and costly) routing endpoint.
- [ ] **Strong admin/driver secrets.** No default values for `ADMIN_API_KEY` / `DRIVER_API_KEY`,
  set `ADMIN_EMAILS` correctly, and rotate seed-account passwords (admin123/user123/driver123)
  before launch.

## Medium

- [ ] **Server-side input validation** on all requests (booking fields; confirm proof upload mime
  type and `PAYMENT_PROOF_MAX_BYTES` are enforced server-side, not just client-side).
- [ ] **Audit logging** for admin actions (payment verify/reject, driver approval) and payment events.
- [ ] **`npm audit`** on both frontend and backend; patch known vulns; keep dependencies current.
- [ ] **Storage hygiene.** Keep the `payment-proofs` bucket private (verified) and keep signed-URL
  TTLs short.
- [ ] **Session/account safety.** Consider login attempt throttling, a password policy, and the
  idle-session timeout idea (warn then auto-logout after inactivity) once out of testing.

---

## Reference checklist: common vulnerabilities in AI-generated apps (via jp_mather)

> Audit the app against each before production. `[see above]` = already captured in our notes;
> short notes added for the ones specific to this stack (Supabase + Express + Vite + STC Pay).

1. [ ] Exposed database credentials — keep `service_role` backend-only; rotate if ever leaked. [see above]
2. [ ] Public `.env` files — keep `.env` gitignored and out of the repo (currently OK).
3. [ ] Hardcoded API keys — all keys via env vars, none in source.
4. [ ] Weak or missing authentication — Supabase Auth + JWT; enforce on every protected route.
5. [ ] No authorization checks — confirm role guards on all admin/driver routes (`requireAdmin`, `requireApprovedDriver`).
6. [ ] Users able to access other users’ data — RLS + booking-code IDOR. [see above]
7. [ ] Open database read/write permissions — enable RLS on every table. [see above]
8. [ ] Misconfigured Supabase/S3 buckets — `payment-proofs` is private (verified); audit storage policies.
9. [ ] Admin routes left unprotected — verify every `/api/admin/*` sits behind `requireAdmin`.
10. [ ] Debug pages exposed in production — ensure no preview/test/debug routes are public.
11. [ ] Build logs leaking secrets — ensure Vercel/CI build logs don’t print env values.
12. [ ] Verbose error messages leaking stack traces — sanitize backend errors. [see above]
13. [ ] Leaked GitHub repos / commit history — keep repos private; scrub any secrets from history.
14. [ ] Secrets in frontend JS — only the `VITE_` anon key ships to the browser; never service_role. [see above]
15. [ ] Client-side-only security checks — every check must also be enforced server-side.
16. [ ] Missing input validation — validate all request bodies server-side. [see above]
17. [ ] SQL injection — use the Supabase client / parameterized queries; never concatenate user input into SQL.
18. [ ] NoSQL injection — N/A (Postgres) but still validate inputs.
19. [ ] XSS — React escapes by default; the legal modal uses Swal `html` with **static** content only — never feed user input into `html`/`dangerouslySetInnerHTML`.
20. [ ] CSRF — auth is Bearer-token (not cookies), which avoids classic CSRF; if you add cookie auth, set SameSite.
21. [ ] Insecure file uploads — enforce mime + `PAYMENT_PROOF_MAX_BYTES` server-side; bucket private. [see above]
22. [ ] Path traversal — storage paths come from the server-issued signed URL, not user input — keep it that way.
23. [ ] SSRF — don’t let user-controlled URLs drive server-side fetches (e.g. routing/OSRM calls).
24. [ ] Broken password reset flow — uses Supabase Auth; test reset end-to-end.
25. [ ] Weak session management — Supabase session in localStorage; consider idle timeout. [see above]
26. [ ] JWT secrets weak/leaked/reused — Supabase signs JWTs; don’t expose, rotate on key changes.
27. [ ] Overly permissive CORS — lock to the prod frontend origin. [see above]
28. [ ] Rate limits missing (login/signup/APIs) — add rate limiting. [see above]
29. [ ] Public test/staging environments — protect the test env (no real data, not indexed, basic auth if possible).
30. [ ] Default credentials — rotate seed passwords (admin123/user123/driver123). [see above]
31. [ ] Webhook endpoints without signature verification — verify signatures when real STC Pay/payment webhooks are added.
32. [ ] Payment checks only on frontend — payment verification is server-side today (good); keep it server-side.
33. [ ] IDOR — `/track/:code` and `/pay/:code` open by code; ensure codes are unguessable. [see above]
34. [ ] Endpoints trusting user-controlled IDs/roles — role is derived server-side from the JWT/profile (good); never trust role from the request body.
35. [ ] Logs containing tokens/PII — scrub tokens, emails, phone numbers from logs.
36. [ ] Source maps exposed in production — disable or restrict source maps in the prod Vite build.
37. [ ] Dependency vulnerabilities — `npm audit` (frontend + backend). [see above]
38. [ ] Outdated packages — keep dependencies current.
39. [ ] Prompt injection in AI features — N/A (no AI features currently).
40. [ ] AI tools accessing data without checks — N/A currently.
41. [ ] Excessive DB permissions for app user — backend uses `service_role` (full) which is acceptable server-side; ensure the public `anon` role is minimal via RLS.
42. [ ] No audit logs — add audit logging for admin/payment/driver-approval actions. [see above]
43. [ ] No monitoring / alerting — add basic uptime + error alerting.
44. [ ] No backup / restore plan — Supabase Pro has daily backups; on free, plan periodic manual dumps.
45. [ ] Publicly exposed internal dashboards — admin portal must stay behind auth.
46. [ ] Missing security headers — add Helmet/CSP/HSTS. [see above]
47. [ ] Cookies missing HttpOnly/Secure/SameSite — auth uses localStorage tokens, not cookies; note localStorage is XSS-exposed, so #19 (XSS) is the mitigation. Set flags on any cookies you add.
48. [ ] Unencrypted sensitive data — HTTPS in transit (Certbot/Supabase); Supabase encrypts at rest.
49. [ ] Poor tenant isolation in multi-user apps — per-user isolation via RLS. [see above]
50. [ ] Over-trusting generated code without review — review before launch (this checklist is that review).
