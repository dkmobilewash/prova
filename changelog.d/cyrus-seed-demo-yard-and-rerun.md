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
`assignedJobId` — and the run below confirms it against a real database.

An earlier draft of this entry said the seed was NOT executed on this
branch. No longer true: the full lifecycle ran on `ep-icy-hat-afqau56u`
(2026-09-11, after rebasing onto the day's `main`), and every leg was
verified by querying rather than by reading the script's own success
message. In order: a seed run against existing demo data REFUSED with
exit 1, naming all nine non-zero families and the exact `--undo` command,
writing nothing; `--undo` removed the whole set with zero FAILED deletes —
including 2 `InvoiceCounter` rows, the #227 RESTRICT-on-Job hazard, so
today's counters are covered; a fresh seed then wrote 8 equipment,
8 `EquipmentAssignment` rows, 5 of them open stays on jobs (the #147
evidence — the yard is populated and the texture rig sits on finished
Cedar); an immediate second run hit the refusal again, exit 1. The one
non-demo job ("ZZ FIXTURE …") and contact survived the whole cycle,
counted before and after. Three of the five mutations were re-run after
the rebase (family dropped, gate inverted, blind create restored) — three
red, baseline green.

One correction to the plan this rode in on: `clean-scratch-data.mjs` is
NOT the demo remover and refuses (by design) while `[demo]` jobs exist —
demo removal is `seed-demo.mjs --undo`; clean-scratch removes rows a
PERSON typed and would have deleted the fixture rows the cycle had to
protect. It was exercised in list-only mode on both sides of the undo:
refused while demo data was present, listed only the fixture rows after.
