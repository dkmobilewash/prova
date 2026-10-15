### An AutoCAD export hides its walls inside a Form XObject (Diego)

`diego/autocad-xobject`

`sheetStrokes.ts`'s own header has said this since it was written:

> a Form XObject always carries a matrix, and Revit and AutoCAD both wrap
> drawing content in one

and it built a CTM stack for exactly that. **It was wired to `cm` only.** pdf.js
does not deliver an XObject's matrix as a `cm`: it emits
`paintFormXObjectBegin` with `[matrix, bbox]`, inlines the form's own operators,
then closes with `paintFormXObjectEnd`. Every one of those matrices was dropped
on the floor.

#### The geometry was never missing

| sheet | `constructPath` | Form XObjects | segments returned |
| --- | --- | --- | --- |
| `A-101__clean` | 1,233 | **0** | 2,928 |
| `A-101__autocad` | 2,202 | **177** | **7,272** |

The same floor plan, exported two ways. The AutoCAD version returns *more*
geometry than the clean one. It simply landed in the wrong place, so
`wallsInTheBuilding` discarded it and every wall on the sheet was reported as
"the reader returned no segment on this wall's faces — its geometry never
reached `wallsFromStrokes`".

That diagnosis was the single largest loss in wall detection: **6,086 ft on Mesa
Ridge and 7,575 ft on the holdout**, and every sheet carrying it is an
`__autocad` export — bar `A-101__scan`, which is a scanned image with no vectors
and is correctly impossible.

#### Graded per wall, against the key's centreline, both sets

| | Mesa Ridge | | holdout (20 plans) | |
| --- | --- | --- | --- | --- |
| | before | **after** | before | **after** |
| found on a wall | 52,109 (66.8%) | **59,538 (76.3%)** | 24,057 (72.8%) | **31,088 (94.1%)** |
| missed | 26,485 | **18,505** | 9,538 | **1,942** |
| not on a wall | 3,928 | 4,500 | 534 | 637 |

**+7,429 ft and +7,031 ft of real wall found.** The holdout goes from finding
under three walls in four to finding better than nine in ten.

**Not-on-a-wall rises in absolute terms and must not be rounded away** — but as
a share of found footage it is flat on Mesa (7.5% → 7.6%) and *better* on the
holdout (2.2% → 2.0%). It rises because sheets that previously returned almost
nothing now return geometry, including walls the key marks out of scope
(concrete block, storefront): out-of-scope footage is 1,253 → 1,446 on Mesa and
217 → 277 on the holdout. Those walls are real and correctly located; they are
simply not drywall scope, and the product separates them by wall type.

What is left as the biggest loss is now a 2,142 ft bucket that is **entirely the
scan**, which has no vectors to read.

#### Checks

Preflight green, 10,113 tests, no migration. **Five tests, and four mutations
all red** — the matrix never applied, `paintFormXObjectBegin` not handled,
the matrix never popped (so it outlives the form and drags the rest of the
sheet), and the matrix *replacing* the CTM instead of composing onto it.

That last mutation was **blind** at first: every other test here starts from an
identity CTM, where composing and replacing are indistinguishable. It needed the
nested case the header itself names — a form inside a scaled block — which is
what real CAD actually emits.
