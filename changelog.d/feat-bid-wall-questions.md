### The Bid guide asks how many layers of board a wall has (Cyrus)
`feat/bid-wall-questions`

C Stream Bid already asked "how tall are the W2 walls?" because a run with no
height prices nothing. The other thing a partition schedule routinely leaves
to a UL detail nobody attached is the LAYER COUNT, and two layers doubles the
board. So a wall type now has `boardLayers` (nullable — null is "not
answered"), a part has `perLayer` (its factor is for one layer), and the guide
asks "How many layers of board are on the W2 walls on Civic Center?" with
"1 layer each side / 2 layers each side" as tap answers, a two-step confirm, an
argument the server re-derives and refuses when stale, and the write through
the existing `updateWallType` then `refreshWallSchedule`. Ranked right after
the height question and before adding the walls and every price ask. The card
on `/wall-types` and `/bid/wall-types` edits both fields.

**Additive, and unanswered is unchanged.** Two columns:
`WallType.boardLayers INTEGER NULL` and
`WallTypeComponent.perLayer BOOLEAN NOT NULL DEFAULT false`. An answer reaches
a quantity only through a part that opted in, so every existing part, and
every legend-made type (which writes its layer count into the factor), prices
exactly as before. Proved against the base commit's own `scheduleLines` over
every starter, 2,000 random runs at three opening thresholds, and the bench's
A-101 answer-key job — byte-identical JSON — with a control that went red the
moment an answer was set. The starters mark only their BOARD per layer: tape
and finish cover the face layer, so a finished square foot does not move. W2's
100 LF × 10 ft: 69 sheets at one layer, 138 at two; studs, track, finish and
batt unchanged.

**Asked about and rejected:** a fire rating (it changes WHICH board and which
detail, and the legend reader already refuses to turn a rating into a part —
a rating that priced something would have to invent what it adds), and "to the
deck or above the ceiling" (that is the height question, asked twice).

**A bug found on the way, in the height answer.** `setWallHeight` re-sent the
wall type without `thicknessIn`, and `updateWallType` read the missing key as
blank — so answering "how tall are the W2 walls?" CLEARED W2's thickness,
which is what the wall finder matches a drawn group on. Its own test pinned the
form without the field. Fixed twice: one form builder that sends every column
for both tap answers, and `updateWallType` now leaves a column the form did not
send alone (`thicknessIn`, `boardLayers`). The db test now asserts the
thickness survives.

**One mapper instead of three.** The wall schedule's write, the Estimate tab's
preview and Ask's `wall_schedule` each mapped a wall-type row by hand; they now
share `wallTypeInputFromRow`, and `boardLayers`/`perLayer` are required on the
pure inputs so no builder can leave them out silently.

The migration was generated schema-to-schema (no database opened) and applied
with `prisma migrate deploy` to a local scratch Postgres 16 only.
