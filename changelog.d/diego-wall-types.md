### Wall types and a wall schedule — the run meets its type and its height (Diego)
`diego/wall-types`

Every takeoff product in the competitive audit measures a wall's plan-view
centerline and stops, because the two things that turn "142 feet of wall" into
a bill of materials are not on the floor plan: what the wall IS (the partition
schedule) and how TALL it is (the sections). Joining them was left to the
estimator, by hand, on every bid.

`/wall-types` is the company's partition schedule: each wall type by the tag
the drawings give it, and what goes into it — studs, track, board, insulation —
each part counted per foot, per square foot, per stud or per run, with a
factor, waste, a price-book link and a crew rate. On a job's Estimate tab the
new **Wall schedule** takes each run by type, length, height and openings, and
the estimate's wall lines are worked out from it by `lib/wall-assemblies.ts`,
which reuses `lib/takeoff.ts` so a stud is counted in one place.

The runs are KEPT, not just turned into lines, so the schedule is the record of
what was measured — what on-screen tracing and an AI read of the plans will
write into later. Three rules make that safe, all in
`lib/estimating/wall-schedule.ts`: every run write re-syncs the lines in the
same transaction; a re-sync updates the SAME line ids and moves only quantity
and hours, so a price the estimator typed survives; and editing a wall type
never reaches an existing estimate until that job is refreshed. A run with no
height anywhere adds nothing and says so — a guessed ten feet is a number that
looks right and gets bid.

The check: `lib/wall-assemblies.test.ts` pins the geometry, summing across runs
and rounding the TOTAL up once (ten 4-foot runs buy 28 sheets, not 30).
`lib/actions/wallTypes.test.ts` pins the sync — mutation-tested twice: making
the re-sync overwrite the price goes red on the kept-price test, and dropping
`companyId` from the wall-type lookup goes red on the scoping test.

`WallRun` is RESTRICT on `Job`, so it is in `HANDLED_MODELS` and both cleanup
scripts. All three tables are in the data export. Two unpriced starter types
(W1, W2) make the page usable on day one without inventing anyone's prices.
Additive migration only. Not yet: AI reading the schedule, on-screen tracing,
ceiling types, a difficulty factor.
