### Which floor a sheet draws, read off its own title (Diego)

`diego/sheet-level`

Step 3 of an estimator's day is *"tag measurements by phase, floor level,
building, scope zone"*. #694 gave a measurement its **pricing package** — base
bid against an alternate. The other axis is the **floor**, and it has been typed
by hand or not recorded at all.

The drawing already says it. A sheet titled `LEVEL 01 - OVERALL FLOOR PLAN` or
`FIRST FLOOR PLAN` names its floor in the title block, and the takeoff toolbar
now shows it beside the scale — so an estimator knows which floor they are
tracing without leaving the sheet.

Derived at read time and stored nowhere, like the printed scale beside it.
**No migration.**

#### It reads the TITLE, not the title block — and that is the whole correctness argument

A probe over five real sets matched a level in `titleBlockText()` — the whole
corner region — on 25 of 31 Augusta plan sheets, which looked like a result.
Reading what it had actually matched:

```
Naples p8   "SCOPE OF WORK FOR THE FIRST FLOOR AREA WILL BE NIGHT WORK"
SRFR p3     "CIENCY PACKAGE OPTIONS & NEW) LEVEL 1 THE FOLLOWING…"
SRFR p5     "(E) MAINTENANCE BAY FLOOR LEVEL 1  3,244 TOTAL"
```

General notes and a schedule row. **The level they returned happened to be
right**, which is worse than being wrong: a rule that works by luck on the
sheets you tried mislabels a quantity on the one you did not. So this takes the
extracted title — one short string naming what the sheet is — and nothing else
on the page can reach it.

#### A sheet covering two floors gets no level at all

Naples prints `ARCHITECTURAL PLAN - FIRST & SECOND FLOOR`. The first floor named
has no floor word after it, so a single-match rule reads the whole sheet as the
second — confidently, and wrong for half its quantities. Found by running the
real rule over real title strings rather than over fixtures only.

Declining leaves the estimator to split it, which is work they had to do anyway
and now know about.

#### Measured on five real sets

Correctly levelled: `LEVEL 01 - OVERALL FLOOR PLAN`, `FLOOR PLAN - LEVEL 1`,
`FIRST FLOOR DIMENSION PLAN`, `SECOND FLOOR PLAN - DUCTWORK`, `ROOF PLAN`.
Correctly silent: `SITE PLAN`, `CARPORT PLAN`, `ENLARGED PLAN - TOILET ROOMS`,
`LIFE SAFETY PLAN`.

Only on a `PLAN`: `FIRST FLOOR` in an elevation's title names what is *drawn* in
it, not where the sheet's quantities live.

#### Two limits of the data, recorded as tests because each reads like a bug

- **There is no `acceptedPageType`.** `PlanSheetProposal` lets somebody correct
  the sheet number and the title and nothing else, so a plan the model filed as
  a `DETAIL` gets no level however its title reads, and no amount of correcting
  on the review screen changes it. The alternative — trusting the title when the
  page type disagrees — hands a level to every elevation whose title names a
  floor, which is the thing this refuses on purpose.
- **A mezzanine sits between floors.** `LEVEL 3 MEZZANINE` is above level 3 and
  below level 4. A flat order for every mezzanine sorted a ground-floor one
  above the top storey, which the stacking test caught.

#### Checks

- `sheetLevel.test.ts` — 21 cases. **Six mutations, all red**: any page type
  levelled, a roof filed among the numbered floors, a two-floor sheet tagged
  with one, every mezzanine sorted above every floor, the machine's guess
  beating a correction, and levels no longer in building order.
- A seventh mutation came back **green and the right answer was to DELETE the
  code it touched**: a guard reading "only count a bare ordinal when a floor
  word is about" could not change a single outcome, because a count above one
  only ever declines and with no floor word nothing matches anyway. A guard that
  cannot change an answer is a line read and understood forever for nothing.
- `takeoffSheetLevel.test.tsx` — a RENDER test per #665, plus a census of the
  call site, because the label is computed in a server component and threaded
  through two props: forgetting either hides it and breaks nothing.
- **One mutation needed a census rather than a render, and it says so.**
  Hardcoding the lookup to page 1 passed every render test, and on a 50-page set
  would print the first sheet's floor on every sheet. A render test cannot catch
  it: the pager only exists once a PDF has loaded its page count, happy-dom
  cannot load a PDF, so `[pageNumber]` and `[1]` are the same expression there.
  **Seven mutations, all red.**
- **No customer drawing is a fixture.** Every title here is written to the shapes
  measured above.
