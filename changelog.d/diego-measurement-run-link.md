### A measurement posted into a wall run you later deleted could never be priced again (Diego)

`diego/measurement-run-link`

**Schema change, announced in `#prova-build` before the push.** Migration
`20261010020000_add_measurement_wall_run` — additive only: a nullable
`wallRunId` on `TakeoffMeasurement`, an index, and a `SET NULL` foreign key to
`WallRun`. No drops, nothing rewritten.

#### The dead end

`postedAt` is a one-way door. Delete the wall run a measurement was posted into
and its estimate line goes with it — but the measurement still reads **"already
on the estimate"**, and `postMeasuredWallRun` refuses anything already posted.
A traced wall nobody can price, and nothing on the estimate to show for it.

Nothing recorded WHICH run a measurement went into, so nothing could clear the
flag. `wallRunId` is that record: `postMeasuredWallRun` writes it,
`deleteWallRun` undoes both fields together.

**Found while checking whether #716 had made something worse, and it had made a
second route to the same place.** Deleting a wall-schedule line now keeps it
deleted — correct, and the measurement then says "already on the estimate" for a
line that is gone. That half is NOT fixed here and is not a dead end: the run
still exists, so refusing a re-post is right, and the recovery is adding the
line by hand or changing the wall type, exactly as #716's entry says.

#### Why SET NULL, and why not RESTRICT

**The measurement is the survey and outlives any pricing decision made from it.**
Cascade would delete somebody's traced walls because they changed their mind
about a wall type.

And it is deliberately **not** a blocking FK: a `RESTRICT` here would be a new
child of `WallRun` that both cleanup scripts would have to learn about — the
`InvoiceCounter` trap in CLAUDE.md, where a counter that issued numbers
perfectly still broke `clean-scratch-data.mjs` and `seed-demo.mjs`.

The clear runs **before** the delete, because `SET NULL` would otherwise have
already removed the only thing that could find those rows. That ordering has its
own mutation.

#### Checks

- 12 cases in `takeoff-wall-run.dbtest.ts` against a real Postgres. **Six
  mutations, five red** — the bug as it shipped (no run id recorded), the run
  delete leaving the flag set, the clear not scoped to one run, the clear
  running after the delete, and `postedAt` kept while the link is dropped.
- **The case that matters asserts the RE-POST ACTUALLY WORKS**, not just that a
  field changed. Clearing the flag is worth nothing if the action still refuses
  the measurement, and `postMeasuredWallRun` reads `postedAt` itself rather than
  being told.
- **The sixth mutation is equivalent and the code says so**: dropping
  `wallRunId: null` leaves all twelve green, because the FK nulls it a line
  later whatever the code says. Kept so the clearing is stated where it is read
  rather than inferred from a constraint two files away.
- `wallTypes.test.ts` grew `takeoffMeasurement` in its fake client, and its
  header says why the real behaviour cannot be proved there: a fake client
  cannot enforce `ON DELETE SET NULL`, which is half of this fix.

#### What cannot be fixed, stated rather than hidden

**There is no backfill.** A measurement posted before this migration has no run
id, so deleting its run still leaves it stuck. Nothing anywhere records which
run it went into — the same shape as the invoice counter's one un-backfillable
case, and for the same reason: the information was never written down.

Preflight green, and it named the migration as production-bound.
