### The demo seed now refuses to run twice instead of duplicating half a database (Cyrus)
`cyrus/seed-demo-yard-and-rerun`

Run against a company that already had demo data, `seed-demo.mjs`
duplicated the equipment and then died half-finished on the
prevailing-wage exclusion constraint — those effective-date ranges are
computed relative to today, so a second run's range always overlapped the
first run's. Everything before the failure committed, everything after did
not, and `/equipment` reading "16 items" afterwards looked exactly like an
app bug. Issue #180, found by actually running it on `ep-icy-hat`.

Both fixes the issue asked for, together:

- **The seed refuses upfront** when the company already carries
  `[demo]`-tagged rows, checked per family (contacts, jobs, vendors,
  equipment, rule sets, catalog entries, quotes, bids, messages) rather
  than in total, because a failed run or a partially failed `--undo`
  leaves SOME families and not others. The refusal names the exact
  command to run instead — `--undo`, then seed again — and writes
  nothing. `--force` seeds a second copy on top, on purpose, and says so.
- **The landmine itself is gone**: prevailing-wage rule sets are
  find-or-create on their natural key (company, jurisdiction, tagged
  name), never a blind create. Prisma cannot `upsert` against an
  exclusion constraint — it is not a unique key and the client does not
  know it exists — so the lookup is spelled out.

The check that proves it: `apps/web/lib/seed-reseed-guard.test.ts` reads
the script as text and pins the guard's family set exactly, requires the
guard to sit before the first write and after the `--undo` branch, allows
exactly one `prevailingWageRuleSet.create` in the file (the helper's), and
derives from the undo path which families are tag-scoped — with the
occurrence count asserted independently of the pattern, per the
scratch-cleanup-order rule — so a new tagged family added to undo without
a matching guard count goes red by name. Five mutations run, five red:
family dropped from the guard, refusal gate inverted, blind create
restored, a write moved above the guard, and a tag-scoped family added to
undo behind the guard's back.

Issue #147 (the empty yard) needed no code here: PR #175 already landed it
on `main` — the seed writes real `EquipmentAssignment` rows, never
`assignedJobId` — and issue #180's own measurements against a real
database confirm it. The issue is simply still open.

Stated plainly: the seed was NOT executed against any database on this
branch. The refusal path, the `--force` path and the re-run are exactly
what the click-list has to settle, on `ep-icy-hat`.
