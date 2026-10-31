### Find walls on every floor plan at once — behind a switch that is off

`diego/whole-set-takeoff`

One button on the takeoff, once the scales are set: **Find walls on every floor
plan** runs the wall finder over every scaled floor-plan sheet in the set, in the
background, with "12 of 18 sheets" climbing beside it, and then lists what each
sheet came to — wall groups and feet, or why it was passed over: no scale, not a
floor plan, already found, nothing found, too dense. Opening a sheet afterwards
finds its walls waiting, because they are the same rows the one-sheet button
writes. OFF for every company until the owner turns it on under Settings.

It is a new STAGE of the plan-ingest runner (`WALLS`), not a new queue: one task
per eligible sheet, an atomic claim so two tabs cannot do a sheet twice, the
browser pumping `advancePlanIngest` while somebody watches, the cron as the safety
net — all of which already existed. The work per sheet is exactly
`detectWallsForCalibration`, what a saved scale already triggers; the finder is
untouched. No model is called and nothing is spent.

**Only the sheets it can do become tasks.** A sheet with no scale, a sheet the
inventory's title block calls a schedule or a section, and a sheet whose walls are
already found are never tasks, so the count is of real work and the summary says
why the rest were left (`lib/plan-ingest/walls.ts`, derived from rows, never
stored). Each finished task carries a one-line `note`; the walls themselves stay
`TakeoffWallProposal` rows.

**Measured on Baker (training), 65 pages, with each sheet's scale taken from what
it prints:** 4 floor plans would be found in 22 s all told (A100 15 groups 1,981 ft;
A101 15 groups 862 ft; A401 13 groups 682 ft; and G002, a code sheet drawn at
1/4", 15 groups 1,062 ft — a phantom the title rule lets through), 25 sheets passed
over as not floor plans, 36 with no printed scale. The longest sheet took 17 s.
`lib/takeoff/realplan/wholeSet.eval.ts` reruns it on any training set.

Migration `20261027120000_whole_set_takeoff`: one enum value, one nullable
column, one boolean with a default — additive only. Proposed, applied only to a
throwaway Postgres for the db test.
