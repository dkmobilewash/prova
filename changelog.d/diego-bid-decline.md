### Why we are not bidding work, which nothing recorded (Diego)
`diego/bid-decline`

`BidInvitationStatus.DECLINED` has existed since the model was written and is a
bare status: **no reason, no date.** So the app could report eight declined bids
and never say why.

The answers are different businesses. Eight for **capacity** means hire, or
raise prices. Eight for **scope** means the GCs inviting you have the wrong idea
of what you do. Eight for **contract terms** means one GC's paper is costing you
the relationship. Same count, three decisions — and before this the count was
all there was.

`/bids` now carries a **Work turned down** panel: the reasons, ordered by how
often each happens, with one sentence naming the commonest.

#### Recording is asked for and never required

A reason could be mandatory on the decline form. It must not be, and the failure
mode is specific: **forced into a required dropdown to get past a screen, people
pick the first option.** The data then looks complete and is fiction, which is
worse than blank — a blank is visibly missing, a wrong reason gets counted and
acted on.

So `declineReason` is nullable, the select's first option is "Why? (optional)"
rather than a real reason, and `summariseDeclines` reports the unrecorded ones
**as their own number** — never folded into `OTHER`, because "nobody wrote it
down" and "the estimator chose Something else" are different facts. The panel
says so in as many words, and says the number is how much of the picture is
missing rather than a figure to drive to zero.

Same posture as `conceptual-estimate.ts` always returning its sample size and
`bid-outcome.ts` stating how many jobs it excluded.

#### Nothing here is a verdict

No target decline rate, no "you should bid more", no flag on a GC who gets
declined often. The house rule, stated by `bid-responsiveness.ts` of itself and
by `indirect-costs.ts`: this product names what is there and leaves the
conclusion to the person. A sub declining most invitations may be correctly
busy, and an app nagging about it would be wrong most of the time while sounding
authoritative. A test asserts the headline contains no `should|too many|
consider|recommend|target`.

#### Ordered by count, not by value

One large job turned down for bonding is an event. Five small ones turned down
for capacity is a business problem — and ordering by value prints the event
first. `estimatedValue` is carried by the module for a caller that has one, and
`/bids` passes null deliberately: `BidInvitation` has no such column, and
`bidAmount` is what *we* bid, which on a declined bid does not exist because
declining is the decision not to produce one.

#### Re-opening a bid clears the reason

A bid declined, reasoned, then re-opened because the GC extended the date must
not keep "declined for capacity on the 3rd" hanging off it — read later that is
the decision that *stands*, and it is the decision that was *reversed*.

**The schema deliberately has no check constraint tying these to the status.** It
would be correct and would also make that re-open either lose the reason or fail
to save. So the rule is code — and it is `declineFieldsFor` in
`lib/bid-decline.ts` rather than inline in the action, because a decision
written inline in an action is one no test can reach.

#### Checks

- **Eleven mutations, every one red** — and **two were GREEN first time**, both
  census weaknesses found by mutation rather than by thinking:
  - wrapping the `/bids` panel in `{false && …}` left the census green, because
    the field name survived inside the dead branch. It now asserts the **gate**,
    not a mention.
  - computing the decline fields inline while leaving `declineFieldsFor(…)`
    assigned to an unused variable also passed — a census cannot tell "calls it"
    from "mentions it", so it now asserts the **assignment whose value is used**,
    and that no second copy of the rule sits beside it.
  
  That is #693's lesson arriving one PR later in a different disguise.
- The other nine: unrecorded folded into OTHER; groups ordered by value; the
  headline dropping the unrecorded count; a NaN value poisoning the sum;
  `valuedCount` claiming every bid carried a value; a headline for no declines;
  a re-opened bid keeping its reason; an entered date overwritten with today;
  the form field name drifting from the action's.
- 23 unit tests; 1,010 across the decline, token and action suites.
- Preflight green. **One migration, additive** — a new enum and three nullable
  columns, no defaults, no backfill, no index.

#### Also established, and recorded so nobody re-runs it

**Non-uniform sheet scaling is not supported by the corpus, so the X/Y
calibration split is not worth building.** The workflow audit asked for "X and Y
axis separately for non-uniform PDF scans", and `TakeoffScaleCalibration` stores
one line and one distance — one factor for both axes. Changing that touches
every stored quantity in the product.

Measured across nine plan sets by voting the horizontal and vertical dimension
labels separately on each page. 158 pages had enough of both to compare:

| | |
| --- | --- |
| pages where the axes agree to 3 decimals | the ones with the **most** evidence — 125/126 dims, 56/39, 64/35, 61/31 |
| "disagreements" at ratios like 0.042, 18.9, 25.9 | **101 of 158** — a second SCALE on the page, not a stretch |

A detail drawn beside a plan gives horizontal dimensions from one and vertical
from the other. That is the multi-scale sheet `takeoff-zones.ts` already handles
with plural calibrations per page. Where the dimensional evidence is strongest
the axes are uniform exactly, so there is no stretch to correct.

#### Click-list

1. Open a GC on `/contacts`, find a bid invitation. The status row must now
   carry a **Why? (optional)** select beside the bid amount.
2. Set the status to **Declined**, pick **No capacity**, press Update.
3. Go to `/bids`. A **Work turned down** panel must appear, reading
   "1 bid declined, all for no capacity."
4. Set that bid back to **Invited** and press Update. The panel must disappear
   entirely — and if you decline it again, the reason must be blank, not
   remembered.
5. Decline a second bid and leave the reason blank. The panel must say
   "1 had no reason recorded" and list only the reasoned one.
