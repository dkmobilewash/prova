### Both takeoff buttons put the walls on the job (new-customer run v2, M3)

On a brand-new Baker job, neither the workspace's Run takeoff nor the tab's "Find walls on every floor plan" put a single wall on the job, and the stepper stayed on Takeoff.

Saving a scale finds a sheet's walls and stores them as proposals. So on a new job every scaled sheet had walls stored and nothing on the job:
- the whole-set run found each one again, noted "already found" and posted nothing;
- Run takeoff found them in the browser and wrote nothing.

- **The whole-set run** (`walls.ts`): a sheet found again with nothing on the job is now posted like a fresh detection (`postAndRooms`).
  - Its walls go onto the job by type (`wallItemsForSheet`), with the runs held to confirm, and its rooms are read.
  - The note says "walls found; on the job by type: …".
- **Run takeoff** (`postSheetWalls`): after the find, the sheet's stored walls are posted by type the same way, unless something of the sheet is already on the job.
  - The Quantities panel says what went on ("Put on the job: … Untyped walls wait in Review.").
  - Pressing it again adds nothing.
- **"Add these" never writes a run already on the job** (`saveTakeoffMeasurements`). The group list still offers it on groups the runs above posted, and writing them again would count the walls twice.
  - A group entirely on the job is refused with the way to type it (Set type, or the review queue).
  - A group partly on the job writes only the new runs.
- Tests:
  - `wholeSetTakeoff.dbtest.ts` has three new cases: a found-but-never-posted sheet posted, `postSheetWalls` posting once and then leaving the sheet alone, and the duplicate refusal.
  - `e2e/specs/run-takeoff-posts.spec.ts` presses Run takeoff on a seeded sheet and checks the walls are on the job, a second press adds nothing, and the stepper moves past Takeoff.
