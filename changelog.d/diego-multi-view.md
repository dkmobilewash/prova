### What actually changed, in plain English (Diego)
`diego/multi-view`

**A sheet with no floor plan keeps one plan per room, not one per sheet.**
Joplin A-111 is seven typical-room plans — an enlarged plan and a sloping
plan of each of three rooms, plus a resident room — and the keeper, grouping
by level, found every level empty and kept one drawing: 422 ft of key on the
other six read as "missing". Where a sheet has no floor plan the group is now
the plan's SUBJECT (its caption with the drawing number and the kind words
stripped), and the primary of each group is kept — the enlarged plan over
the sloping plan of the same room. Beside a floor plan nothing changes: an
enlarged room is still that plan drawn again and is still dropped. Swept
over all 52 labelled sheets: one sheet moves, 238 ft of real wall recovered
for 79 ft of unverdicted extra, every other sheet byte-identical, held-out
delta zero. A caption's level is also read from the number AFTER "LEVEL"
before the number before "FLOOR", so a drawing number is no longer a level;
that one is neutral on every labelled sheet. And `zzViewLeak.eval.ts` puts
every offered and key foot into the view whose box holds it, which is how
the "leaked key plan" hypothesis from the held-out gap report was tested on
training and refuted. Details in `NOTES.md`.
