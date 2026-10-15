### Twenty sheets this repo did not draw, and a key for them

`reports/takeoff-bench` grades the wall finder against drawings OUR OWN
generator produced, and `wallCases.ts` has always said what that is worth:
*"a pass here is a FLOOR"*. On 2026-10-14 that floor showed its limit twice in
one day — the bench reported "no change" for work a real drawing proved was
doing real work — and three separate defects were found only by pointing
instruments at files this repo did not author. **One generator cannot surprise
itself.**

So there is a second fixture set now: twenty single-sheet plans drawn by a
different generator, with different conventions, committed with an answer key.

### Only what a drawing PRINTS may be ground truth

The rule a real plan forces, and the one this key obeys. A room tag that says
`361 SF` is an answer the architect published. A wall length nobody printed is
not — and measuring it with the detector under test would be marking our own
homework.

| field | scoreable here |
| --- | --- |
| scale | yes, printed in the title block |
| room count, names | yes, one tag per room |
| room areas | **3 sheets** (and 1 metric sheet in m²). Null elsewhere |
| **wall LF** | **NULL EVERYWHERE — no sheet prints one** |
| door/window counts | null everywhere — no schedules |

**The number this product exists to get right is the one these fixtures cannot
score**, and that is said in `expected.ts` rather than discovered later. The
bench stays the only wall-footage key. What this set holds us to is the stages
BEFORE it — whether we read the right scale and survive another office's
conventions — which is where a wrong wall total usually begins.

`expected.test.ts` fails the build if a key ever claims a wall length, so the
day somebody fills those in by measuring the drawing, the guard catches it.

### The scale check is not circular, and the key is not derived from the detector

The pipeline's primary scale reader measures LINES and reads the dimension
strings beside them. The key's value comes from the title block's printed NOTE,
which that reader never consults. Agreement between them is the cross-check,
not a tautology — and where the pipeline fell back to the printed note, the
scorer says so and does not count it as an independent pass.

### First run

```
SCALE: 11 correct of 15 scored; 3 correctly declined (the scans)
WALL FOOTAGE: reported, NOT SCORED
ROOMS: 122 tagged in the key; the pipeline does not report a room list here yet
```

**Four scale failures**, one of them the worst class this repo recognises:

| sheet | printed | read | |
| --- | --- | --- | --- |
| S01 | `1/4"` | declined | one room, four dimensions — likely under the agreement floor |
| **S11** | `1/8"` | **`1/4"`** | **wrong-but-confident. Every quantity 2× out** |
| S16 | `1:100` | declined | **metric — dimensions are bare millimetres** |
| S17 | `1:50` | declined | metric |

### And a known limitation finally has a number

**S06, S10 and S15 read a correct scale and find ZERO walls.** Found by opening
the overlay rather than by reasoning about it: their partitions are drawn as
solid filled poché — grey polygons — and the pairer looks for two parallel
stroked lines. S02, whose walls ARE line pairs, is read perfectly: ten runs
straight down every partition.

`wallVectors.ts` already admitted this in its own words — *"a straight poché
wall… stays missed"* — and nobody had ever counted it. It is **3 of 15 vector
sheets**, and it is the biggest gap in the vector path. The fix is a centreline
derived from the polygon, which is real work rather than a threshold change.

### Two bugs the harness found in itself, which is the point of controls

**The scale arithmetic was twelve times out.** `feetPerInchOf` read
`12 / (1/4)` = 48 ft per inch for `1/4" = 1'-0"`; the answer is 4. Every wall
thickness came out 12× too large, nothing fell in the pairer's window, and the
scorecard printed **0 runs on all fifteen vector sheets** — a clean, confident,
entirely wrong table. It was caught only because an earlier probe had already
reported 10–28 runs on the same files.

**The room parser called two sheets empty.** It required a three-digit tag
number because every sheet looked at used `101`. Two of the twenty are metric
and number rooms `01`, so the key reported zero rooms on both — not a null the
scorer skips, but a confident wrong answer. Areas in `m²` were missed the same
way, and are now stored in the unit they were printed in, unconverted, because
arithmetic in a key is arithmetic nobody can check against the drawing.

### What is here

- `fixtures/plans/` — the twenty PDFs, including **three real raster sheets**
  (zero strokes, zero text) so the scan path has fixtures the day it exists
- `fixtures/expected/` — one committed key per sheet, reviewed once by a person
- `fixtures/extract.eval.ts` — rebuilds the keys from printed text only
- `fixtures/score.eval.ts` — the scorecard, with its own controls: a run that
  read no geometry must not print a clean table
- `fixtures/overlay.eval.ts` — the pictures. **Not committed**: an output, large,
  and a stale one is worse than none
- `fixtures/expected.test.ts` — 19 parser cases, mostly about what must NOT match
- `NOTES.md` — the limitations in the order they cost the most
- a line in `CLAUDE.md` stating that takeoff geometry is code, never the LLM

### Verified

- `./scripts/preflight.sh` green, 11,183 tests. No schema change, no migration.
- The three new evals are registered as keyless exemptions with a reason each,
  and each carries the skip and the non-zero assertion that exemption requires.
