### Confirming suggestions fast: each wall group in the review queue is one key

Wall types and heights are moving from posted to suggested, so the review queue is where they are accepted. Each untyped wall group is now confirmed rather than filled in (`QueueGroupConfirm.tsx`).

- **On the plan**, every run of the group is lit and the plan zooms to all of them (`focusRuns`), not only to the longest.
- **The suggested type** is pre-filled, with where it came from (`suggestType`, from the same verdict the sheet's group list shows):
  - `tag S6B on A101`, or `… carried along the wall on A101`;
  - `…, from the legend` for a tag the library lacks but the legend defines;
  - `the only 4-7/8" type in your library`;
  - `sheet note: …`.
  - Nothing is suggested for a thickness several types share.
- **The suggested height** follows the type: the height set on this job for that type, else its legend height (`legend: "TO DECK"; A301 prints … → 15'-0"`), else the ceiling over the group's walls.
- **Keys:**
  - **Enter** accepts the type and the height in one round trip (`confirmWallGroup`: Set type, then the height on that type's item for the job, and the estimate lines follow once sent);
  - **1–9** pick another legend type, and the height follows unless typed;
  - **H** edits the height;
  - **N** skips.
  - The keys are taken before the workspace's own, so H is not the hand tool there.
- **The queue moves on at once** and the save follows. A save that fails brings its group back with the reason.
  - Measured in `e2e/specs/fast-confirm.spec.ts`: the next group shows 5–13 ms after the key, and the rows are saved in about 120 ms (budget 5 s).
- A height item for "Walls — untyped" is not asked separately for runs a confirmable group already holds; its height comes with the type.
- Height items get the same keys (Enter accepts the pre-filled height, the type's legend height before the ceiling).
