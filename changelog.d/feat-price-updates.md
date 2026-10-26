### What actually changed, in plain English (Cyrus)
`feat/price-updates`

Your board supplier sends a new price sheet and three open bids are still on the old
numbers. That had no way through: re-importing a price list only ever ADDED items it
had not seen, a line you generated from a wall type kept its first price forever, and
the only way to ask for today's price was to delete the line — which then never came
back.

Three fixes, all behind a preview you confirm:

- **Re-import now reprices.** Importing a list where an item already exists (matched
  by description, ignoring case — the import has no SKU column) shows N to add, M price
  changes (old -> new, with the % move), K unchanged. A "Update the M prices" box is
  ticked by default; confirming changes the entry's price and cost and nothing else —
  unit, trade, hours stay as you set them. A row in a different unit (per LF against per
  SF) is skipped, and a blank price cell never erases a price you have. Still owner-only;
  the permission model has no narrower catalog capability, so nothing was widened.
- **"Update prices on this estimate"** on an estimate tab lists the lines whose price
  book item has a different price today (old -> new, the effect on that line, the total on
  the bid), each with a tick, and writes only the ticked ones. Lines you typed yourself
  have no price book item and are listed as "kept — you set this price". Once you have
  pressed "Apply to line prices" the unit prices carry your markup, so only the COST
  moves and the screen tells you to apply the recap again. Estimate-stage jobs only; a
  contracted job is refused, because its lines are the subcontract.
- **"Restore deleted lines"** in the wall schedule puts back wall lines you deleted, at
  today's price book prices, with the quantity the walls now say. A line whose wall
  type has left the schedule stays gone.

What it cannot know, said plainly: a line records which price book item it came from but
not the price it was given, and an edit leaves no mark. So a linked line you repriced by
hand on purpose looks the same as a stale one — the list shows every difference and you
untick yours. An exact answer needs a recorded "priced from" figure on the line.

The checks: `lib/actions/priceUpdates.dbtest.ts` runs all three against a real Postgres
(and was mutation-tested ten ways); `catalog-price-update.test.ts` and
`price-refresh.test.ts` pin the arithmetic.
