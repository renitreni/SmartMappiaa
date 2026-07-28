# Database Audit Playbook — reusable 5-agent review

A repeatable recipe for a from-scratch database + backend audit using five independent
review agents (personas). Re-run it before a release, after schema changes, or whenever
you want fresh assurance. The last run's output is `docs/food-delivery/DATABASE_AUDIT.md`.

## When to run
- Before any production deploy / launch gate.
- After adding or changing migrations (new tables, columns, enums, RLS).
- Quarterly, as a health check.

## How to run (in Claude Code)
Ask Claude: **"Run the database audit playbook."** Claude then:
1. Launches the **5 read-only agents below in parallel** (general-purpose subagents).
2. Waits for all five, then **verifies each finding against the actual files** (no
   unverified claims) and **dedupes** overlaps.
3. Writes a severity-ranked report to `docs/food-delivery/DATABASE_AUDIT.md` with a clear
   production verdict + ordered remediation list.

Rules for every agent: **read-only** (never edit), **cite file:line**, **verify against
the real files** — do not hallucinate. Scope = `backend/migrations/*` cross-checked
against `backend/` code (controllers, lib, routes, middleware).

## The 5 agents (copy-paste prompts)

Repo root to give each agent:
`d:\SmartMappia\V1 (old)\smartmappia-web-main\smartmappia-web-main`

### Agent 1 — Security engineer
> Read-only security audit. For every table, confirm RLS is enabled and policies are
> correct and not over-permissive (clients must NOT be able to insert/update money tables
> — orders, payments, ledgers — those are service-role only). Check access-control/IDOR in
> the controllers (ownership on customer endpoints, `requireAdmin` on admin routes, driver
> actions verify the job is theirs). PCI: no card number/CVV/expiry stored or logged
> anywhere (only tokens/txn ids); webhooks verify signature + reject when unconfigured;
> payment confirmation idempotent. Secrets: confirm the `service_role` key is backend-only
> and never in a `VITE_*`/frontend var (check `frontend/.env`, `vite.config.js`). Injection:
> no string-concatenated SQL; `ilike` wildcards escaped; audit logging on privileged
> actions + PII reads. Return severity-ranked VERIFIED findings (CRITICAL..LOW) with
> file:line + a one-line fix each, then a one-line verdict.

### Agent 2 — Database architect (code↔schema parity)
> Read-only parity audit. Enumerate every `.from('<table>')` and every column
> selected/inserted/updated in the backend; confirm each table+column is DEFINED in a
> migration. List anything the code uses that is MISSING (production-breaking). Verify FK
> `ON DELETE` behavior (financial roots RESTRICT; children CASCADE; soft refs SET NULL),
> constraints (unique/check/not-null), enum values (every written value is defined),
> snapshot design, and migration ordering (no forward refs; base helpers available).
> Return severity-ranked VERIFIED findings + a one-line verdict on parity/correctness.

### Agent 3 — DB developer (lean / over- & under-engineering)
> Read-only scope audit. Grep for usage of each table/column: which are DEFINED but never
> used by code (decide intentional-roadmap vs dead)? Redundant/duplicate indexes or
> constraints; redundant migration re-assertions. Then the inverse — what does the product
> need that the schema LACKS (unconstrained free-text where an enum belongs, missing index
> on a filtered column, missing NOT NULL/default)? Return two lists (over-engineered /
> missing), VERIFIED with file:line, then a one-line verdict: appropriately scoped, bloated,
> or incomplete?

### Agent 4 — DBA / production-readiness
> Read-only readiness audit. Indexing vs the REAL hot query paths (search, admin order
> lists, history, ledger, dispatch, open-pool) — flag missing/pointless indexes. Migration
> order + idempotency (guarded enums, if-not-exists, re-runnable; the `alter type add value`
> trap). Money integrity (numeric types; non-negative checks; concurrent-write / double-
> charge protection via compare-and-swap). Data lifecycle (unbounded tables without
> retention; backups). Performance foot-guns (N+1, seq scans, unindexed FKs). Return
> severity-ranked VERIFIED findings + a one-line readiness verdict.

### Agent 5 — CTO / money-model + launch risk
> Read-only business-risk review. Does the schema cleanly support the current/next money
> model, and exactly what must change (columns, enum values, where money is charged/accrued,
> what can be reused vs added)? What breaks if a partial change ships? Live-DB migration
> safety (additive/nullable). Launch gates (secrets, auth/approval defaults, test-mode env
> flags). Return (A) precise change list, (B) severity-ranked risks, (C) one-line CTO
> verdict on production + money-model readiness. VERIFIED with file:line.

## Output
A single `DATABASE_AUDIT.md`: headline verdict → severity-ranked findings table →
"what's strong (verified)" → money-model readiness → ordered remediation (pre-launch
blockers vs. next-migration hardening).

## Notes
- Five agents give independent coverage; overlaps are a feature (corroboration). The lead
  (Claude) is the sixth lens: it dedupes, re-verifies, and assigns final severities.
- Keep the audit OUTPUT (`DATABASE_AUDIT.md`) mindful of disclosure: it lists live
  weaknesses. If the GitHub repo is public, treat it as sensitive.
