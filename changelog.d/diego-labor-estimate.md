### Labor on the estimate, from the company's own production rates

**Where the rates live.** Wall types → **Production rates** holds:
- framing (LF/hr);
- hanging board by type (regular, Type X, abuse/impact/moisture-resistant);
- taping and finishing by level (3, 4, 5);
- ceilings (SF/hr);
- hour multipliers for walls over 10 ft and over 14 ft;
- the crew's cost per hour.

**Every field starts blank, and blank stays blank.** A rate is a fact about one company's crews, so none is seeded, the same rule that keeps prices out of the catalog.

**The labor lines.** From confirmed walls (traced items and wall-schedule runs) and ceiling lines, the estimate writes one `HR` line per task per wall type per height band, e.g. "Labor — S6A — hang type X board, 2 layers, over 10 ft":
- hours = quantity ÷ rate × the band's multiplier;
- finish uses the wall's level (Level 5 where the spec put a skim on the compound);
- cost = hours × crew rate, priced through the labor markup.

**Rules shared with the material expanders:** a line is updated in place (only the hours move), a person's deletion is respected, and a line no longer needed is soft-deleted under a changed name so it isn't mistaken for a person's deletion.

**"Set your production rates"** shows on the estimate, beside the markup prompt, naming each rate the job's work needs and doesn't have. Saving the rates re-works labor on every open estimate.

**Baker by hand** (S6B 120 LF × 10 ft, C8B 80 × 12, S6A 60 × 14), at rates a test types in: 8 lines, 273.92 h, $16,983.04 at $62/hr, every line exact (`productionRates.test.ts`, `productionRates.dbtest.ts`, the `labor-estimate` walk).

**Caught on the way:** the labor module reads the job's markup through the transaction, not `pricingRatesFor`. It rides into the browser behind `takeoff-item-lines.ts`, and `client-prisma-boundary.test.ts` caught the Prisma client being pulled into two client routes.
