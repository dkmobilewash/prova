### A supplier's price list prices the estimate, so nobody types material costs

**Import from the Price book.** Use **Import a supplier price list** (owner only). It takes a supplier's quote or price list as CSV, Excel, or a PDF with a real text layer. A scan says it is a scan.
- The item, size, unit and price columns are guessed from the header and can be changed. A unit price wins over an extended total.
- Every row is matched to a material by code and shows how its price was worked out ("$510.00 per MSF = $16.32 per 4x8 sheet").

**Conversions use only what the row states:**
- MSF or a sheet's size → per 4x8 sheet;
- a box's screw count → per thousand;
- a pail's weight → per lb (a gallon is not a weight, so compound by the gallon prices nothing);
- a roll's length → per roll;
- a piece's length → per LF (track);
- a bag's square feet → per SF.

**Uncertain rows wait for a one-click pick:**
- several rows offering one material (two screws);
- a stud priced by length (a stud must reach the ceiling);
- a material the drawing left vague (a stud with no gauge, insulation with no R-value).

**What import writes.**
- Every row is kept as a `VendorPriceQuote` in the supplier's own words and unit.
- Matched and picked materials become catalog prices in the estimate's unit.
- Then every unpriced generated line on the company's estimate-stage jobs is priced through that job's markup, so "Price these N materials" empties.
- A line that already has a price is never touched.

**Each price shows its source** (supplier, list and date) and is flagged once it is over 90 days old. The source is derived, and disappears the moment somebody types a different cost.

**Never invented.** An unmatched row is kept for reference and prices nothing.

**Two things a test caught before they shipped:**
- **A PDF has no empty cells.** A quote row with no size shifted every column after it, so compound priced at $4.16/lb from its extended total. Cells are now placed under the header column they sit beneath.
- **An entry for a picked vague material can't carry the row's words.** It would read as the same material as the gauged entry, and two entries for one material price neither.

**Tape is now counted in rolls** (company roll length, default 500 ft). The price column holds cents, and tape is about a cent and a half a foot.

**Proved on Baker:** 11 unpriced materials became 0 after importing an invented supplier's quote with five picks (`priceList.dbtest.ts`, and the `price-list-import` walk).
