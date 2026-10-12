### Found walls were drawn on every sheet, not the one they came from (Diego)

`diego/walls-own-sheet`

Reported from three screenshots on 2026-10-11: **Find the walls** was pressed on a
floor plan, and the identical dashed overlay then appeared on sheet 30, on sheet
52 and on S-101 — every run in the same place, on drawings it had nothing to do
with. Two of those are the partition-types sheet, whose own scale is
`3" = 1'-0"`, so the footage those lines implied was nonsense.

#### The comment above the bug described the fix

`found` was page-less state that `onFindWalls` set and nothing cleared. The
comment sitting directly above it read:

> That also means switching sheets or reloading simply forgets them, which is
> the correct behaviour for a proposal nobody acted on.

True of **reloading**. False of **sheets**, for as long as the feature has
existed. The same shape CLAUDE.md records elsewhere — a sentence everybody
believed because it described what the code ought to do, and which stopped
anyone looking.

There was even a working example of the fix one screen away: an effect that
clears the half-drawn shape on a page change, whose own comment says it exists
so points are not carried "from one sheet onto another". Nobody extended it.

#### Why this is the worst defect this feature can have

The whole posture is that a found wall is a **proposal** and the drawing
underneath is the **check** — the panel says in as many words "check they sit on
real walls before adding them". An overlay that follows somebody to another
sheet does not merely show a wrong number. It corrupts the instrument they were
told to verify with, and it does it most convincingly on a sheet where the walls
happen to land near some line work.

#### The page travels with the result, rather than an effect clearing it

Not another `useEffect`. An effect is a thing somebody has to remember, and this
file already had one that nobody thought to extend — that is how the bug
happened. Instead the result records the sheet it was read off, and one function
decides what a given sheet may show:

```ts
export function wallsOnThisSheet(found, foundOnPage, pageNumber) {
  if (found === null || foundOnPage !== pageNumber) return null;
  return found;
}
```

Both render sites — the results panel and the ghost overlay — read the derived
value, so neither can go around it. The raw state keeps a different name and is
asserted to appear exactly twice in the file, because reading around the guard
is precisely how this worked before.

It also makes paging **away and back** free: the proposal is still the answer to
the question somebody asked about that sheet, so returning restores it instead
of demanding another press.

It lives in `lib/takeoff/wallGroups.ts` rather than the viewer because
`client-boundary.test.ts` refuses a non-component value imported out of a
`"use client"` module — across the RSC boundary that arrives as a
client-reference proxy and not the function. It was written in the viewer first
and that guard caught it.

#### Checks

Preflight green, 10,038 tests, no migration. **Four mutations, four red**,
including the defect exactly as reported: drop the page comparison, read the raw
state, record the wrong sheet, label the result at render instead of when it was
read.
