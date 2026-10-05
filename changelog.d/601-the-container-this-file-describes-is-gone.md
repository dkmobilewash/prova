### Two documented container limits, re-measured and both expired (Cyrus)

`cyrus/sales-signals`

Docs-only, and it qualifies under the audit exception (Diego, 2026-09-07): two claims in
`CLAUDE.md` about what an agent container can do are now false, both verified against the
container rather than argued, and there is no accompanying code change for them to ride along
with. Flagged as docs-only here because that flag is the only check on whether an audit
qualifies.

**It was not curiosity.** The container restarted mid-session and took `node_modules` and the
scratch Postgres cluster with it, so the harness had to be rebuilt before the suites this
branch depends on could be re-run. Everything below fell out of that rebuild.

**One — `pnpm install --frozen-lockfile` completes.** The entry said it dies on
`ERR_PNPM_FETCH_403` fetching `xlsx-0.20.3.tgz` because `cdn.sheetjs.com` is not on the egress
allowlist, aborting with nothing linked into `apps/web/node_modules`. That host now answers
**HTTP 200** with 2,409,319 bytes of real 26-entry gzip tarball, and the install exits 0 in
31.9s with `apps/web/node_modules` populated and the Prisma client generated. So the
`--filter @prova/db` workaround is no longer the ceiling — the real `vitest` and a real `tsc`
both run here.

Deliberately NOT claimed: why the host answers. An allowlist change and a transient 403 on
4 October both fit, and nothing measured here separates them. Also not claimed: that a cold
pnpm store completes. The store predates today and was not cleared, because clearing it to
settle a documentation question would have destroyed the working install the run needed. The
reachable host is what is settled, and it is the cause the old entry named.

**Two — and this is the one that would have misled somebody.** The TS5081 entry says "empty
filter plus a count of ZERO is the vacuous case". True with no `node_modules`, where zero lines
could only mean the compiler never ran. With dependencies present a clean project typecheck
emits **nothing at all**, so that sentence tells a reader to distrust a genuine pass and go
hunting for a broken invocation. A stale claim pointing at a capability that is MISSING is the
direction that stops people looking — the same shape as the Clerk-secrets paragraph and the
preview-reachability bullet, each of which was honest on the day and read later as a property
of the world.

The fix is not a new number. It is that **the line count was never the signal — the control
was**: `const __control: number = "not a number"` appended to `lib/sub-listing/signals.ts`
reports `signals.ts(440,7): error TS2322`, and removing it returns 0 lines. That control is
the part of the original entry that survives unchanged, and it is what makes a silent zero
readable in either container. The filter and the count were scaffolding around one broken
environment and they dated in a day.

**A smaller thing worth one clause.** The db-suite recipe is right that the Postgres data
directory must live where the `postgres` user owns it. The sharper version is that a cluster
under the scratchpad does not survive a restart: `/tmp/claude-0` comes back `drwx------`, so
`initdb` fails with `could not access directory` naming the data directory rather than the
parent that actually refused. `/var/lib/postgresql/<name>` costs one `initdb` and one
`prisma migrate deploy` instead.

**The limit that has not moved** is the signed-in e2e suite, which needs Clerk's `sk_test_` —
a credential, so it does not travel through an agent channel. The Turnstile paragraph already
establishes that the gate was never the network, and nothing here changes it.

Verified after the rebuild, each against its own baseline: db suite 61 of 61 against a scratch
Postgres carrying `main`'s new migration, censuses 487 of 487, the e2e library gates 85 of 85,
and the project typecheck 0 lines with the control firing.
