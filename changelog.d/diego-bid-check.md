### A bid check on the Send step, so an automatic estimate is safe to send (Diego)
`diego/bid-check`

The automatic estimate (#1091), the price list (#1094) and labor (#1098) can carry a bid from
plans to a price without anyone looking at it, so the Send step now carries a **Bid check**
panel: seven checks, each OPEN or CLEAR in a word, saying what it found and linking to the fix.
The checks are walls with no height, lines with no price or cost, missing production rates,
the review queue, spec conflicts with the legend's wall types, quantities that look off for the
building, and renovation sheets whose existing walls were never compared with a demolition plan.

Sending stays allowed. The panel says "3 checks open", and so does the line beside Create signing
link. A sub can know something the checks can't.

Two rules hold in `lib/estimating/bidCheck.ts` and its test:
- **A check that cannot be made is open.** A takeoff with no floor area on the job says it has
  nothing to check the wall footage against. It does not pass.
- **"Looks off" is shown, not decided.** Wall LF per floor SF (usual 0.05–0.40) and board SF per
  SF of wall face (usual 0.9–4.5) print the ratio, both numbers behind it and the usual causes.
  These are rules of thumb for a person to read; they are never put on a bid.

Proved on Baker and E Street through the new-customer walk, which now reads the panel on the Send
step and, with `WALK_GROSS_SF`, follows the floor-area check's own link.
