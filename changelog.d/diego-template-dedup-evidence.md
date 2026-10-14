### The de-dup was telling an estimator it had removed the title block

Found by clicking, on a real drawing, on production. A West Herr floor plan: the
panel said

> 12,641 lines on this sheet also appear in the same place on the rest of the
> set — **the border, the title block and the logo** — so they were left out.

and about **32 runs sat on the title block and the logo** in the overlay
underneath it, 323 ft of them.

The filter establishes exactly one fact: these lines are at the same page
position on other sheets of the set. Which drawing furniture that turned out to
be — and whether any was missed — it never checks. Naming three kinds told an
estimator all three were handled, which is the same defect as the no-walls
sentence a few lines below it in the same file, where "a scanned or image-only
sheet" was asserted as the cause of an empty panel on a drawing that was plainly
not a scan. **A message may state what was measured; it may not name a cause
nobody checked.**

It now says what it knows and what it does not:

> 12,641 lines on this sheet are in the same place on other sheets of the set, so
> they were left out as page furniture. Not all of it recurs closely enough to
> catch — a border, title block or logo can still show up below, so check the
> runs against the drawing.

### And a whole sheet of strictness nobody had noticed

`ON_MOST_SHEETS` was documented as *"0.7 of six samples is four"*. It is not:
`6 * 0.7` is `4.199999999999999` in floating point, so `Math.ceil` returns
**five**. The filter has always been one sheet stricter than its own
documentation, and strictness is the direction that leaves furniture on the
drawing. The sample count was wrong too — `pagesToSample` returns six band
midpoints **plus the current page**, so a real run usually has seven samples.

Pinned as a sheet count rather than restated as prose, because prose is what
drifted: a deliberate change to that constant now has to come to the test and
write down what the new threshold is.

### Why the constant is NOT moved

Because nothing has measured it. `sheetTemplate.test.ts` builds its sheets by
hand, so every case measures the rule and none measures a drawing — and both
bench sets were run through the real filter and **neither can reach the
threshold's margin**:

| set | this sheet's segments | template | recurred on |
| --- | --- | --- | --- |
| mesa-ridge-bid-set, p5 | 10,816 | 26 | 6 of 6 |
| desert-willow-bid-set, p3 | 149 | 18 | 7 of 7 |

Our generator draws a bare frame and no title block, so the furniture recurs on
*every* sampled sheet and the threshold is nowhere near. Lowering it would change
nothing there while silently deleting real wall on a tower of identical floors.

### The instrument that would settle it

`lib/takeoff/realplan/sheetTemplate.eval.ts` prints the **recurrence histogram**
for a real set, because the one number on screen cannot tell the two failure
modes apart and they want opposite fixes:

- **the grid** — the furniture recurred everywhere and matched nowhere, because a
  page origin or page size differs by more than `TEMPLATE_GRID`. A mass at ONE
  sheet that collapses when the grid is loosened.
- **the threshold** — the furniture recurred on four of seven sheets and four is
  not five, because a consultant's sheets carry their own frame. A mass just
  under the line.

The histogram is built from `templateFromSheets` itself at a rising
`onMostSheets` rather than from a copy of its key format, so it cannot drift from
what production would drop — cross-checked against a throwaway probe that did
copy the format, same numbers. Metadata only: counts, page widths, grid sizes,
and the basename of a path the person chose.

`sheetTemplate.test.ts` already predicted this. Its grid-boundary case says *"if
a real set ever shows its title block surviving this filter, THIS is the first
thing to check"*. It has now happened, and the entry records that the prediction
names two candidates rather than one.

### Verified

Five mutations red: the message naming the title block again, the honest limit
dropped, the census reading comments (it must — the comment beside the message
quotes the forbidden phrase, which is CLAUDE.md's twice-paid-for trap), the
threshold moved silently, and the eval reimplementing the key instead of calling
the real function.

### What this does not do

**It does not stop the 32 runs.** Which constant is wrong is not knowable from
any drawing in this repo, and inventing one from no measurement is the kind of
constant this directory keeps deleting. The eval has to be pointed at the sheet
it failed on.
