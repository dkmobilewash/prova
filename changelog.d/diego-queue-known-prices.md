### A price the company already holds is filled, not asked in the review queue (Diego)
`diego/queue-known-prices`

On Totem Lake, the review queue asked four prices by hand (12 presses) that a company with a price book or
an imported supplier list already holds. Nothing linked them: the trade's starter parts write `3⅝″`, which
the material reader did not read, and "⅝″ Type X board" never says "gypsum". Now the material reader takes
the single-character fractions, a catalog entry in the part's own words and unit matches it, and when the
takeoff writes its lines it links each unlinked part to the company's entry and prices this job's new
unpriced lines from it, through the job's markup (a labor entry takes the labor markup). A price somebody
typed is never touched. The estimate names where each price came from: the supplier's list and date, or
"Your price book: …". Test: `lib/estimating/knownPrices.dbtest.ts`.
