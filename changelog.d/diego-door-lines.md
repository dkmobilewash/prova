### Doors and frames: posted doors count on the bid, behind a trade setting (Diego)
`diego/door-lines`

Marked doors posted themselves as a count that reached no estimate line, so an auto-posted door changed
no bid. A trade setting, **Doors and frames** (`Company.doorScope`, on Settings and at the trade pick, by
others for every preset), now decides. By others writes no line. **Frames** adds each door's frame install
and **doors and frames** adds hanging the door too: EA labor lines at two new production rates (frames
and doors per hour) and the crew rate, through the labor markup, each saying which rate it came from. For
a framing trade it also adds the opening's king and jack studs and header from the company's own partition
parts, priced from the price book and supplier list those parts are linked to. Changing the answer re-syncs
open estimates; posted doors re-sync with any partial sync, because their framing depends on the job's
wall types. Baker, no AI: $30,752.68 → $33,560.68 with doors and frames on (18 doors, 4 lines, $2,808.00).
Migration `20261112190000_company_door_scope` (additive). Tests: `lib/estimating/doorLines.dbtest.ts`,
`lib/estimating/doorLines.test.ts`, `lib/estimating/productionRates.test.ts`.
