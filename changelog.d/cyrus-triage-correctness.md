### What actually changed, in plain English (Cyrus)
`cyrus/triage-correctness`

Two real defects out of a ten-issue triage of the correctness lane. The
other eight are a verdict rather than a change, and five of them turn out to
be already fixed — the report to Cyrus carries the evidence for each.

**The Hours box stopped pretending to be filled in.** On a job's *Field time
entries* form, the Hours box said `8` as its placeholder. A placeholder sits
in the same box, at nearly the same weight, as a real entry — so the box
reads as already answered. Issue #305 was filed because an automated
click-through set the date, pressed **Log time**, and reported a silent
payroll failure. Nothing had saved: `required` had refused the submit with
the browser's own native bubble, which is transient, unstyled, and invisible
to a screenshot. The agent read the placeholder as a value, which is the
whole defect in one sentence. It says `hrs` now, which is what every other
hours box in this app already said — the estimate tab's Labor hrs, the five
overtime thresholds on a pay rule set, the apprenticeship classroom hours.
One field was the outlier.

**The fix that must never be made is now a failing test.** The tempting
repair is to default the VALUE to 8. That is strictly worse than the bug: a
form that pre-fills eight hours logs eight hours for anybody who forgets to
change it, and that figure goes onto a WH-347 carrying a criminal
certification. So `numericInputCensus.test.ts` now fails the build on an
hours box whose placeholder is a bare figure AND on one pre-filled with a
literal figure. It reuses that file's existing walk, so it inherits the
scope assertion (repo root, checked against `git ls-files`) and the comment
stripping, and it names three anchor fields as well as a floor — a floor
alone cannot notice a pattern quietly shrinking to one match.

**And the new guard was itself vacuous until a mutation said so.** The
pre-fill half was GREEN against a real `defaultValue={8}`. The shared
`inputTags` walk COLLAPSES every braced expression to `{}` — it has to, so
an arrow function's `>` cannot end a tag early — which means a hard-coded
figure and `{defaults?.hours ?? ""}` are the same four characters by the
time the rule sees them. A one-line rewrite of a bare numeric literal into a
quoted one puts it back in view, and there is a control test for that
rewrite, because without it the rule is green about exactly the fix the
issue says must never be made.

**Change orders were the last place in the app that deleted on one click.**
Issue #258. `ChangeOrders.tsx` removed a proposed change from `onClick` and
threw a draft change order away from `onSubmit`, both on the first press,
against this app's "two-step delete, never `window.confirm`" rule. It had
been left alone because change orders were the other lane, and it was
recorded as one documented exception in `rowActionsCensus.test.ts` — which
is what made waiting safe rather than merely tolerable: the rule stayed
armed for every other file for the whole time. Both controls are
`<ConfirmDelete>` inside a `<RowActions>` now, and that exception list is
empty.

**The placement rule, measured rather than reasoned.** Cancel inherits the
pixel Delete vacated, and which end that is depends on the cluster's
alignment. Real Chromium, the class strings as shipped, confirm overlap as a
share of the box the delete vacated, at 1100 / 639 / 375:

| cluster | value | confirm covers | cancel covers |
| --- | --- | --- | --- |
| proposal row (right-pinned) | `pinned="end"` — shipped | **0% / 0% / 0%** | 89% / 100% / 100% |
| proposal row (right-pinned) | `pinned="start"` | 100% / 0% / 0% | 0% / 100% / 100% |
| draft actions (left-aligned) | `pinned="start"` — shipped | **0% / 0% / 0%** | 0% / 0% / 100% |

So the right-pinned row needed `end`, exactly as the census rule says, and
`start` would have put the confirm under a hurried second click at desktop
width. The draft-actions cluster is safe either way and keeps the default.
Cancel does not inherit the pixel there at the two wider widths, and that is
structural rather than a regression: the Discard button sits to the RIGHT of
a wide "Send to GC" form, and hiding that form reflows the pair to the left
edge, so nothing is at the delete's pixel at all. The confirm is not, which
is the property that matters.

The first version of that measurement was wrong in the way this repo keeps
paying for. It anchored the vacated box to the CONFIRM's top, which
guarantees vertical overlap by construction — so the phone column reported
100% on every row, a script that could only ever report a hit. Anchored to
the top of the armed cluster, which is where the delete actually was, the
phone column reads 0% as designed.

**"Discard draft" became "Discard", and that is the label rule not a whim.**
A LONG delete label makes the armed pair narrower than the button it
replaces, so the pair stops covering the same span and the confirm drifts
under where the label used to be. `rowActionsCensus.test.ts` caps a delete
label at 12 characters; "Discard draft" is 13. What is being discarded is in
the hover description and in the card's own heading, which cost no width.

**Two controls need two tests, and the census could only ever give one.**
The callback census is FILE-LEVEL by design and says so — a file with two
deletes can satisfy it with one. Proved rather than assumed: with the
exception removed, reverting EITHER control on its own leaves that census
green. So `changeOrderConfirms.test.ts` renders a draft change order and
clicks both controls, in both orders, and asserts that "Send to GC"
disappears while the discard is armed (rule 1). Four mutations, each
reintroducing the exact defect, each confirmed applied by diff before the
run: one-click remove → 4 red; one-click discard → 4 red; `pinned="end"` →
`"start"` → red in both the new test and the census, despite the comment
above the prop quoting `pinned="end"` verbatim, because that census strips
comments first.
