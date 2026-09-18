### Who is on tomorrow — a crew schedule with a date on it (Cyrus)
`cyrus/crew-schedule`

A hundred-question census against the Ask registry left seven questions
nothing could answer. **Two of them were the same missing model**, and
finding that took reading `JobAssignment` rather than assuming:

```
model JobAssignment { jobId, userId, createdAt }
```

**There is no date on it.** It is a roster — everyone attached to a job —
and that is why *"who is on Riverside tomorrow?"* had no answer. The
dangerous part is that `crew_assignments` answers in exactly the right
SHAPE, so a foreman reads a list of names as tomorrow's crew.

*"Whose hours haven't been turned in?"* is the same hole from the other
side. `TimeEntry` has no submitted or approved state, so nothing separates
a man who did not hand hours in from a man who did not work. Give it a
**planned** day and that stops being a guess and becomes a join.

`CrewScheduleDay` — one job, one worker, one day, planned. One migration,
two questions.

## The `attended` column that is deliberately not there

Whether somebody worked a planned day is **derived** — a `TimeEntry` for
that job, that worker, that date — because this schema's standing rule is
that derived state is never stored. Here the disagreement would *be* the
answer: a planned day with no hours IS the missing timecard, and an
`attended` flag somebody forgot to tick would manufacture one.

**Every label says the same thing and it is chosen carefully.** A planned
day with no hours means *nobody logged that day*. It does **not** mean the
person did not work. "Marco did not work Tuesday" is a claim about a man;
"nobody logged Marco's Tuesday" is a claim about paperwork. Only the second
is supported, so the row, the tool, the page and the `KNOWN_GAPS` entry all
say the second.

And the honest limit, stated rather than left to be assumed: this only sees
days somebody actually **put on** the schedule. An empty list is not proof
that every hour was logged.

## It carries the XOR, because of `allow_crew_time_entries`

A schedule keyed on `User` alone could not schedule the no-login crew,
which for a union sub is most of the field. So it names a `User` **or** a
`CrewMember`, never both — the same CHECK `TimeEntry` took in #292.
`onDelete: RESTRICT` on both, and that is a technical reason rather than
taste: `SET NULL` would leave both columns null and violate the CHECK, so
the delete fails either way — RESTRICT just makes the refusal readable.

It lands on `/schedule`, whose own empty state has always promised *"you
can see the week a second job wants the same three hangers as the first"*
and could not deliver it. **No new route, no `navItems.tsx` entry, no
`middleware.ts` change.**

## A sentence that went false in this diff, corrected in it

`crew_assignments`'s description said *"there is no per-day crew
schedule"*. There is one now, so it was corrected rather than left — a
claim about what the app does **not** have expires exactly as fast as a
claim about what it does, which this repo has paid for twice.

A new `KNOWN_GAPS` entry takes its place, because one real gap survives
underneath: **attendance is still not recorded anywhere.** Planned is not
present, and hours are not a register.

## Three censuses caught this PR, and one of them was wrong

- **The job-picker census** caught the new `<select>` rendering a bare
  `job.name`. That is twice now this census has found a new picker rather
  than a reviewer finding it. Count moved 23 → 24, deliberately, as a
  literal.
- **The cleanup-order guard** — `CrewScheduleDay` is a RESTRICT child of
  `Job`, so it takes the #227 edits: the model, `HANDLED_MODELS`, and the
  `del(...)` order in **both** cleanup scripts. Mutation-tested: removing
  the `del()` call turns it red and names the model.
- :warning: **The destructive-form census reported a CREATE form as a
  one-click delete, and the census was at fault.** It treats any
  `const x = <expression referencing a destructive action>` as an alias of
  that action. But `const result = await unscheduleCrewDay(id)` is the
  **value that came back**, not a callable — while `const deleteXWithId =
  (id) => deleteX.bind(...)` genuinely is one. `result` is the most common
  local name in this codebase and **CLAUDE.md's own error rule produces
  it**: actions return `ActionResult` and forms render it, so any component
  that both creates and deletes writes it twice. The first registered
  `result` as destructive for the whole file; the second — the "put someone
  on" form — was then reported as a one-click delete.

  Declarations whose right-hand side starts with `await` are skipped now.
  Mutation-tested in both directions: a real one-click delete and a real
  callable alias both still turn it red. A census that fires on correct
  input is one somebody switches off, which is how the eleven real
  one-click deletes it exists for would come back.

## Checks

Additive migration, hand-written on single lines (`migrate dev` still
cannot run against `ep-icy-hat`). No backfill, deliberately: a past day's
plan cannot be recovered from the hours logged against it, and inventing
rows from `TimeEntry` would make every historic day retroactively "as
planned" — the one answer this table exists to stop being assumed.

13 tests on the derivation, 5 mutations each red then restored — including
the one that matters most: **hours logged on a DIFFERENT job must not
satisfy a plan**, because a man moved to another site is exactly the case
somebody is looking for.

## Clicked through, and it found three defects a green build could not

Every one of these passed typecheck, lint, 3,268 tests and a full build.

1. :warning: **A successful write showed an empty list** — this repo's own
   issue-#61 shape, and unlike #61 the cause is known and was mine. The
   board held `useState(upcoming)`, kept so a removal could filter a row
   out optimistically. `useState` takes an INITIAL value and ignores props
   on every later render, so after a create the action revalidated, the
   server sent fresh props, and the list went on rendering the empty array
   it was born with. The row was in the database and the screen said
   "Nobody is on the schedule for the next two weeks." Now rendered from
   props; the revalidate drives both create and remove.

2. :warning: **The date field defaulted to the SERVER'S day, not the
   user's.** The click test ran at 18:04 Mountain, where UTC is already
   tomorrow — so the form pre-filled 09-18 for a foreman whose day was the
   17th. `components/localToday.ts` exists for exactly this and its own
   comment describes the case; the form is mounted by a click, so calling
   it during render is safe.

3. :warning: **The duplicate guard threw instead of speaking, and hit the
   error boundary.** The second submit gave "This page didn't load …
   reference 2348556877" on a form whose whole job was to say one readable
   sentence. `err instanceof Prisma.PrismaClientKnownRequestError` is FALSE
   at runtime even though the server log printed
   `Error [PrismaClientKnownRequestError] … code: 'P2002'`.
   `isUniqueConstraintError` in `lib/actions/shared.ts` already existed for
   this and its comment says instanceof is false here, measured
   2026-08-28. Written, documented — and not called by me.

**And one "defect" that was the test being wrong.** A planned day on 09-11
did not appear as missing hours, which looked like a broken join until the
database was asked: Cyrus has 8 hours logged on Riverside that day, so the
day IS covered. That accidental control is better evidence than the check
it replaced — 09-11 has hours and is absent, 09-14 has none and is present,
same person, same job, same query.

**All seven steps verified in the browser**, plus the XOR proved against
real Postgres (`23514 … violates check constraint
"CrewScheduleDay_user_or_crew"`). The best of them is the last: asked
*"whose hours haven't been turned in?"*, the assistant routed to
`crew_schedule` and carried the wording discipline into its own prose —

> One planned day has no hours logged against it.
> • Cyrus Oliveras — Riverside Medical Office Building, 2026-09-14
> **That means nobody logged that day, not that he didn't work.** Also note
> the schedule only shows days somebody actually put on it.

Both caveats survived from the tool description into the answer, which is
the whole reason they are worded on the row rather than in a preamble.

Test rows were created on `ep-icy-hat` during the pass and deleted in the
same sitting; `CrewScheduleDay` is back to 0.
