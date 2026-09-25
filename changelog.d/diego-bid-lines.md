### A bid stops being one number (Diego)
`diego/bid-lines`

`BidInvitation.bidAmount` is one figure, and a GC's bid form almost never asks
for one. It asks for a base bid, then a list of **alternates** it may or may not
take, then **unit prices** it will hold you to when the scope changes, and
sometimes an **allowance** for work nobody has drawn yet. Before this there was
nowhere to put any of them, so they lived in the `notes` field or in the
estimator's head, and the number on our bid could not be reconciled against the
number on the GC's form.

`/bids` now carries all three per bid, and totals them.

**The three kinds sit in three different places relative to the base bid, and
mixing them up produces a number that reads perfectly and is wrong.** That is
the whole design:

- an **allowance** is already *inside* the base — reported so an estimator can
  see how much of their own number is undefined scope, and **never added to
  it**. Adding it sends the bid out high by exactly the allowance, and nothing
  on the page looks wrong: the allowance is genuinely part of the job and the
  arithmetic is genuinely addition.
- an **alternate** is *outside* the base and changes the award only once the GC
  takes it.
- a **unit price** is not an amount at all. It has **no `amount` column**, so
  there is nothing for a careless `reduce` to pick up.

**An alternate's amount is signed — one column, not an amount plus a direction
flag.** Two columns can disagree, and a deduct stored as a positive with its
flag lost is a bid wrong by twice the alternate. The direction is then printed
in *words* beside the figure, because a minus sign in a table is the easiest
thing on a bid document to miss.

**`accepted` has three states.** "They have not said" is a different fact from
"they declined", and collapsing the two would make an award total look settled
while the negotiation is live. The screen calls the total provisional while any
alternate is unanswered.

Two mutation tests, both caught: add the allowance into the award (2 red), and
treat an unanswered alternate as accepted (3 red).

Migration is additive — one enum, one table, no change to any existing column.
`BidLine` CASCADEs from `BidInvitation` for `JobMediaAnnotation`'s reason: an
alternate is not a record that would be silently lost with its parent, it is
*part of* the bid, and deleting a bid must not be blocked because somebody
listed an alternate on it. It carries no `jobId`, so it needs no cleanup-script
registration.

One thing worth flagging for whoever touches `/bids` next: that page's test
mocks `@prova/db` with `Prisma: {}`, which stopped being enough the moment the
page's import graph reached the actions barrel — `lib/change-order.ts` builds a
`new Prisma.Decimal(0)` at module scope, so the stub throws on *import* rather
than in a test. The mock now carries a constructor.
