### #257 was already fixed four days before it was assigned — AUDIT, docs only (Cyrus)
`cyrus/ask-usage-missing-audit` — issue #257

Assigned as a pilot-deadline fix: "Ask dies entirely when AskUsage is
missing, behind a message that names nothing." **Could not reproduce, and
the reason is that nothing was left to reproduce.** `9b62e78` (PR #273,
"...surviving a database behind the code — #257", merged 2026-09-15 —
four days before this session started) already shipped the fix. The
issue stayed open on GitHub; nothing in this repo's docs said so, which
is the same shape as the stale-claim entries CLAUDE.md already carries
for the one-Neon-project sentence and the "invoice numbers come from a
counter" line — a claim that was true and then wasn't, left standing.

**What #273 did, read from `apps/web/lib/ask/usage.ts` on `main`:**
`askAllowance` counted `AskUsage` rows on every ask for the rate limit;
a missing table (`P2021`, the table drifted a migration behind) threw,
and every question died behind "Something went wrong reading your data"
— the issue's exact repro. The fix wraps only the two `count()` calls in
a try/catch, fails OPEN (`return { ok: true }`) with a `console.error`
naming the table and `pnpm --filter @prova/db run migrate:deploy`
(`MIGRATE_COMMAND`), and extends the same treatment to `usageSummary` —
`/settings/assistant` now shows a `readable: false` red sentence naming
the same fix instead of a reassuring "0 questions", which the page's own
comment calls out as the more dangerous failure (a quiet month looks
identical to a broken table). `usage.dbtest.ts` reproduces the original
defect against a real Postgres by renaming `AskUsage` out of the way and
back in a `finally`, rather than only mocking a P2021.

**Verified independently rather than trusted**, since the PR's own body
says "NOT CLICKED" / "Nobody has clicked it," and CLAUDE.md's prime
directive is result over claim:

- Read the shipped code and both test files end to end; the shape
  matches every requirement of #257 (fails open, names the table and the
  fix, does not report zero on a broken settings page, does not widen the
  limiter into a no-op — #353 already tracks the fail-open tradeoff
  itself as a separate, later decision and is untouched here).
- Full `apps/web` suite green on a fresh worktree off `origin/main`
  (`f969900`): 320 files / 5220 tests, typecheck clean, lint clean (only
  pre-existing unrelated warnings), production build exit 0, preflight
  green, no pending migrations.
- **Three mutations run by hand against `askAllowance`/`usageSummary`,
  restored via `git checkout` after each, 3 requested / 3 caught:**
  1. fail CLOSED instead of open in the catch → both #257 degradation
     tests in `usage.test.ts` went red (`expected {ok:false,...} to
     equal {ok:true}`), confirming the fail-open path is actually load-
     bearing rather than vacuous.
  2. off-by-one on the refusal boundary (`>=` → `>` on
     `perPersonPerHour`) → both boundary tests went red, including "still
     refuses at the limit when the count works, so failing open did not
     disarm the bound" — the specific regression test guarding against a
     catch wide enough to swallow a real refusal.
  3. `usageSummary`'s error handler returns `[]` instead of `null` →
     "reports that it could not read, rather than reporting zero" went
     red with `readable: true` where `false` was expected — reproducing
     exactly the "reassuring zero" failure mode the page's own comment
     warns about.
- Could **not** execute `usage.dbtest.ts` — the real-Postgres
  reproduction that renames `AskUsage` away and back — because this
  sandbox has no local Postgres, no Docker, and no `pg_ctl`/`psql`, and
  the task's own constraint forbids pointing at any real database. Read
  it end to end instead: it creates a scratch company/user, asserts
  `askAllowance` returns `{ ok: true }` and `usageSummary().readable` is
  `false` while the table is renamed away, restores the table in a
  `finally` so a failed assertion cannot strand it, and re-asserts
  `readable: true` afterward to prove the rename was what the middle
  assertions were reading. This is a documented gap in what this session
  verified, not a claim that the test passed.

**No code changed.** Opening this as the audit exception CLAUDE.md
carved out 2026-09-07 for precisely this shape: correcting a stale claim
(the open issue) and recording what was eliminated (a reproducible crash
— there is none on `main` today), rather than riding a docs note on a
capability nobody built this session.

**Recommendation, not acted on here:** close GitHub issue #257
referencing #273 as the fix and this entry as the independent
re-verification, so the next person who greps open issues for AI-lane
work does not re-open a fix that already shipped.
