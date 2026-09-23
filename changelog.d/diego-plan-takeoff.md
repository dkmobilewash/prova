### You can measure a drawing on screen now (Diego)
`diego/plan-takeoff`

Until today Prova did the arithmetic between a measurement and a bid but could
not take the measurement: you measured in Bluebeam or with a wheel and retyped
dimensions into a form. `/jobs/[id]/takeoff` renders the PDF, you set the scale
on each sheet against a dimension printed on it, and you trace what you're
taking off. Lengths, areas and counts become estimate line items through the
**same `recipeLines`** the typed form already used — unpriced, exactly as
before.

**`lib/takeoff.ts` argued against this feature for weeks and it was right.**
Its docstring said a measuring tool that is slightly wrong is more dangerous
than no measuring tool, "because a number that came off a screen gets trusted."
That sentence is the spec, and it is why the unusual decisions below exist. It
has been rewritten rather than deleted: the half that said there is no PDF
canvas is now false, and the half that set the bar still stands.

**Nothing derived is stored.** There is no `feet` column, no `squareFeet`
column, no `feetPerPageWidth` column — grep for them. Every figure is
recomputed from the traced points and the sheet's calibration on each read, by
a pure module with no database, no React and no pdfjs in it.

**Correcting a scale moves nothing by itself.** Calibrations are append-only
and every measurement points at the one it was drawn to, so recalibrating a
sheet inserts a row and leaves last week's quantities exactly where they were.
Re-scaling is a separate, explicit act that shows each before-and-after figure
first, and skips anything already posted to the estimate — correcting a posted
quantity is an estimate edit, not a takeoff one. The required `calibrationId`
makes an uncalibrated measurement structurally impossible rather than merely
discouraged.

**The scale is read back before it is saved**, while the drawing is still on
screen: named against the standard architectural and engineering scales
("1/4″ = 1'-0″, 1:48"), with the sheet width in feet, a loud sentence when it
matches no standard scale at all, and the click-error band over a 100 ft run.
A calibration line under a twentieth of the page is refused outright.

**The coordinate contract, because `media-annotations.prisma` is a cautionary
tale.** Its comment named the wrong box for two years and a GC was shown an
arrow pointing at the wrong part of a photo. Here, both axes are normalised by
the page WIDTH — so `x` runs 0..1 and `y` runs 0..H/W, and `y` is *not* a
fraction of the height. That asymmetry is what makes a distance computable
from the stored numbers alone, which is why **the server needs no PDF library**
to recompute a quantity.

**Three things the tests pin, each mutation-tested.** Area scales by the
SQUARE of the scale (getting that wrong is the "twelve times wrong" failure);
a ring that crosses itself is refused rather than shoelaced into a plausible
number; and traced wall runs are summed into ONE wall input, because the `wall`
recipe reaches for the first structured input with `.find()` and three separate
walls would have priced one.

**Found by reading the generated migration SQL.** The measurement→calibration
foreign key came out as Prisma's default RESTRICT. Deleting a page cascades to
calibrations *and* measurements, and constraint triggers fire in creation
order — the calibration cascade runs first, so that RESTRICT would have blocked
the delete and broken `takeoffPlan.deleteMany` in **both cleanup scripts**. The
#227 shape, caught before it existed. It is explicit CASCADE now.

**Two deliberate costs, said out loud.** This adds the first PDF dependency to
the monorepo: `pdfjs-dist` pinned exactly at 4.10.38, legacy build (the modern
one needs `Promise.withResolvers`), imported inside an effect so it never
enters a server graph and never leaves its own lazy chunk — the shared bundle
is unchanged at 103 kB, and the worker is emitted by the bundler so
worker/API version skew cannot happen. And the PDF is served through an
authenticated route rather than its public blob URL, which costs function
egress and buys a company check on every read: a blob URL is not proof of whose
file it is (#195), and it also removes the unanswered question about that
host's CORS headers.

**Deliberately not built:** markup, comments, a sheet register, revision
compare. `NAV-IA-AUDIT.md` records the decision to stay out of the category
Procore, Fieldwire and Bluebeam own, and this stays a measuring tool that
happens to need a drawing. The issued set still belongs on `/drawings`.
`FEATURE-AUDIT.md`'s "plan/drawing takeoff via computer vision — Missing" row
is untouched, because this is manual on-screen takeoff and conflating the two
would make that row lie.
