### A T&M ticket carries per diem, travel and mileage to its change order (Diego)
`diego/tm-per-diem-lines`

The gap the change order pricing work stated: dollars on the day's time entries
were not on the ticket, so a change order could not recover them. The ticket now
freezes them, and the phone has four optional fields at signing: per diem, travel,
miles and rate per mile.

Each becomes its own line on the drafted change order, priced through the bid
recap: per diem and travel as other, mileage as equipment. No rate means an
unpriced line that says so, because the app never invents a rate.

A time entry can carry the same per diem somebody also types on the ticket, so
the typed amount is priced, and the line states what the entries show rather than
adding it. The GC is not billed twice. No schema change: the snapshot is already
a frozen JSON column. A rate finer than a cent stays exact on the ticket, and
each line is quantity one because the cost column holds cents.
