### Pending versus executed change orders, said on the screen (Cyrus)
`cyrus/change-order-states`

A construction manager reviewing the product stopped on the change orders
section and asked "is this for executed change orders or for pending change
orders? There's a big difference. I'd clarify that." He is right, and the
difference is money: an executed change order has already moved the contract
sum, a pending one has not and may never.

**The model was never wrong, and that is the finding.** `ChangeOrderStatus`
is `DRAFT → SUBMITTED → APPROVED / REJECTED / VOID`, and the schema comment
on `SUBMITTED` has read "This is the PCO state" the whole time. `VOID`
already existed, so the voided state he asked for was already built. Nothing
about the lifecycle needed re-modelling — no migration, no new column, no new
action, no new number. What the section did was render one flat
`<h2>Change orders</h2>` over all five states, with the only difference a chip
at the end of the row. **The screen did not say what the model knew.**

So it now bands them, in lifecycle order, each labelled in the words a
contractor actually uses: **Drafts**, **Pending change orders (PCOs)** — also
called change order requests, ours, sent, NOT in the contract sum —
**Executed change orders** — theirs, agreed, already in the contract sum — and
**Closed with no change to the contract**, which holds rejected and withdrawn
together because a PM wants both for the same reason, while the chips inside
keep "the GC said no" and "we stopped asking" apart. Every row also states its
own effect on the contract sum, and the dollar figure on a row now carries
what it is: "+$18,400 requested" against "+$18,400 in the contract". A bare
figure on a PCO read as money the job had.

Two smaller things came out of it. The **Withdrawn** chip was
`bg-surface text-ink-muted` — the card's own colour, so the one outcome he
specifically named as needing to survive a dispute had a chip with no ground
at all; it is on the neutral tag pair now. And a change order whose state no
band claims is rendered under "Not classified" rather than dropped, because a
grouped list is one enum member away from silently hiding a record, which is a
worse version of the complaint that started this.

**The check.** `changeOrderStates.test.ts` reads `ChangeOrderStatus` OUT OF
THE SCHEMA rather than typing it out here — a hand copy notices nothing, since
adding a member does not touch the test file, which is how issue #150's
`safetyLabels` guard stayed green through exactly the change it existed to
catch. It asserts the parse found the enum before looping (an empty parse
fails loudly instead of passing vacuously), that every schema status is
claimed by exactly one band, that `groupIntoBands` returns every input either
in a band or in `unbanded`, and that the component maps over both. Nine
mutations, each watched red and restored: collapsing pending into executed,
dropping `VOID` from its band, swallowing unbanded rows, reverting the chip
colour, deleting the unbanded render, deleting the per-row contract-effect
line, renaming the enum the parser looks for, flipping the approved sentence
to claim the money is not booked, and re-adding a `VOID` filter to the list.
