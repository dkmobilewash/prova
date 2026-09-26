### The pursuit value field stops reading a whole calculator as its own name (Diego)
`diego/pursuit-label-a11y`

`ConceptualEstimateHelper` was rendered **inside** the "Estimated value of our
scope" `<label>` on `/pipeline`. A `<label>`'s accessible name is its entire text
content, so that field's name was its own words plus everything the calculator
renders — "Gross area of the building (SF)", "Not saved — this is a calculator",
all of it. **A screen reader announcing the pursuit's value field read the whole
calculator as its label**, and two textboxes answered to that name by substring.

The helper is a sibling of the label now, wrapped with it in one `<div>` so the
grid cell is unchanged. The input stays inside its own label, so the field keeps
its implicit association — moving that out would have traded one accessibility
defect for a worse one, a textbox with no accessible name at all.

**Found by Cyrus's e2e spec on #505, not by anything in this repo's own checks**,
and the way it surfaced is the useful part: the spec asked for the gross-area
textbox by name with `exact: true`, because without it two textboxes matched. He
wrote up why rather than working around it silently, and left it as my markup and
my call.

**The comment above that helper said "BESIDE the field, never inside it" the
entire time it was inside.** That is this repo's most expensive recurring shape —
a sentence asserting the thing it does not enforce — and it was my sentence. So
there is a guard now: `bidPursuitList.test.ts` asserts the helper is not a
descendant of the label, that the label's text contains none of the three strings
the calculator renders, and that the input is still inside the label. Both
assertions were mutation-tested by putting the helper back inside; two go red.

It asserts **structure rather than a computed accessible name**, deliberately and
said out loud in the file: happy-dom does not implement accname, so a "name"
assertion here would be my own reimplementation of the algorithm agreeing with
itself. Whether the helper is a descendant of the label is the actual defect and
is a fact about the DOM that cannot be faked. It also checks both elements are
present, so it cannot pass by neither being rendered — the way a structural
assertion goes vacuous.

`estimating-spine.spec.ts`'s comment is corrected in the same commit. It
described the defect as live and pointed at the fix as Diego's call; leaving that
standing would have been a known-false sentence on `main`, which this repo has
paid for repeatedly. `exact` stays in the selector, now as the more precise
request rather than as a workaround, and the comment says which.
