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
