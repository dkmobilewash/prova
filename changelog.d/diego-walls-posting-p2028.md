### A whole-set run puts a big sheet's walls on the job, and never says "done" when it could not

**What happened in production.** On 2026-11-24 a whole-set walls run posted nothing on Milk Prep A2.21 (144 runs,
59 held) while the panel said "1 of 1 sheets — done". `wallItemsForSheet` awaited an item lookup for every group and
for every held run inside one interactive transaction, so its round trips grew with the sheet. At Neon's latency
that outlived Prisma's 5 s interactive default and threw P2028 "Transaction not found"; the whole post rolled back.
The stage then wrote "; walls on job failed" into the task's note and finished the sheet anyway.

**What changes.**
- Each item ("Walls — to confirm", "Walls — untyped", each type) is looked up or made once per call. Making an item
  stays in the same transaction as the rows, so they still land or fail together.
- The posting transaction states its own limit (`WALL_ITEMS_TX_TIMEOUT_MS`, 20 s) instead of inheriting 5 s.
- A posting throw now FAILS the sheet's task with "The walls were found but could not be put on the job. Retry this
  sheet." The runner retries it; the stored walls are untouched, so a retry posts them.

**Checks.**
- `wallItemsLatency.dbtest.ts`: real Postgres, every query delayed 60 ms, 144 runs in 28 groups with 59 held.
  - main's code: fails at 5,040 ms with "Transaction already closed … timeout for this transaction was 5000 ms",
    inside `namedItem`;
  - fixed: all 144 rows, 59 on "Walls — to confirm", in 11 queries and 719 to 778 ms.
- `wholeSetTakeoff.dbtest.ts`: when posting throws, the sheet stays unfinished with that sentence and writes no
  row. On main's code it read `{"done":3}`.

**Not in this PR (Diego, 2026-11-25: its own PR, third in line).** The jobLineItem P2028 cluster in production since
2026-08-31 is the same family. `syncTakeoffItemLines` updates, or finds and creates, each estimate line on its own
inside interactive transactions that many callers open. It is fixed per caller, measured the same way, not by
raising the default for all 127 interactive transactions.
