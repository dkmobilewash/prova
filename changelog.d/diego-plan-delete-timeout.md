### Deleting a plan no longer fails at the 5-second transaction edge

**Production, 2026-11-26 18:45:39Z, during #1268's own proof on the ZZ job:** pressing Delete plan threw P2028. The
preview's transaction ran 5,068 ms against Prisma's 5 s default, and the page showed its error boundary. Nothing was
changed, because the preview rolls back. A measured round trip was 6.2 s, so this path sits at the edge on production.

**Two halves, chosen for this caller** as `coordination/sync-p2028-callers.md` requires. The global default is untouched.
- **A failure is a sentence:** the preview, the delete and Undo each turn a failed transaction into "Could not finish
  that in time. Nothing was changed. Try again." Before, the preview re-threw, and production redacts a thrown action
  into an error page. The delete and Undo would have done the same.
- **Headroom:** the three transactions ask for `PLAN_DELETE_TX_MS` (20 s), 3x the slowest measured round trip, as the
  60 s callers already do.

**Not established, and said so:** why production runs slower than the latency model (39 queries x 60 ms). The
constant carries a `ponytail:` note naming that, and naming fewer round trips as the upgrade path.

**Checks:** `planDeleteTimeout.test.ts` has 5 cases, all red on main. Six mutations, all red:
- the preview re-throws;
- the delete re-throws;
- Undo re-throws;
- the delete without the timeout;
- the constant back to 5 s;
- the sentence naming P2028.
