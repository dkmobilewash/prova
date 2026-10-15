# Takeoff — decisions, limits, and the latest numbers

**Takeoff geometry is computed by code in `lib/takeoff/`, never by the LLM.**
Every length, thickness, area and coordinate comes from the PDF's own vector
geometry. The model is used for interpretation only — what kind of sheet this
is, what a run IS, what a label means — and no model reply in this repo carries
a coordinate, a length or an area. See `ARCHITECTURE.md`.

## The two fixture sets, and why there are two

| | `reports/takeoff-bench` | `lib/takeoff/fixtures` |
| --- | --- | --- |
| drawn by | our own generator | a different generator, outside this repo |
| wall LF ground truth | **yes**, exact, from the model that drew it | **no — not printed on any sheet** |
| scale, rooms, areas | yes | yes, where the sheet prints them |
| raster sheets | one scan variant | **three real raster sheets** |
| what it is for | grading wall footage | surviving someone else's conventions |

The second set exists because **one generator cannot surprise itself.** On
2026-10-14 the bench reported "no change" twice for work that a real drawing
proved was doing real work, and three separate defects were found only by
pointing instruments at drawings this repo did not author:

- a split-path reader bug (`pdfjs` can emit one path as two `constructPath`
  operators; the cursor reset between them and the line vanished silently);
- `-E` as a layer's existing-work status code, which no spelled-out word list
  caught;
- a classifier prompt rule that rejected every radius wall.

### The rule for an answer key

**Only what a drawing PRINTS may be ground truth.** A room tag that says
`361 SF` is an answer the architect published. A wall length nobody printed is
not, and measuring it with the detector under test would be marking our own
homework. Unknown fields are `null` and the scorer skips them —
`expected.test.ts` fails the build if a key ever claims a wall length.

## Latest run — `fixtures/score.eval.ts`, 2026-10-15

```
SCALE: 11 correct of 15 scored; 3 correctly declined (the raster sheets)
WALL FOOTAGE: reported, NOT SCORED — no sheet in this set prints one
ROOMS: 122 tagged in the key; the pipeline does not yet report a room list here
```

### The four scale failures

| sheet | printed | read | |
| --- | --- | --- | --- |
| S01 | `1/4" = 1'-0"` | declined | small sheet, 1 room, 4 dimensions — likely below the agreement floor |
| **S11** | `1/8" = 1'-0"` | **`1/4" = 1'-0"`** | **wrong-but-confident. Every quantity 2× out** |
| S16 | `1:100` | declined | **metric** — dimensions are bare millimetres |
| S17 | `1:50` | declined | **metric** |

S11 is the worst class of failure this repo recognises and it is the one to fix
first. S16/S17 are a capability gap rather than a bug: nothing in the dimension
reader understands millimetres.

### Three sheets find a correct scale and ZERO walls

**S06, S10, S15 — because their walls are drawn as filled poché, not as two
parallel stroked lines.** Confirmed by looking at the overlays rather than by
reasoning: S06's partitions are solid grey polygons, and S02's — which the
pipeline reads perfectly, 10 runs over every partition — are thin line pairs.

This is a limitation the code already admits. `wallVectors.ts` states the cost
in its own words: *"a curved wall that ONLY the room engine could find — drawn
as fill with no two faces — stays missed, exactly as a straight poché wall does
today."* It had never been quantified. It is **3 of 15 vector sheets**, and it
is the single biggest gap in the vector path.

The fix is a centreline derived from the polygon, and it is a real piece of
work rather than a threshold change.

### The raster sheets

S18, S19, S20 carry **zero strokes and zero text**. They are correctly refused,
and they will stay refused until there is a raster path. They are in the set so
that the day somebody builds one, the fixtures are already there.

## How to run any of it

```
# regenerate the answer keys from what the drawings print (output is committed)
pnpm --filter @prova/web exec vitest run --config vitest.eval.config.mts \
  lib/takeoff/fixtures/extract.eval.ts

# the scorecard
pnpm --filter @prova/web exec vitest run --config vitest.eval.config.mts \
  lib/takeoff/fixtures/score.eval.ts

# the pictures — look at these after every change
pnpm --filter @prova/web exec vitest run --config vitest.eval.config.mts \
  lib/takeoff/fixtures/overlay.eval.ts

# wall footage, against the only key that has it
TAKEOFF_BENCH=1 pnpm takeoff:bench
```

Overlays are **not committed** — they are an output, they are large, and a
stale one is worse than none. Regenerate before looking.

## Known limitations, in the order they cost the most

1. **Filled-poché walls produce nothing.** 3 of 15 vector fixtures.
2. **A wrong-but-confident scale** on S11. Everything downstream is 2× out.
3. **No metric dimension reading.** 2 of 15 fixtures decline a scale they print.
4. **No raster path at all.** 3 of 20 fixtures, and a real share of real sets.
5. **Rooms are not scored here.** The pipeline does not surface a room list from
   the entry point the scorer uses, so 122 tagged rooms sit unused.
6. **The wall classifier must not run unasked** — graded 2026-10-15: it drops
   3 real walls per sheet to catch 1 phantom, and caught 3 of 12 on a sheet
   where every candidate was a phantom. It stays a button a person presses.
