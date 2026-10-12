### Three bids due the same week, said before the week arrives (Diego)

`diego/bid-crowding`

Step 1 of an estimator's day is Go / No-Go, and one of the things it weighs is
*"bid deadline vs internal capacity"*.

The app already knows what to do once that has gone wrong. **`CAPACITY` is a
decline reason** (#695) and a regret letter can go out naming it (#696).
Nothing has ever said capacity was *about* to be a problem — so the way it gets
discovered is by missing a deadline.

That is the expensive order. **A bid nobody answers is worse for a GC
relationship than one declined three weeks out**, because the GC held a slot
open for a number that never came. `/pipeline` now says:

> 4 bids due between 2026-10-14 and 2026-10-19, none sent yet: … If one is
> going to be declined, the GC would rather hear it now.

#### It reports crowding. It does not judge capacity.

How many bids a desk can produce in a week depends on the size of them, who is
in, and how much of each is already done. This knows none of that and does not
pretend to: *"three bids due between the 12th and the 14th"* is a fact, and
whether that is too many is the estimator's call.

Every threshold that would be a judgement about somebody else's capacity is
absent on purpose. The only two numbers are the width of the window (seven
days — the unit a week is planned in) and the count worth mentioning at all
(three; two bids in a week is a week, and saying so would be the warning nobody
reads, which `/pipeline`'s overdue badge has just finished being).

It also does not say **which** to drop. That depends on the GC, the fee, the
backlog and who is free, none of which is in this file — and there is a test
holding it to that.

#### Only bids that can still be acted on

Future, and not sent yet. A bid already submitted takes no more of this week,
and one whose deadline has passed is `bid-standing.ts`'s business — telling
somebody four bids were crowded last Tuesday is a fact about a week they cannot
change.

#### Two mutations came back green, and they were different problems

- **The sort was untestable.** Every fixture happened to be written in date
  order, so deleting `.sort()` changed nothing — while the run detection walks
  forward and assumes ascending, and rows come out of a database in whatever
  order the query gives them. A shuffled case now covers it, in both
  directions.
- **A guard could not change an answer.** `Number.isFinite(Date.parse(…))`
  looked like it dropped unparseable dates. It does not need to: `daysBetween`
  returns NaN and `NaN >= 0` is false, so the next filter already drops them.
  **Deleted** — the same shape removed from `sheetLevel.ts` in #705, found the
  same way.

#### Checks

- `bid-crowding.test.ts` — 19 cases. **Nine mutations, all red**, including the
  window chaining off its neighbour (which turns a crowd into a calendar: a bid
  every six days would join one unbroken run stretching over months).
- `bidStandingCallSite.test.ts` grows two assertions and **three more
  mutations, all red**: the crowding lines computed and thrown away, never
  computed, and the whole list gated off.
- That census **caught its own update**, which is worth recording as the thing
  working rather than as friction. #710 pinned the gate as
  `{lines.length > 0 && (`; adding a second source changed it, the assertion
  failed, and the edit had to be deliberate. A gate that grows an input should
  not grow it silently.
- The lines share one list rather than getting a box of their own: they are all
  answers to "what wants doing", and two stacked boxes is two things to skip
  rather than one to read.
- No schema change. `BidInvitation.dueDate` and `status` were already there.
