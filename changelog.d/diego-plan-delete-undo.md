### Deleting a plan can be undone for 10 minutes

**Diego, 2026-11-26** (coordination/plan-delete-undo.md, and its Amendment 1 with Diego's chat yes).

**What changes.**
- **A plan delete is soft.** The plan leaves its job (`jobId` NULL) and is marked `deletedAt`. Its runs leave their items,
  because item quantities read runs off the items, not through the plan. The estimate moves exactly as #1257's delete
  moved it.
- **What it changed is recorded on the plan** (`deleteUndo`): the job, each run's item, each estimate line's links before,
  and each line's stamp after.
- **The toast reads "<plan> deleted. … Undo" for 10 minutes**, and the dialog says "You can undo this for 10 minutes."
- **Undo puts it all back in one transaction:** the plan on its job, every run on its item, every line's links. Then it
  re-syncs, so the estimate returns to the cent.
- **Undo refuses, with nothing moved,** after the window, or if a line the delete changed was edited since.
- **The purge hard-deletes a plan past its window:** the row (pages and runs cascade), then the items it emptied if still
  empty, then the file. Crons on this account run once a day, so the purge is lazy: both takeoff pages run it for their
  company on every load, and the daily plan-ingest cron sweeps everyone. Diego accepted that a deleted drawing's file
  stays at its unguessable URL up to about a day when nobody opens the job again.
- **Nothing reads a deleted plan.**
  - Every read scoped by job skips it because its `jobId` is NULL.
  - The 13 reads not scoped by job now filter `deletedAt`: the plan file and raster routes, the sheet actions, the sheet
    index, the whole-set actions, the drawing-set read, pilot metrics, the heights sweep.
  - The ingest runner never picks a deleted plan's run.
  - `deletedPlanCensus.test.ts` fails the build on a new read that is not scoped and not on its allowlist of two named
    reasons. Its scanned set is asserted against a floor.
- **The cleanup scripts** also delete the undoable plans of the jobs they clean.

**The migration.** `20261126100000_takeoff_plan_soft_delete` is additive and nullable, with no backfill:
- `TakeoffPlan.jobId` becomes nullable; the job relation stays RESTRICT, pinned, since an optional relation would default
  to SET NULL;
- `deletedAt`;
- `deletedByUserId` (FK to User, SET NULL);
- `deleteUndo` JSONB;
- an index on (jobId, deletedAt).

**Item 1 (Diego, 2026-11-26), closed with no behaviour change:** a dbtest pins that the delete dialog counts exactly the
stored runs. That includes a held run and a hand-drawn run on no item: 85 ft.

**Checks.** Tests were written first, and red on main where they assert new behaviour. Mutations are one per rule. Latency
at 60 ms a round trip: delete 39, Undo 36, purge 3 queries, against the 41 a 5 s transaction allows.
