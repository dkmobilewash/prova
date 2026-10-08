### Point it at a folder of drawings and ask (Diego)

`diego/scale-audit`

#655 derives a sheet's scale from the dimensions printed on it, measured against
**one** real CAD export. The part tuned on that one file is the riskiest: the
rule that a dimension label sits centred on the line it measures, within a fixed
distance of it. That is how one program draws dimensions. Revit, AutoCAD,
Vectorworks and ArchiCAD each place the text a little differently, and if one
puts it further off the line the feature **declines on every sheet from that
program** — which looks like nothing rather than like a bug.

So the measurement needed to be cheap to repeat on whatever files turn up:

    SCALE_AUDIT=~/Downloads/some-bid-package pnpm scale:audit

One command, a table per page, and a summary. It writes nothing, stores nothing
and sends nothing anywhere — the files are real customer bid packages, so this is
a tool aimed at them rather than anything that keeps a copy.

**THE ANSWER KEY IS ALREADY ON THE SHEET, AND COSTS NOTHING.** Most sheets print
their scale in the title block, which makes two INDEPENDENT readings of one
fact: the characters an architect lettered, and the geometry #655 derives.
Agreement across forty sheets is real evidence; a disagreement names exactly
which sheet to open. And it needs no model and no spend — `titleBlockText`
already extracts that region and `standardScaleFromText` already matches a
printed scale name onto the standard table, which is what `calibrationNotices`
uses for its own title-block warning. Both reused rather than paying a
`plan-title-block` call per page.

Six outcomes, and the distinctions are the point:

| | |
| --- | --- |
| `AGREES` | both readings, same scale. The result. |
| `DISAGREES` | both readings, different scales. **Open this sheet.** |
| `MISSED` | the title block names a scale and the geometry declined — there was an answer and it was not found |
| `NO_TITLE_SCALE` | derived a scale; the sheet prints none to check against. NOT a failure |
| `DECLINED` | neither found anything. A cover sheet or a detail page, and the right answer |
| `ERROR` | the page could not be read |

The headline is the agreement rate over pages where **both** readings exist,
because those are the only ones where agreement means anything.
`NO_TITLE_SCALE` is excluded — counting it either way would move the figure for a
reason that is not about accuracy — and `MISSED` counts AGAINST, because
excluding it would let a reader that refuses everything score 100%.

**On the real export it reports `NO_TITLE_SCALE` and says
`agreement: NOT MEASURABLE`.** That sheet prints no scale anywhere
machine-readable, which was already known and is worth having the harness say
plainly: *"100% of nothing"* is the figure that would ship a feature on no
evidence.

## What the mutations found, which is the useful part

**Eleven mutations, all red** — but three were green first, and each was a real
gap:

**The judgement itself was untested.** Flipping `DISAGREES` to `AGREES` — the
audit calling a wrong scale right, the single thing it exists to notice — left
the whole suite green, because every test reached the arithmetic and none
reached the classification inside `auditPlanFile`. It is now `classifyOutcome`,
a pure function with its own table.

**"You pointed me at nothing" was one assertion in a hand-run script.** A path
matching no PDF produces a run with no pages, no disagreements and a clean
summary — a typo in a folder name is the whole of what it takes. Path handling
moved into `planFilesUnder` and is tested: a missing path, a folder with no
PDFs, a subfolder that must not be descended into, `~` expansion.

**And a census I did not know about caught the eval itself.**
`lib/ask/eval/harness.test.ts` requires every `.eval.ts` to demand an API key at
collection, so none can pass on nothing. This one calls no model, so there is no
key to demand — but the census's property applies to it exactly. Rather than
bypass it, the census now takes a NAMED exemption and re-proves the same promise
by the means this eval actually has: it must `skipIf` with no input, and must
assert its input resolved before reading any figure off a run. Four mutations
red, including the one that matters — a real model eval losing its key check is
**not** covered by the exemption.

Detecting "calls a model" was tried and rejected as the discriminator:
`@prova/integrations` is imported by eight evals and not by the two in
`lib/ask/eval/`, which do call one. A named exemption with its own assertions is
the `clerkMountGate.test.ts` pattern, and for the same reason — an exemption
nobody checks is a hole, and one the guard re-proves is a second kind of
guarantee.

One smaller fix: the candidate pattern missed the true prime marks (`′` U+2032,
`″` U+2033), which is what a CAD title block actually letters a scale with.
`standardScaleFromText` normalises them but never sees a candidate the pattern
did not find first.

**No product code and no schema.** Four gates green: 9,198 unit tests, 678 db
tests, typecheck, lint. Nothing from any drawing is in the repo.

## And then it was pointed at two more real sheets, which is the whole point

Diego supplied an overall floor plan (ARCH D, 36x24) and an enlarged plan (ARCH
E1). Three real sheets now, two scales, three CAD origins — and **the harness
found more in one run than any amount of reasoning had.**

| sheet | derived | printed | outcome |
| --- | --- | --- | --- |
| Augusta, enlarged plan | `1/4" = 1'-0"` | `1/4" = 1'-0"` | **AGREES**, 0.01% |
| SCHD, upper level | `1/8" = 1'-0"` | none printed | `NO_TITLE_SCALE`, 0.31% |
| Colton, overall plan | — | `1/8" = 1'-0"` | `MISSED` |

