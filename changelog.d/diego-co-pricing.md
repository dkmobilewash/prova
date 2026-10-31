### A change order is priced the way the bid was (Diego)
`diego/co-pricing`

Until now a change order's price was whatever somebody typed into "Unit
price". The bid had a recap — markup per cost type, overhead, profit, tax,
bond — and the extra work was quoted off a calculator. Diego's decision of
2026-10-30 (option A in `coordination/decisions/2026-10-30-change-order-
markup-and-burden.md`) is now code, in `lib/change-order-pricing.ts`:

- **Every costed line goes through `bidRecap` itself**, one line at a time,
  at the job's own recap rates (else the company defaults). Not a copy of
  the math: the same function, so a CO is priced exactly as the bid was,
  per-category markup included. The test proves per-line sells sum to the
  whole-CO recap within rounding.
- **Labor is burdened before anything is marked up**: an hour costs the
  craft's wage × pay type + fringes + the employer burden in force on the
  WORK DATE on the wage, from the same three helpers job costing books an
  hour with. **Never a defaulted wage**: a craft with no schedule on the
  work date lands with its hours, no cost, no price, and "UNPRICED: no
  wage on file" in its description.
- **`ChangeOrderProposal.costCategory`** (additive, nullable) carries the
  cost type; the add-scope form has a Cost type select, and leaving Unit
  price blank with a cost prices it from the recap — a typed price wins.
  Approval copies the category onto the new line item.
- **A T&M ticket's draft now carries priced lines**: one per labor row
  (priced where the craft has a wage, with the hourly basis spelled out in
  the description), one per material (unpriced — a MaterialOrder has no
  price, by design).
- **The GC's document shows the backup by default** — cost, each recap
  step with its rate, sell — under every priced line, both on the estimate
  tab's change-order card and in the DocuSign document; the send form has
  "Show the pricing backup" ticked, untick for sell only.
- **EQUIPMENT joins the QuickBooks purposes list**, because the cost
  categories now carry money; its hint says it is posted when the cost
  push is built, which is still not built.

Stated gap: per diem and travel pay on the day's time entries are not in
the frozen ticket, so a CO drafted from one does not recover them
(`jobCostCensus` has the reason). Extending the snapshot is the fix.

Checks: `change-order-pricing.test.ts` (every expectation computed by
`bidRecap` or the labor helpers, never typed), the T&M db test (a craft
with a wage prices to the recap's figure to the cent, a craft without one
stays unpriced, an added line with a blank price is priced from the
recap, a typed price wins, the approved line keeps its category), and the
document test (backup under the right line, none when sell-only).
