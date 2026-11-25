### Saving a takeoff decision writes the estimate in a fixed number of statements, so a real-sized estimate no longer times out

**What happened in production.** Since 2026-08-31, takeoff actions on /jobs/[id]/takeoff and /takeoff/[id] have thrown
P2028 "Transaction not found" in `jobLineItem.findMany`. Every one of them ends in `syncTakeoffItemLines`, which
created each new estimate line and updated each kept line with its own awaited query. Several callers also awaited one
write per wall run. All of it ran inside one interactive transaction on Prisma's 5 s default. At Neon's latency an
estimate of about 80 lines, or a sheet of about 85 runs, outlived that limit, and the whole decision rolled back.

**What changes.** Each caller's own loops are batched. No default is raised.
- The sync writes new lines in one `createMany`, kept lines in one `UPDATE … FROM (VALUES …)` (a parameterised tagged
  template), and retired lines in one `updateMany`. New lines are still created a millisecond apart, so the proposal's
  order by `createdAt` is unchanged.
- Set type (`typeGroup`) moves a group's untyped runs in one `updateMany`, not one per run.
- Undo of an Accept all or of an addendum puts every row back in one statement. Item heights take one `updateMany` per
  distinct value, and the items the accept made are removed in one `deleteMany` (`deleteEmptyItems`).
- Applying an addendum reads every sheet once and writes the new runs with one `createManyAndReturn`. The carried runs
  take one `updateMany` per item, and the earlier runs one `updateMany`.
- Undo auto-post syncs the doors and the walls once, not twice.
- Undo of confirmed windows or doors removes the emptied items with `deleteEmptyItems`.

**Checks.**
- `syncLinesLatency.dbtest.ts`: the sync alone, at 60 ms per query, on 20 types × 4 parts.
  - main: fails at 5,034 ms (P2028, 0 lines);
  - fixed: about 28 queries, under 2 s.
- `syncCallersLatency.dbtest.ts`: every caller, at 60 ms per query, on that estimate, with each caller's work sized to
  Milk Prep A2.21 (144 runs, 28 groups, 85 untyped). The bar was pre-registered: every transaction finishes in half
  its own limit.
  - main: 7 of 14 cases fail, 6 of them with P2028;
  - fixed: 14 of 14 pass, the worst transaction 2,236 ms / 34 queries.
