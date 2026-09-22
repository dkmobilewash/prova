### `sendOutboundEmail` had no capability gate and no rate cap — either any member, unlimited (Cyrus)
`cyrus/outbound-email-capability`

Issue #352, item 1. `sendOutboundEmail` (`lib/actions/messages.ts`) called
`requireCompanyContext()` and nothing else — no capability check, no rate
limit. Any member of any company could send unlimited email from the
shared `cstream.ai` sending domain. One abusive or careless account on a
domain every C Stream customer sends through degrades deliverability for
all of them, and sender reputation recovers slowly, if at all.

**Why it wasn't simply gated.** The obvious derivation gives
`MANAGE_JOBS` — the `send_email` Ask command already declares it
(`cyrus-action-capability-guards`'s own note recorded this exact gap
rather than papering over it). But `lib/actions/help.ts` calls the SAME
action for the in-app "Ask us for help" form, and gating it on
`MANAGE_JOBS` would silently close the support channel for ACCOUNTING and
PAYROLL_COMPLIANCE members. A support channel closing quietly is worse
than the bug being fixed.

**The fix is a split, not a gate.** The GC-facing correspondence path and
the internal "contact support" path are different features that happened
to share one action. They now share an unexported `deliverEmail` — the
write-ordering logic from #111 (message row and QUEUED event written
BEFORE the provider call), unchanged — behind two entry points:

- `sendOutboundEmail`, the composer on `/messages` and the Ask
  `send_email` handoff, now gated on `MANAGE_JOBS`, checked before
  anything is read or written.
- `sendHelpRequestEmail`, `help.ts`'s only way to reach a human. No
  capability check — every member may ask for help — and safe to leave
  open because its signature has NO recipient argument at all: the
  support address is derived inside the function, from
  `readSupportAddress`, every time. There is no parameter a caller could
  use to redirect it, enforced in code rather than by help.ts's own care
  in building a FormData.

**A per-company daily rate cap**, `lib/outbound-email-limit.ts`: 100
emails per company per rolling 24 hours, on the outward path only —
excluded are help requests (never compete with a company's own
correspondence for this ceiling) and the alert digest (no `sentByUserId`
at all). **Fails CLOSED**, deliberately the opposite of `lib/ask/usage.ts`'s
`askAllowance`, which fails open because the alternative there is an
internal accounting table taking the whole assistant down over a database
hiccup (#257) — the worst case of answering unbounded is a bigger model
bill. Here the worst case of answering unbounded is unmetered mail to real
GCs from a shared domain at the exact moment the counter meant to stop
that cannot be read, which is worse than a send button not working for a
few minutes.

No schema change: the cap counts existing `OutboundMessage` columns
(`channel`, `sentByUserId`, `relatedType`, `createdAt`), no migration.

**Mutation-tested**, eight guards, eight caught by the intended test,
each restored and reconfirmed green: the `MANAGE_JOBS` check, the rate-cap
check, the rate cap's fail-closed branch, its `>=` boundary, its
help/digest exclusion filter, the help path's forced recipient, an
accidental capability gate on the help path, and an accidental rate cap on
the help path.

Full unit suite (344 files / 5663 tests) green, `tsc --noEmit` clean,
`next lint` clean (pre-existing warnings only), `./scripts/preflight.sh --quick`
passed. `next build` compiles and lints clean; it fails only on the
documented fresh-worktree `.env` gap (`Missing publishableKey`,
`DATABASE_URL is not set`), not on anything in this diff. The `test:db`
suite was not run — no scratch Postgres available in this session; not
claimed to pass.
