### What is still unpriced, against the day the bid is due (Diego)

`diego/deadline-coverage`

Step 5 of an estimator's day: *"Quote Tracking: monitor open RFQs to ensure
quotes return prior to the bid deadline."*

`bid-levelling.ts` already knew a lot about a quote. `requestState` returns
`ANSWERED | DECLINED | OVERDUE | AWAITED`, and `levelPackage` deliberately keeps
unpriced requests out of the comparison rather than letting a null amount sort
to the front and win it.

**What none of it knew was when the bid is due.** `requestState` measures a
quote against its own `dueBy` — the date *we* asked the vendor for — and
`bid-levelling.ts` does not mention `BidInvitation.dueDate` anywhere; a grep for
it returns nothing.

So a quote could sit comfortably inside its own window while the bid was due
tomorrow, and nothing said a word. **The vendor is not late, and you are about
to be.**

The levelling screen now says: *"1 package has no price yet: Glazing. The bid is
due in 3 days. 2 requests are still out."*

#### A package with no answered quote is a hole in the number

Not a late task — a figure about to be guessed. Every other state is
recoverable: one quote in hand is a number you can bid, a decline tells you to
ask somebody else, a spread you dislike is still a spread. Nothing in hand means
the line comes off somebody's memory of the last job.

Three cases that each read as quiet otherwise, each with a test:

- **A package where everyone declined** counts as unpriced. It is the one most
  likely to be forgotten, because all its requests are closed.
- **An undated bid still warns.** `null` means UNKNOWN, never "plenty of time" —
  the bid nobody dated is the one most likely to be close. It says the date is
  missing instead of going silent.
- **Nothing outstanding on an unpriced package** says *"these packages need
  somebody asked"* rather than a reassuring count of pending requests.

#### A mutation that turned out to be equivalent, and what I did about it

Replacing the UTC date parse with a local-time one left all seventeen tests
passing. The first response was to force `TZ=America/New_York` in the
daylight-saving test — which also passed, so I measured instead of theorising
again: across both 2026 changeovers and a full year, **the two parses agree on
every case**, because `Math.round` absorbs any offset under twelve hours.

It is an equivalent mutation, not a blind spot. The forced timezone was removed
rather than left looking like it tested something, and the test now says so. The
UTC parse stays because it is exact rather than rescued by the rounding, and a
future `Math.floor` or an hours-level answer would make the difference real.

#### Checks

- `bid-deadline-coverage.test.ts` — 17 cases. **Eight mutations, seven red**:
  a declined-only package counting as priced, an undated bid going quiet, a
  past-due bid counting down from a negative, the never-asked case claiming
  requests are pending, the warning firing when everything is priced, package
  names counted rather than named, and every name printed however many. The
  eighth is the equivalent one above.
- `bidDeadlineCoverage.test.tsx` — a RENDER test per #665 plus a census of the
  call site: the component took four props for its whole life, and forgetting
  the fifth leaves the warning working but permanently unable to say how long is
  left, which is the half that makes somebody pick up the phone. **Six
  mutations, all red.**
- No schema change. `BidInvitation.dueDate` and `BidQuote.amount` were both
  already there; nothing had put them in the same sentence.
