### "Order materials": a contracted estimate's material lines as a draft PO, in whole packs (Diego)
`diego/order-materials`

On a contracted job's Estimate tab, pick a supplier whose price list was imported (#1094) and press
**Order materials**: every material line that supplier prices becomes a line on a DRAFT purchase
order, in the supplier's words, at the supplier's price, in WHOLE PACKS rounded up. On Baker:
353 lb of compound is 6 pails of 61.7 lb, 1,008 sf of R-19 is 14 bags, 252 lf of track is 26 ten-foot
pieces, and 83 of the estimate's 4x8 Type X sheets are 56 of the list's 4x12s at $24.48 each
($510/MSF). One draft per phase code the lines carry (and one for the lines with none). A line the
list does not price, or prices without saying what is in the pack, is named with why and left for
Buyout. The existing PO flow from there: the drafts are checked, issued and sent on Buyout.

**No pack-size column.** The pack is read from the row's own words the same way the import read
them to price the estimate (`convert`): a row per box, pail, bag, roll or piece holds its price over
its price per estimate unit. **Contracted jobs only**, like every buyout. **A second press** while a
draft from that supplier is open is refused, so nothing is ordered twice.

Also: the seven local walks that pick a trade now press "Not now" on the sample offer (#1120), which
had stopped every one of them at the markup step.

Checks: `lib/estimating/materialOrder.test.ts` (each pack from the fixture's own rows, board by the
sheet, refusals with the reason, rounding up, one order per phase), `lib/actions/orderMaterials.dbtest.ts`
(Baker's lines through the real import: estimate refused, the exact packs, second press refused,
phases numbered on, another company's supplier refused; red with rounding to nearest),
`e2e/specs/order-materials.spec.ts` (CI), and the Baker walk (`price-list-import.local.spec.ts` step 6).
