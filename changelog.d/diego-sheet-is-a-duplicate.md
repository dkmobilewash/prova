### The sheet says what it is, and now something reads it

An M-101 carries the architectural walls in grey underneath the ductwork. An
A-111 carries them under the ceiling grid. The wall finder reads them correctly
— they ARE walls — and they are the **same walls the A-101 already has**, so
adding them bids the job twice.

`sheetSuitability.ts` was written for exactly this in October and says so in its
own header, naming *"13,767 feet invented across them"*. **On a real plan set it
has never said a word.** The takeoff page feeds it `effectiveSheetNumber` and
`effectiveTitle`, and both return `null` for a page with no `PlanSheetProposal`
row — which is every page of every set uploaded before the ingest shipped. One
real 52-sheet set reads *"52 need their numbers typed in"*: fifty-two sheets it
could not judge, including the mechanical ones.

### The fix was already written and had no caller

`plan-ingest/sheetNumber.ts` reads a sheet number and its title-block text with
no model at all. Its header states the problem this entry opens with, and ends:

> **IT HAS NO PRODUCTION CALLER YET, SAID OUT LOUD.**
>
> The takeoff page reads DB rows, not the PDF, so it cannot call this where it
> needs it.

That is true of the page and **not of the viewer**, which has the document open
and is already reading the page's text for the wall finder. So the reading is
one pure call away from where it was needed, and this is the "written,
documented, and never called" shape CLAUDE.md records — found by going looking
for the model-free route rather than by building a second one.

No schema, no ingest stage, no model, no allowance, no migration. It works on a
set uploaded a year ago.

### What it does on the bench's own drawings

Real PDFs, through the real title-block reader, into the real caution:

| sheet | read | verdict |
| --- | --- | --- |
| A-101 floor plan | `A-101` | **not a duplicate** — the sheet you measure on |
| A-401 enlarged plans | `A-401` | **not a duplicate** |
| A-111 | `A-111` | duplicate — *reflected ceiling plan* (**2,314 phantom ft**) |
| M-101 | `M-101` | duplicate — *mechanical plan* (**2,268 phantom ft**) |
| A-601 | `A-601` | duplicate — *schedule* |
| S-101 | `S-101` | duplicate — *framing plan* |

Every one read from the title-block **corner**, with no fallback to the wider
region. The two biggest phantom numbers on the whole scorecard now arrive with
a sentence naming what they probably are.

**Leaving the floor plan alone is the half that makes it usable**, and it has
its own test rather than being implied: a caution on the sheet somebody is
supposed to measure teaches people to ignore cautions.

### One slot, and the server wins it

Two readings of the same question now reach the viewer — a `PlanSheetProposal`
that a model read and an estimator may have corrected, and this one, read off
the drawing in the browser. The read one **fills a silence** rather than
competing: showing two sentences that say the same thing in different words is
how a caution starts being skipped.

That precedence is a named function, `cautionToShow`, and **it is a function
because three mutations survived it as an `||` in the markup**: never rendering
the element, dropping the read half, and inverting the precedence. All three
were invisible to a source census because the same two names appeared twice over
in that JSX — once in the guard and once in the value — so nothing could tell
which half it was looking at. One name in the markup, and the rule somewhere a
test can hold it still.

### Verified

- **9 of 9 mutations red**, control green — including *make it render nothing*,
  the precedence inverted, and the caution guarded but never printed.
- The **first** run had **three survivors**, all of them the `||`. They are the
  reason the function exists.
- `sheetKindFromDrawing.test.ts` runs the real fixtures through the real path
  rather than asserting a regex against hand-made strings, and pins that the
  reading comes from the corner — a drop to the wider fallback means the number
  is less certain and is worth knowing before it is trusted.
- The viewer's text extraction was **extracted rather than copied**. The wall
  finder reads the page's words and so does this; two copies of that coordinate
  convention is exactly the drift that put every text box one glyph height out
  last time, and nothing threw.
- `./scripts/preflight.sh` green. No schema change, no migration.

### A census this change broke, and the fix is the interesting part

`takeoffWallFinder.test.ts` locates the viewer's JSX with
`code.indexOf("\n  return (")` and asserts things about each half. A new
**module-scope helper** whose body returns a parenthesised expression sits
earlier in the file, so the split landed above it and every assertion was then
made about the wrong half — reporting *"the viewer never narrows the result to
the sheet"* about a line that was present and correct two hundred lines further
down.

Its own next line already said *"fix this before trusting it"*. It anchors on
`export function TakeoffPlanViewer(` now, so a helper added above cannot move
the split. The lesson is the repo's own: a check that derives its input has two
failure modes, and only one of them looks like a failure.

### What this does NOT do

It does not refuse the sheet. `sheetSuitability`'s header argues that case and
the argument stands: a wall genuinely can be measured on a section, and a
classification can be wrong, so a wrong one must not silently remove a
capability. It warns, names what it suspects, and leaves the decision where it
was.

It also does not help a **scanned** sheet, which has no text to read — the same
sheets the scale reader already refuses honestly.
