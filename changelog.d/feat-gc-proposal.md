### The proposal no longer hands the GC your unit prices, and it prints the bid form's alternates and unit prices (Cyrus)
`feat/gc-proposal`

`/jobs/[id]/proposal` printed every estimate line with its material and labour unit price
("W2 — 3-5/8" 25ga stud, 1,240 EA, $2.37"). No sub sends that to a GC, so the document read
as an internal estimate. It also never queried `BidLine`, so the alternates and unit prices
the GC's bid form asks for were not on the letter at all.

Three presentations now, chosen on the page (`?mode=`, nothing stored, so no migration):

- **Lump sum** — the default for a proposal. One price for the scope.
- **By scope** — a subtotal per wall type (a hand-kept line falls back to its trade scope,
  then to "Other work"), derived from the same lines.
- **Itemized** — the schedule of values as it was, with a warning above it (not printed).

Every mode's total is `bidTotalOf` — the figure the job header and the recap already read.
The only new arithmetic is splitting that one total into scopes, in whole cents, largest
remainder first (the rule `spreadToLines` uses), because lines carry sub-cent extensions and
per-scope rounding alone adds up to a different bid. The lump and scope rows have no
unit-price, quantity, cost or hours field at all, so a page cannot leak one by accident.

When the job is linked to its bid, **Alternates** (Add / Deduct, the sub's own figure) and
**Unit prices** ("$3.10 per SF of 5/8 board") print in their own sections. A blank prints as
"No bid", never $0 and never filled in, and a note above the page (not printed) says how many
are blank. Allowances stay off the page: they are inside the base bid already.

The bid package is the printed proposal attached as a PDF (`submitBidPackage` only attaches
bytes), so what the page shows in the chosen mode is what the GC receives.

Check: `lib/estimating/proposal-presentation.test.ts` — per-mode total equals `bidTotalOf`,
scope subtotals sum to the bid across 200 random line sets, and mutation-tested (drop the
cent reconciliation, leak a unit price into a scope row, default to itemized, nudge the
total: each goes red).
