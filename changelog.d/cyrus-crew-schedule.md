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
