### The walls are already found when you open the sheet

Accepting a scale now finds the walls by itself, and they are still there when
the estimator comes back. Two presses out of the nine-step workflow, and the
second one was the expensive kind: the detection ran again from scratch every
time somebody returned to a sheet.

Nothing about ACCEPTING changed. A found wall is still a proposal, accepting a
group is still one press, and it still writes a `TakeoffMeasurement` — the line
this feature exists to keep is that found is not chosen.

### `TakeoffWallProposal`

One row per wall GROUP, keyed `[pageId, calibrationId]`, cascading from both.

**Keyed on the calibration, which is what makes invalidation free.** Wall
geometry means nothing without the scale it was measured at, so a proposal
belongs to a calibration the way a measurement does. Recalibrating INSERTS a
calibration, so proposals found under the old one are simply never read again —
no `staleAt` column, no sweep, nothing to forget to run.

**Both foreign keys CASCADE, explicitly**, because Prisma's default for a
required relation is RESTRICT. That would be the #227 trap exactly: deleting a
page cascades to its calibrations AND to this, Postgres fires those triggers in
creation order, so a RESTRICT here would see rows that are about to be deleted
and block `takeoffPlan.deleteMany({ jobId })` in both cleanup scripts.

Proved against a real Postgres 16 rather than read off the SQL: a proposal
written, then that call succeeding with **zero rows left**. And
`lib/takeoffCascadeCensus.test.ts` now fails the build if any child of
`TakeoffPlan` stops cascading — derived from the migration SQL, so a new child
is held to the rule without anybody editing the test.

**What is derived and deliberately not stored:** the footage (geometry plus the
live calibration) and the wall-type match. A stored match would go stale the
moment somebody adds a wall type; the designation is kept as a STRING off the
drawing and re-resolved on every read, so renaming a type re-points the group
and deleting one leaves the group as a plain measurement with its footage
intact.

### Two columns I got wrong first, both caught by a round-trip test

The round trip — detect, store, read back, compare against `wallGroups`' own
output — is the whole test, and neither defect was visible to inspection.

**`thicknessInches` looked like derived state and is not.**
`clusterByThickness` labels a bucket with the MEAN of its members; one cluster
then splits into one group per printed tag plus a remainder, and each keeps the
whole cluster's average. So re-deriving it from a single group's runs returns a
different number — bounded by `CLUSTER_INCHES` (1.25in), which is TWICE
`THICKNESS_SLACK_IN`, so a shifted average silently changes which wall types the
estimator is offered.

**A GENERAL_NOTE group's candidates are the one type the note names**
(`[fromNote.type]`), not every type of that thickness. Reading it back the second
way turns a group the drawing had already answered into a question. That is why
`namedCode` exists: the note's designation is pulled out of its sentence by
`defaultWallTypeFromNotes`, which needs the sheet's text layer, and nothing
reading this table has the PDF.

### Detection, and the one thing it must never do

It runs after the response, from the saved calibration, and **it cannot fail the
save**. Every path out is caught. A calibration that stored correctly and then
reported failure because a courtesy job threw would have the estimator retyping
a scale that is already on file, and the second save is the one that would look
broken. `SheetTooDenseError` is recorded, not thrown — a sheet too dense to pair
is a fact about the drawing.

One trigger, so there is one answer to "why did this run". It is also the first
moment detection is POSSIBLE and the moment it is most wanted.

### What the mutations found, including two holes in my own tests

**18 of 20 red.** The two that stand are stated rather than smoothed over:

| mutation | why it stands |
| --- | --- |
| a live Find-the-walls result overwritten by the stored one | needs a real PDF in a real browser; happy-dom cannot press that button. CI's journey and the click-list are the instruments |
| the detector's empty-detection early return removed | **equivalent, not missed** — measured: `createMany({ data: [] })` writes nothing, so that return is a round-trip saving, not a correctness guard |

Three holes the mutations opened in tests I had just written, which is the part
worth keeping:

- **a cross-sheet test that passed vacuously.** It asserted sheet 2's walls were
  absent while the viewer was on sheet 1 — and the viewer ALWAYS opens on sheet
  1, with a pager that only renders once a real PDF reports `numPages`. It would
  have passed whatever the seeding did. Its own control caught it.
- **page-keying was unobservable from outside** for that same reason, so the
  decision moved into `storedWallsFor` — a pure function a test can be the
  caller of. The same move as `fromBaseline` last PR, for the same reason.
- **the row building was unreachable** inside a function that needs a PDF and a
  database, and three mutations proved the cost: writing every group as a
  REMAINDER, writing the raw runs with their derived `lengthFeet`, and writing
  rows for an empty detection ALL stayed green. It is `proposalRowsFor` now.

And a census of mine failed on its own comment: it counted `FOREIGN KEY` across
the migrations and found seven more than it could parse, every one of them
inside a `--` comment — including the one in the migration beside it explaining
why both constraints cascade. CLAUDE.md pays for that twice in
`OpeningDeductionForm.tsx`: *the better the comment, the more likely it contains
the string you are counting.*

### One existing census was tightened rather than loosened

`takeoffWallFinder.test.tsx` pinned `foundRaw` appearing EXACTLY TWICE, to stop
the raw state reaching a render site. A legitimate non-render read — the seeding
effect's guard and its dependency list — took it to four and failed a viewer
that was correct. Changing the 2 to a 4 would have turned the guard into
"however many there happen to be", so it asserts WHERE instead of HOW MANY: the
raw state does not appear in the component's returned JSX, with the derivation
required above it.

### Verified

- `715 test files, 11,083 tests`, typecheck and lint clean
- real Postgres 16: migration applies with **no drift** attributable to this
  change, JSONB/enum/Float round-trip intact, every row of one run shares a
  `createdAt` (which the newest-run filter depends on), and the cascade clears
- the migration is additive only — one enum, one table, two foreign keys, one
  index — so it is safe to apply ahead of the deploy that reads it

Two pre-existing drifts showed up in that check and are **not** touched here:
`JobProposalClause.updatedAt` and `ProposalClause.updatedAt` each carry a
database default the schema does not declare. Worth a look; not this PR.

### Not here

**No automatic estimate lines.** Detection stops before writing money, which was
the decision this whole phase was built around.

**No promotion of a read scale to a calibration.** The rule the takeoff rests on.