**`1/4" = 1'-0"` is now proven on a real sheet at 0.01%**, which was the scale
#655 had never seen outside a synthetic fixture. And `AGREES` is the first
INDEPENDENTLY VERIFIED derivation: the geometry and the architect's own printed
caption, two readings, same answer. **Zero disagreements across three sheets —
it has never derived a wrong scale.**

### A bug in this harness, found by the sheet it was built to check

Augusta first reported `NO_TITLE_SCALE` while printing `1/4" = 1'-0"` in plain
text — at x=958 on a 3,024pt page, **beneath the drawing** rather than in the
title-block corner, with the block itself saying `SCALE: AS NOTED`. That is not
a missing answer; it is the ordinary convention, where each view is captioned
with its own scale and the block defers to them.

So the answer key was on the sheet and this was looking past it, which would
have read as an unverifiable derivation forever. It scans the whole page now,
and returns ALL distinct scales rather than the first: a sheet carrying a plan
and an enlarged detail prints two correct ones, and taking whichever matched
would manufacture an `AGREES` — the one outcome an audit must never produce.
That is the new `MANY_PRINTED`, excluded from the headline for the same reason
`NO_TITLE_SCALE` is.

### A hard limit, named rather than hidden

Colton carries **79,001 stroked segments and 85 text items, every one of them
title-block content** — the firm's address, the project name, the stamp. No room
names, no door tags, no dimension strings but two strays. Its drawing-area text
was converted to OUTLINES when the PDF was made, which a CAD export does
routinely, and **you cannot read dimensions that are not characters.**

The decline is correct. What was wrong was the sentence: "no printed dimensions
were found" on a sheet visibly covered in dimensions reads as the feature being
broken, and an estimator who believes that stops trusting the rest of it. It now
says which fact it is — plenty of line work, almost no readable dimensions, its
lettering saved as line work, set it by hand. The discriminator is measured:
167,911 / 79,001 / 23,351 segments on the three real plans against a cover
sheet's handful.

### Two more mutations that came back green first

**The multi-scale decision was in the caller, not the tested function.**
Cherry-picking the first of two printed scales passed a suite written for this
feature, because every test reached `printedScalesOnPage` and none reached the
caller's choice. `classifyOutcome` takes the whole list now.

**And the prose filter was defence in depth against the wrong sentence.** The
real disclaimer it was written for — "Do not scale dimensions from prints… not
always drawn to scale" — carries no `X = Y` figure, so dropping the filter
changed nothing. What it is actually for is the general note that DOES:
`DETAILS ARE DRAWN AT 1/2" = 1'-0" UNLESS NOTED OTHERWISE` is ordinary on an
ordinary sheet, and without the filter it becomes a second printed scale and
costs a checkable page its answer key. That is the test now.

Eight mutations on this round, all red. Four gates: **9,210 unit tests, 678 db
tests**. Nothing from any of the three drawings is in the repo.

## A 76-page bid set, which is what the harness was built for

Diego supplied a full bid package. **76 pages in 7.4 seconds**, and the number is
not flattering:

| | |
| --- | --- |
| `AGREES` | 1 |
| `DISAGREES` | **0** |
| derived, nothing printed to check against | 8 |
| `MISSED` — a scale IS printed and none was found | **16** |
| `DECLINED` — cover, specs, schedules, civil | 45 |
| **agreement where both readings exist** | **5.9%** (1 of 17) |

So it reads 9 of 76 sheets. Where it reads one it is essentially exact — p19 at
**50 of 199 dimensions and 0.00%**, p45 verified against its own title block at
0.00%, p32 at 0.00%, p16 at 0.00% — across FOUR scales (1/8", 1/4", 1/2" and the
3/4" sheets it declines). **Across 79 real pages it has never produced a wrong
scale.** The problem is coverage, not accuracy.

### The 16 are diagnosed, the fix was built, and it made things WORSE

CAD does not draw a dimension line through its own numerals — it breaks it:
`|———— 113'-0" ————|`. So the label sits at the INNER END of each half and never
near either half's middle, which the centring rule rejects. That is a real
convention, and page 47 proves the halves are all there is: a `113'-0"` dimension
needs a 1017pt line, **no segment on that page is 1017pt, and the longest
anything on it is 894pt.**

It followed that rejoining the halves would rescue those 16. **It did not.** Both
attempts went backwards against the 9 sheets the centring rule alone reads:

| pairing | sheets read |
| --- | --- |
| centring only — what ships | **9** |
| + rejoin the halves across the gap | 3 |
| + require the gap to match the lettering's width | 7 |

The extra candidates scatter the vote until no scale wins its margin, so the
cost lands on sheets that WORKED. The margin rule is doing its job: it declines
rather than guessing. Requiring the gap to match the label's own width is the
tightest constraint the geometry offers, and it recovered two of the six lost
sheets and nothing more.

**So it is reverted, and the refutation is written into
`scaleFromDimensions.ts` beside the rule it was meant to replace** — with the
table, so the next person does not spend two days rediscovering it. The 16
remain unexplained by this mechanism; what is now known is that they are not
fixed by it. Six of them find **zero** readable dimensions at all, which is
Colton's outlined-lettering case and not a pairing question.

This is the same shape as the symbol-counting refusal: a measurement that says
no is worth building, and a fix that makes a number worse does not ship because
its story is good.
