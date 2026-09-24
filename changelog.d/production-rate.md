### A labor production rate, and the actual-vs-estimate back-check (Diego)
`diego/production-rate`

The only way to estimate labor was to type total hours by hand. A contractor
thinks in productivity — "my crew hangs 62.5 SF/hr" — and the competitive audit
named an editable production rate as the single line between a takeoff tool and
an estimating tool, because it is what lets a sub back-check a bid against what
the crew actually produced.

`JobLineItem.productionRate` (units per hour) is that number. Estimated hours are
now quantity ÷ rate, with `laborHours` left as a manual override. And
`lib/labor-productivity.ts` turns the hours logged against a line back into the
achieved rate and compares it to the estimate, flagging a miss past 15% once 8+
actual hours exist — the same "learn from actuals" shape as the catalog's cost
loop, but for productivity. Nothing derived is stored: the rate is an input, the
hours and the variance are computed at read time.

The check: `lib/labor-productivity.test.ts` pins hours-from-rate, the override
precedence, the achieved rate and the variance threshold. The migration is
additive (`productionRate DECIMAL(10,4)` — not the `(8,2)` that already cannot
hold a per-unit rate on the catalog).

Related, left for a follow-up: `LineItemCatalogEntry.defaultLaborHours` has the
same per-unit-vs-total ambiguity one level up. The catalog import drops a price
list's per-unit "Hours" column (0.012 hrs/SF) because the field can't hold it and
the code treats it as flat. This PR adds the line-level rate only; that decision
still needs its own migration.
