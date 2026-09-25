### Bid-form compliance: the paperwork that decides whether anybody reads the number (Diego)
`diego/bid-compliance`

Every estimating feature in this app makes the **number** better — `JobBidRecap`
marks it up, `BidLine` splits it into the parts a GC's form asks for, `BidQuote`
levels what your own subs quoted, `bid-outcome` compares it to what the work
cost. None of them stops the bid being thrown in the bin before the number is
read.

An Invitation to Bid carries requirements, and a bid that misses one is
**non-responsive**: rejected unread, however good the price. That is a worse
outcome than losing, because losing at least tells you your price was high.

**Addenda were modelled nowhere.** Grepped rather than assumed — the only
`addend` hits in the whole app were a filename regex in `lib/intake/classify.ts`
and two documentation references. A GC issues Addendum 1, 2, 3 during the bid
period; each must be acknowledged on the form, and an unacknowledged one is the
most common reason a complying low bid is rejected.

**`reference` is entered text and deliberately NOT a counter.** Every `*Counter`
model in this schema exists because *we* issue a sequence and a reissued number
on our own document is a real defect. An addendum number comes off somebody
else's letterhead — it can be "3", "3R", "Addendum Three", or skip from 2 to 4
because the GC withdrew one. Validating it would be inventing a rule the issuer
does not follow.

**`acknowledgedOn` is a date, not a boolean**, so *when* you acknowledged is
recorded too. On a bid that gets protested, that is the fact in dispute.

**The design point worth reading: which checks are derived and which are
recorded.**

*Derived on every read, with no column to tick:* an ALTERNATE with no amount, a
UNIT_PRICE with no rate, an addendum with no acknowledgement. A stored
"satisfied" flag for these would let somebody tick *all alternates priced*, add
an unpriced alternate, and keep the tick — the exact stored-flag-disagreeing-
with-its-source defect this codebase bans, reintroduced in the worst possible
place. `BidRequirementKind` therefore has **no member** for any of them.

*Recorded, because nothing in the data could know:* whether the bond was
obtained, the form signed, the certificate attached. A person attests those with
a date.

**And nothing here ever says "ready".** The best sentence available is *"Nothing
outstanding that this app can see. It has not read the ITB itself, only what was
typed in from it — check the form before you send."* That hedge is load-bearing:
on a document submitted once, a green tick earned by accident is worse than no
tick at all. It is the same posture `bid-outcome.ts` takes toward an unfinished
job and `bid-levelling.ts` toward a lowest it cannot vouch for.

An addendum flagged as changing priced scope **warns separately** from the
paperwork list — that is a number which may now be wrong, not a form that is not
filled in, and acknowledging an addendum says you received it, not that you
re-priced what it changed.

Three mutations, all caught: treat a falsy amount as missing (a deduct and a
zero alternate both read as unpriced — 1 red); check a unit price's `amount`
instead of its rate (every unit price is blank by design, so this fires forever
— 1 red); and let the all-clear sentence say "ready to submit" (1 red).

**Deliberately not built:** uploading the addendum PDF (the document machinery
exists, but a file adds a blob-store decision worth taking separately), and
re-quantifying from an addendum — that is the drawing-revision gap, and it needs
this to exist first.

Migration is additive: two tables, one enum, nothing dropped and no existing
column altered. Both CASCADE from `BidInvitation` and carry no `jobId`, so
neither needs cleanup-script registration — the same shape as `BidLine` and
`BidQuote`, and `scratch-cleanup-order.test.ts` confirms it rather than my
saying so.
