### One sheet, two scales — and the button that would have multiplied a detail by twelve (Diego)
`diego/multi-scale-zones`

The estimating audit's stage 1.2 asks to *"identify multi-scale sheets and flag
zones with varying scales"*. **The schema has supported this the whole time:**
`TakeoffPlanPage.calibrations` is plural, `saveScaleCalibration` ends in
`takeoffScaleCalibration.create` rather than an upsert, and every
`TakeoffMeasurement` already carries the `calibrationId` it was traced against.
So the data was right and nothing ever read it — the page took
`page.calibrations[0]` and threw the rest away.

No migration, no AI, no new model.

## The bug this turned up, which matters more than the feature

`rescaleTakeoffMeasurements` repoints every unposted measurement to the NEWEST
calibration and **leaves the traced geometry alone**. That is correct for a
re-calibration. On a sheet carrying a plan at 1/8" and a head-of-wall detail at
1-1/2" it multiplies the detail's quantities **by twelve**, silently, on figures
headed for a bid.

And the old banner was the thing inviting the press — *"2 measurements read at
an older scale for this sheet"* with a **Rescale** button — because
`outOfDate: m.calibrationId !== current.id` cannot tell a RE-CALIBRATION (same
scale, drawn twice, older rows genuinely stale) from a SECOND ZONE (different
scale, both rows correct). One expression, two meanings.

`zoneNotices` is that discriminator, so the fix is in three places and they all
read the same decision:

- **the banner is withdrawn** on a multi-scale sheet, and the zone notice takes
  its place. The two are mutually exclusive by construction — `outOfDate` is
  emptied — because a screen saying "these are stale, press to fix" *and* "two
  scales is normal here" about the same rows is giving contradictory advice;
- **each row says which scale it was traced against** (`at 1/8" = 1'-0"`), and
  only on a multi-scale sheet, where the scale stops being a property of the
  page;
- **the action refuses too**, because the screen may be minutes old and
  production redacts a thrown message — so it is a returned refusal naming what
  to do instead: *"Each measurement already reads at the scale it was traced
  against."* Same posture `saveScaleCalibration` already takes for its own
  refusals.

Posted measurements were never at risk — the action skips them. What this
protects is the unposted traces, which is everything somebody is part-way
through.

## Why a sibling module and not a branch in `calibrationNotices`

That function judges ONE calibration as it is drawn, and `calibrationRefusal`
reads its output to decide whether a save is allowed. This reasons over the SET
a page has accumulated, asked at a different time, and **must never refuse** —
two scales on one sheet is ordinary draughting. Folding it in would have meant
either a fourth argument that function does not need, or a `warn` becoming a
refusal the day somebody widens what `calibrationRefusal` matches.

`SAME_SCALE_TOLERANCE` is 10% and deliberately **not** `SCALE_TOLERANCE` (2%),
which answers a different question — whether a reading is close enough to a
standard scale to carry its name. This asks whether two readings are the same
scale drawn twice. Nobody clicks the same two pixels, so a strict comparison
would call every re-calibration a multi-scale sheet, and 10% sits far below the
33% gap between 1/8" and 3/16".

## Verification

- 17 unit tests, **mutation-proved both directions**: always-fire reds 3
  including both silence cases, never-fire reds 7. Heavy on asserted silence —
  one calibration, none, two at the same scale, two 4% apart, and an unknown
  page width.
- **4 tests against a real Postgres** (`takeoff-rescale-zones.dbtest.ts`),
  because "did an `updateMany` run" is a claim about rows. The refusal case
  reads the rows back rather than trusting the refusal — a refusal that still
  wrote would read as a refusal. **With a control that genuinely rescales**, or
  the whole file would pass on an action that refuses everything.
- Three distinct scales report **one** notice, not three pairings: distinct
  scales, not pairwise comparisons, or the output is arithmetic rather than
  information.
- `typecheck` 5/5, `lint` 5/5, **575 files / 8,952 unit tests**, and the db
  suite **65 files / 644 tests**.

**And a fixture flaw worth recording, because it read exactly like a product
bug.** The control first failed with the rescale having SUCCEEDED onto the
wrong calibration: two `create` calls land in the same millisecond, `createdAt`
ties, and `orderBy: { createdAt: "desc" }` then picks either row. `createdAt` is
set explicitly now, as `takeoff-currency-query.dbtest.ts` already does for its
plans. A person cannot click twice in a millisecond, so this is not a hazard in
the app — it is one in any test that writes rows in a loop.

## A fourth "Drag" string, and the census that could not see it

#631 corrected three sentences that told the estimator to drag when the tool is
click-once-per-end, and **missed a fourth** — `saveScaleCalibration`'s own
refusal, *"Drag along a dimension on the drawing to set the scale."* The census
it added reads `calibrationNotices`'s OUTPUT, and that refusal is the action's.

Right pattern, wrong SCOPE — the failure mode CLAUDE.md says no size assertion
can catch, because *nothing is ever missing from a directory you do not walk*.
The census now reads the SOURCE of all three modules that speak to an estimator
about calibrating, with comments stripped: both files print "drag" in prose
explaining the fix, so a raw-text scan would report a defect that does not
exist. It asserts its own parse is non-empty, and mutation-proved by restoring
the missed string — red, naming the file.
