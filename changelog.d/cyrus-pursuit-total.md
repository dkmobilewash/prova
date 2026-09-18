### The chase list on /pipeline says what the open pursuits add up to (Cyrus)
`cyrus/pursuit-total`

#308's "Out chasing — not invited yet" list showed each pursuit's value and
no total, while the `bid_pursuits` Ask tool already reported one. So the
answer to "what have we got out chasing?" was only available by asking, and
the screen and the answer were one careless edit away from disagreeing.

The heading now carries one plain line — "3 open, 2 with a value, about
$350,000.50 — 1 has no value yet". A pursuit with no value is NAMED, never
added in as $0, so a total that is only a floor reads as one. Nothing open,
no line.

**One sum, not two.** `openPursuitValue` in `lib/bid-pursuits.ts` is now the
only place the open value is added up; `summarisePursuits` (what the Ask tool
reports) calls it, and so does the list. Open means what it already meant —
`isOpenPursuit`, so Invited and Dropped are out. Still summed in whole cents.
The Ask handler and its tests are unchanged and pass unchanged.

The check: `lib/bid-pursuits.test.ts` pins 250,000 + 100,000.50 = 350,000.50
with a blank one counted and Invited/Dropped excluded. Mutation-tested —
dropping the open filter turns 8 tests red, summing dollars as floats 3, and
converting to cents WITHOUT rounding each value 1 (0.29 + 0.57, which drifts
to 0.8599999999999999; the obvious 100.10 + 200.20 case does not catch that
one, which is why the extra case exists).
