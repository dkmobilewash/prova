### 488 ft of a real drawing was behind a sentence (Diego)

`diego/nothing-hidden`

The first click-through after #732 reported:

> **And 9 smaller groups, holding 488 ft between them.**

No row, no colour, no button. **26% of the sheet**, unreachable — and it is a
regression from #732's own change: splitting a thickness bucket by tag turned
School-01's eight groups into seventeen, while the panel still showed a fixed
handful.

#### Two defects, and the second is the worse one

**The list was cut by COUNT.** Eight rows, then prose. The cap moved from six to
eight when the split landed, which was a guess and was not enough.

**The list was ORDERED PER CLUSTER**, so the cut did not even land in the right
place: tagged groups then remainder, cluster by cluster. Some of what fell below
the fold was **larger than what was shown**. A 17 ft group had a row and a
button; a 140 ft group did not.

#### The list is a work queue, not a summary

So it is ordered by what matters most — **footage, across the whole sheet**, a
tie going to the group the drawing named, because a name is a better answer than
a thickness. And **everything past the fold is one press away**, with the
footage printed on the control so pressing it is not a leap.

That changes which row comes first on School-01: the 607 ft of untagged wall now
leads, because it is the biggest single thing on the drawing. Burying it under
three smaller answers is exactly what hid the 488 ft.

#### And the panel stopped promising something it cannot do

The headline read *"Each group is drawn on the sheet in its own colour"*. There
are **six colours**. That was true at six groups and false the moment the split
multiplied them — the same click-through reported lines that looked like they
belonged to a different group. It now says to hover, which is what actually
distinguishes them, and has since the panel shipped.

#### Checks

Preflight green, 10,032 tests, no migration. **Seven mutations, seven red** —
including the two shapes this could have regressed into: expanding that reveals
only one more page, and an expanded state that survives a re-run and shows a
fold that is not there.

Two existing cases asserted the old order and were **updated rather than
deleted**, each carrying the reason: ordering per cluster was good reasoning
about the wrong list.

One more thing the censuses caught on the way: the expander was written with
`text-ink-link`, which is not a token in this app's palette — Tailwind emits
nothing for an undefined class, so the control would have rendered **with no
colour at all**. `colorTokenCensus.test.ts` failed the build on it.
