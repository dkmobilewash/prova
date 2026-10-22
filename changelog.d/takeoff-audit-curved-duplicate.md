### A straight run lying on a curved wall is the same wall

The engine reported 62.92 ft for a 55.14 ft wall: the arc, plus a 7.80 ft
straight run covering the first 4.7 ft of that very wall. 7.8 ft of one wall,
twice, on a number a GC is sent.

`duplicateCoverage` asks its question in CHORD space — it projects one run into
the other's end-to-end direction and refuses anything more than two degrees off
it. The chord of a 117-degree arc cuts through the building, so a piece lying
exactly ON that wall measured **53 degrees** away from it and read as a
different wall. `WallCandidate.curved` already warned, in as many words, that
the endpoints are only the chord and a consumer re-deriving from them will be
wrong; this was that consumer.

The run carries the circle it was drawn on now (`WallCandidate.arc`, filled in
by `curvedWalls` from the same `circleOf` its join uses), so the question is
asked of the path. Both of the shorter run's ENDS must sit on that circle —
testing the middle throws away the real wall, because a run spanning most of an
arc is stored as that arc's chord and a long chord's middle is inside the
circle by the sagitta — and within the arc's own angular span, so a round
room's far wall is not swallowed.

**Cedar Hollow goes from −0.6% to −1.7%, and the takeoff is better for it.**
That is the whole argument for reporting three numbers instead of one: the
sheet was 11.99 ft short of real wall and 0.30 ft over, and it read −0.6%
because a double count was cancelling a shortfall. Removing the double count
removes the cancellation.

| guard | feet removed |
| --- | --- |
| 20 fixtures | 0 — 15 of 17 unchanged |
| bench | 0 — 111 missed, 17 of 60, zero-wall PASS, all unchanged |
| 9 real sheets | 0 on all 8 measured |
| Cedar Hollow | **7.80 ft** (667.88 → 660.08) |

Mutation-tested five ways, four of them red. The one that survives is the
condition `other.arc !== undefined`, which is redundant with the line below it
— kept as a cheap guard, recorded here so nobody spends an afternoon writing a
case for it. A fifth case was added because the first four left "only one end
need be on the circle" alive: a partition BUTTING into a curved wall shares one
end with it and is not the same wall, which is the commonest shape on any plan
with a curve in it.

The first version of the branch asked the question the other way round — a
curved run's own ends against its own circle, true by construction — so every
longer run became its duplicate and EVERY curved wall was dropped, taking the
sheet to −17.7%. That is now a test.

`scripts/dev-local-plans.sh` and `scripts/dev-demo.sh` start the dev server
against a local database with a local plan directory, and switch back. The
first refuses a plan directory that does not exist and refuses any database
host that is not loopback, because a client's plan set recorded where a preview
can read it is the failure the whole local-plan arrangement exists to avoid.
