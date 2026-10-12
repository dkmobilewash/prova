### A wall type can name a group before it can price one (Diego)

`diego/name-before-price`

Measured on School-01, 2026-10-11, at the end of the chain this work has been
building. The partition schedule on A-501 was read into ten wall types — A1, A2,
B1, C1, D1, F1, EXT-1, EXT-2, CMU, SF — each carrying the thickness the drawing
prints. **Find the walls** on A-101 then found 63 runs, tagged them `A1` and
`A2` off the drawing, and said:

> Nothing on the drawing names these and **no wall type you have is 4-7/8"
> thick**.

beside a row it had just tagged A1, with A1 sitting in the library at exactly
4-7/8". The row below it said the quiet part: *"you have no wall type A1 **with
layers on it**."*

#### Neither sentence was lying, and neither was the matcher

`page.tsx` queried `components: { some: {} }` — types with layers — and handed
that list to the wall finder. The reasoning was right about POSTING: a layerless
type produces no line items, so posting a group as one adds nothing to the
estimate and loses the quantities it replaced. It was applied to NAMING, which
is a different question.

The import's own button promises the opposite:

> Each one arrives with its thickness, **so a wall measured on the drawing can
> find it.** You still add your own parts and prices.

The second sentence describes the thing that made the first one false.

#### The gate moved to where the constraint is

Naming sees every wall type. Pricing still requires parts. `PostableWallType`
is `MatchableWallType`, with a `hasParts` field that is a fact on the row rather
than a filter on the list, and `pricedTypeFor` is now `namedTypeFor` plus that
flag.

**The invariant the old comment protected is intact**: the button's words and
the form's `wallTypeId` both read `pricedTypeFor`, so they cannot disagree. What
changed is that the LABEL reads `namedTypeFor` — a group the drawing calls A1 is
"A1 wall" in the measurement list whether or not A1 has parts yet. Losing the
name because the parts are missing would throw away the half of the schedule
import that already works.

`postMeasuredWallRun` refuses a layerless type server-side, unchanged — a form
can send anything.

#### And the screen says which half is missing

| state | button | sentence |
| --- | --- | --- |
| named, has parts | `Add as A1 — priced` | "…which is your A1 — A1 partition." |
| named, no parts | **`Add as A1 — not priced yet`** | "…It has no parts on it yet, so these can be added as measurements but not priced — put the studs, track and board on A1 under Wall types and they will price themselves." |
| unnamed | `Add these` | unchanged |

"Add these", with no explanation, is what sent somebody to the wall-types page
looking for a fault that was not there.

#### Two mutations were green, and they were the two that mattered

Reverting that one prop to `postableWallTypes` restores the defect exactly, and
**every test in the repo stayed green** — because they all reason about the
matcher and the viewer, and the bug was in the page. The matcher was right about
the list it had. The viewer was right about the list it had. The list was wrong.
CLAUDE.md's sentence for it: *nothing is ever missing from a list nobody
imports.*

So there is now a census over `page.tsx` asserting which of the two lists is
wired to which consumer, with a size assertion under it so a path that stops
resolving fails loudly instead of passing every `not.toMatch` above it. A census
is the right instrument here rather than a fallback: the question is not what a
function computes but which value is wired to a prop.

#### Checks

Preflight green, 10,056 tests, no migration. **Five mutations, five red, zero
blind** — including the defect exactly as shipped, and the posting gate being
dropped rather than moved.
