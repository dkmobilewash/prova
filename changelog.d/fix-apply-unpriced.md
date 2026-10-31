### Apply to line prices no longer dead-ends a bid whose lines all lack a price (Cyrus)
`fix/apply-unpriced`

A new wall sub's estimate comes in cost-only: the price book gives each wall line a cost and
no sell price. Apply used to refuse with "give the lines a unit price first", so their first
bid had nowhere to go. The founder's decision (the estimating lead can reverse it on review):
**when no line carries a price, Apply offers to price the lines that have a cost.**

- The allocation is the one that already existed — `spreadToLines`, cost-proportional with
  largest-remainder cents — reached through a new `applyPlan()` in `lib/bid-recap.ts` that the
  panel's preview and `applyBidRecap` both call. There is no second computation of the figure.
- Two steps. The first press writes nothing and prints "This sets a price on N lines that have
  none, totalling $X. Lines you've priced by hand: none." with Cancel (first slot) and Confirm.
  The server enforces it too: `applyBidRecap(jobId, { priceUnpriced: true })` is required, and is
  refused if a line has been priced since the preview.
- Some lines priced, some cost-only: unchanged (spread across the priced lines), plus one line
  saying the cost-only lines are left alone.
- A line with no cost (or no quantity) cannot take a share: it stays unpriced and is named.
- The total shown is what the two-decimal unit prices really sum to, as before, so it can sit a
  few dollars from the bid on large quantities.

Unchanged and worth knowing: Apply is still disabled when the rates add nothing (the existing
"line prices are already the bid" gate), so a zero-markup, all-cost-only estimate is not priced.

Check: a job with only cost-only lines and rates saved — Apply shows the confirmation, Cancel
writes nothing, Confirm writes the prices and the job header BID equals the recap total.
