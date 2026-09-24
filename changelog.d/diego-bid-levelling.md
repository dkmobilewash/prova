### Levelling: the quotes you collected, laid side by side — with what each one leaves out (Diego)
`diego/bid-levelling`

A sub buying out framing, EIFS or hang-and-finish collects three quotes and has
to decide which one to carry in the bid. Until now there was nowhere to put
them. `VendorPriceQuote` will not do it and says so at length — *"A quote
belongs to a VENDOR and a DATE, never to a job or a `JobLineItem`."* That model
is **price history**: what a vendor charges for a catalogued item, generally, so
a catalog default can be checked against the market. Putting a bid on it would
give one table two jobs and make "the cheapest live quote" a question with two
answers.

`BidQuote` is the other thing: what somebody quoted **for this project's
scope**, once, with these drawings in front of them. It expires with the bid and
teaches nothing about the market.

**The point of levelling is not who is cheapest. It is whether they are bidding
the same thing.**

A sub who left the soffits out is cheaper and is not comparable. Reading the low
number off a column without reading the exclusions is how a contractor buys a
hole in their own scope and finds it on site — and an app printing *"Acme,
$82,000, lowest"* in bold, with the exclusions somewhere below the fold, would
be actively helping.

So `exclusions` is a first-class column rather than a line in `notes`, and
**nothing returns a "lowest" on its own**. `levelPackage` returns the cheapest
quote *and* whether the exclusions match, in one object, and the screen renders
the caution **above** the numbers. When they differ, the caution **names** what
the low quote leaves out and who covers it: *"Acme is lowest but excludes
Soffits and Firestopping — Beta does not. These are not the same bid."*
"Excludes 2 things" sends somebody to read three PDFs; naming them says what to
price.

**Three judgements worth seeing:**

- **Exclusions match case-insensitively and NOT fuzzily.** "no soffits" and
  "soffits excluded" mean the same to a person and stay *different* here,
  because a false match suppresses the one caution that matters. Reading as
  different is the safe direction to be wrong in.
- **A single quote reports `comparable: null`, not `true`.** It is comparable to
  nothing, and saying "comparable" of it would be saying nothing true.
- **Grouping is by package label exactly as typed**, so a typo shows as two
  headings rather than silently merging two scopes into one comparison — the
  visible failure rather than the quiet one. The form offers the labels already
  used on the bid, so the common case is picking.

**Deliberately not built:** scoring, weighting, or an "adjusted" price that adds
an estimate of the excluded work back onto the low bid. That number would be
this app's guess at somebody else's scope, printed beside three real quotes and
indistinguishable from them. The exclusions are shown; the judgement stays with
the estimator.

Two mutation tests, both caught: suppress the caution (3 red), and merge every
package into one comparison (1 red).

Migration is additive — one table, no existing column touched. `BidQuote`
CASCADEs from `BidInvitation` and carries no `jobId`, so no cleanup-script
registration. `vendorId` is optional and SET NULL: a quote from somebody not yet
in the vendor list is still a quote, and refusing it would make the comparison
partial, which is worse than none because nobody would know it was partial.

The date goes through `optionalDateFromString` rather than a fourth private copy
of a date reader — `materialOrders`, `closeout` and `backcharges` have each
grown their own.

**And one thing that was not the plan.** This branch was the third to
independently patch `/bids`' test mock, where `Prisma: {}` threw *on import*
because `lib/change-order.ts` built a `new Prisma.Decimal(0)` at module scope.
Three patches, all local and reasonable, none of whose authors looked at the
cause. The module-scope `new` is now a lazy `zero()`, all three workarounds
become unnecessary, and `moduleScopePrismaCensus.test.ts` keeps it deferred —
mutation-tested by restoring the original line and watching it name the file
and line.

The census is narrow on purpose: constructing inside a function is fine, since
the client exists by the time anything calls it. Only the module-scope `new` is
refused, because that is the one that runs on import — and it breaks the 53
test files that stub `Prisma` before a single test in them starts.

**Third commit: the outbound half — who you asked, not just who answered.**

A levelling table that only holds answers is a table that reads as finished
when it is not. Two comparable quotes look like a settled buyout, and they are
not settled while a third supplier has the drawings and has not replied. So a
`BidQuote` is now the whole exchange rather than just its end: it starts as a
REQUEST — `requestedOn`, `dueBy`, no amount — and becomes a quote when a price
arrives.

**One row and not two tables.** A separate "request" model would split one
conversation across two places and leave them to drift, and the question an
estimator actually asks on bid day — *am I still waiting on anybody?* — would be
a join instead of a filter.

**The nullable amount is this feature's own worst failure mode wearing a new
hat, and it is named in three places rather than fixed quietly.** `levelPackage`
sorts ascending and calls the first row cheapest. A null sorts to the FRONT of
that sort — so a supplier who never replied would have been printed as the low
bid, in bold, on the screen whose entire purpose is to stop a low number being
read as the best one. `levelPackage` now filters to priced quotes before it
sorts anything, every comparison takes an `AnsweredQuote` so an unanswered row
cannot reach one by accident, and what was asked and not answered is reported
separately under `outstanding` — visible on the screen, and not in the
arithmetic. Mutation-tested: put the null back into the sort and four tests go
red, including one named for exactly this.

**`dueBy` is what makes a request OVERDUE rather than merely outstanding**, and
that judgement uses the READER's calendar day via `viewerToday()`, not the
server's. `serverToday.ts`'s own comment is the reason — *"on anything where the
exact day decides an outcome, it is not good enough"* — and whether a quote is
late is exactly that. A request with no `dueBy` is outstanding forever and never
late, which is honest: nothing was promised, so nothing is overdue.

**A decline is a date and never a delete.** *"Gamma declined to bid this"* is the
answer to *"why did we only get two prices"*, and next time it says who not to
wait on — both lost if the row goes. Un-declining is the same action with no
date, because a sub who says no on Monday and prices it on Wednesday is not a
new request.

**The subtle one, and the reason `saveBidQuote` reads the form the way it
does.** The answer form carries no `requestedOn`/`dueBy` field at all, and
spreading those in as `null` regardless would erase the record of having asked
at the exact moment the answer arrives — the one edit where losing it is
invisible, because the row looks complete afterwards. `formData.has()`
distinguishes *the form left this blank* from *this form does not own this
field*, and an omitted key is left alone by Prisma.

A price and the day it was given now travel together, both or neither: an amount
with no date is a number nobody can age, a date with no amount reads as an answer
that never came, and neither is the legitimate third case.

**Deliberately not built: actually sending the request.** The app records that
you asked. The asking is still an email, a phone call or the GC's own portal —
and a "send" button that quietly did nothing of the sort would be worse than no
button.

The migration is additive (three nullable columns, two NOT NULLs relaxed) and is
a SECOND migration rather than an edit to `20260924200000_add_bid_quotes` two
commits earlier on this same branch. Editing an applied migration changes its
checksum and fails the next deploy against any database that already has it, and
nothing on this machine can reach a database to find out whether one does. Two
directories is the cost of not needing to know.
