### Existing walls were being priced as new, and the drawing said so all along

#795 taught the wall finder to read CAD layer names. It shipped with an
out-of-scope list of spelled-out words — `EXST`, `EXISTING`, `DEMO`, `NIC` —
and that list was a guess about how offices write it.

Then the probe was run on a real set. **West Herr's A-101: 47 layers, 100% of
the line work on one of them, and the out-of-scope bucket came back ZERO** while
the drawing carried:

| layer | path operators | |
| --- | ---: | --- |
| `A-Wall-E` | **281** | existing walls, read as NEW and priced |
| `A-Door-E` | 242 | |
| `A-Glaz-E` | 240 | |
| `P-Flor-Fixt-E` | 125 | |
| `A-Flor-Case-Abov-E` | 45 | |
| `P-Flor-Fixt-D` | 28 | demolition |
| `A-Flor-Strs-E` | 26 | |
| `A-Wall-Blow-E`, `A-Wall-Open-E` | 16 | more existing wall |

**297 of those are wall layers.** Without this they are measured, grouped and
offered for pricing as new construction — which is precisely the third thing the
original report asked for, in the drawing's own words: *"it says existing space
so those would not need to be accounted for."*

### The National CAD Standard puts the status in ONE LETTER, in the last field

`N` new, `E` existing to remain, `D` to be demolished, `X` existing to be
removed, `R` relocated, `F` future, `T` temporary. The spelled-out words #795
shipped are a house style; this is the published convention, and it is what
turned up on the first real set anybody pointed the probe at.

**It has to be the LAST field, and that is not a detail.** `E` in the FIRST
field is the ELECTRICAL discipline — `E-Lite`, `E-Powr`. Reading a leading `E`
as "existing" would drop every electrical layer under the wrong name, and would
be wrong about what the layer even is rather than merely wrong about scope.
Position carries the meaning, so this is a positional rule rather than another
entry in a set.

### Three letters, and the omissions are the argument

`E`, `D` and `X` only.

- **`R` relocated and `T` temporary are WORK.** Relocating a partition is a
  thing somebody is paid to do; a temporary partition is built and later taken
  down. Both stay in scope.
- **`F` future is genuinely out of contract and is still left in**, because a
  lone `F` is also how more than one office abbreviates FURRING — and dropping
  furring is dropping a wall. The asymmetry this whole filter is built around:
  a phantom wall is on screen and gets rejected in a second; a missing one
  reaches a bid.
- **`N` is new** and is the entire point of the estimate.

A multi-letter last field is never a status: `A-WALL-EXT` is an EXTERIOR wall,
not an existing one, and the difference is a whole envelope. A name of one token
is never judged this way either — a layer called simply `E` is the discipline
with nothing after it.

### What it does to the sheet the whole effort started on

West Herr A-101, 12,503 path operators, before and after:

| bucket | before | after |
| --- | ---: | ---: |
| not a wall (title block, cars, dims, tags) | 3,676 | 3,451 |
| **out of scope (existing / demolition)** | **0** | **1,030** |
| wall | 6,742 | **6,445** |
| unknown — kept, the fail-safe | 2,081 | 1,573 |

The wall bucket is now `A-Wall` (6,401), `A-Wall-Blow` (40) and `A-Wall-Open`
(4) and nothing else. Every `-E` variant has left it.

**Nothing is dropped silently.** `droppedLayersSentence` already separates this
from the furniture — *"1,030 on existing or demolition layers (A-Wall-E,
A-Door-E, A-Glaz-E and 4 more)"* — because a remodel may genuinely be pricing
those, and burying an arguable judgement inside an obvious one is how a caution
stops being read.

### Verified

- **6 of 6 mutations red**, control green: the status letter never read;
  position ignored so `E-Lite` breaks; the single-character test dropped so
  `A-WALL-EXT` becomes existing; `N` added so new work reads as not-new;
  `F` added so furring would be dropped; the one-token guard removed.
- Measured on the real drawing before and after, which is the only instrument
  that could see it — see below.
- `./scripts/preflight.sh` green. No schema change, no migration.

### The bench CANNOT grade this, and that is worth writing down

`pnpm takeoff:bench` is **byte-identical** before and after. Not because the
rule does nothing, but because the generator spells status as a WORD —
`A-WALL-DEMO`, `A-WALL-HIDN` — which the old list already matched. Real offices
use a letter. So the fixtures cannot pose the question, and the scorecard's
silence here is the instrument's limit rather than a result.

That is the same shape as `sheetStrokes.ts`'s own scar — *"no test in this repo
could have caught it, because `syntheticSheet.ts` writes its own content stream
and never emits a `cm`"* — and it is the second time in two days that a real
drawing has answered something the bench structurally could not. Teaching the
generator NCS status letters would fix it and would move the answer key, so it
is named here rather than smuggled into a change about scope.
