### A shop decides whether openings come off the board, instead of this app deciding for them

`boardedArea` has taken an `openingDeductionThresholdSqFt` option since it was
written, and **nothing in the product has ever passed it** — only its own unit
test. So every company got the hardcoded 32 sq ft default: a storefront
deducted, a door not. That default is the right one for most subs, and it was
the only one available, so a shop that genuinely deducts every opening was
having its work bid by somebody else's habit with no way to say so.

It is now the fourth question in Settings' business scope — *"When you bid
board, do you take the door and window openings off the quantity?"* — with
three answers (**bid the wall solid** / **only the big ones** / **every opening
comes off**), read where the wall schedule loads and handed to `scheduleLines`.

**Unanswered changes nothing.** The column is nullable with no default, and
`openingThresholdSqFt(null)` resolves to the same 32 sq ft the app already
used, so no existing quantity moves. The question is deliberately **not**
required: the other three business-scope answers gate onboarding, and a fourth
required answer would stop every company that has already answered them from
saving the form.

### The change that was built, measured, and NOT shipped

This started as "make traced runs stop at doors", after lines were seen running
straight through doorways on a real dealership plan. It was built and graded
against the bench's own net-of-openings key, where it is a clear win —
not-on-a-wall footage falls **4,220 ft on Mesa Ridge and 1,100 ft on the 20
holdout plans**, with found footage unmoved:

| join limit | Mesa found | Mesa not-on-wall | holdout found | holdout not-on-wall |
| --- | --- | --- | --- | --- |
| 8 ft (today) | 59,118 (82.3%) | 9,673 | 30,718 (97.2%) | 1,791 |
| 2 ft | 59,250 (82.4%) | 5,727 | 30,654 (97.0%) | 696 |
| 0 | 59,502 (82.8%) | 5,453 | 30,650 (97.0%) | 691 |

**It was reverted anyway, and the reason is the whole point of this entry.**
A 3'-0" × 7'-0" door is 21 sq ft, under the 32 sq ft threshold, so it is *never*
deducted today — gross is the final quantity on purpose. `mergeWalls.test.ts`
already argued it from a hand count: *"GROSS is the correct take-off and two
fragments either side is the underbid."* Stopping the run at the door would not
have removed a double-deduction; it would have removed 21 sq ft of board per
door from the bid — board that is still hung, cut out and framed with a header.
On a forty-door plan that is ~840 sq ft nobody charges for.

So the visual complaint was real and the number behind it was right. What was
actually missing was not different geometry, it was the shop's own say in it —
which is what shipped instead. The measurement is kept here because it is
sound, and because a shop that answers **every opening comes off** is the one
for whom stopping at openings would be the correct geometry; that is the next
place to look if this question's answers ever need a fourth.
