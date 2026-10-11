### A counting divergence nobody could reach, eliminated rather than guarded

`identify` keeps `row.registration` verbatim while `listingProvenance` stores
`blank(row.registration)`. For a whitespace-only cell those disagree, and the consequence
is not cosmetic: the in-pass check would see a contradiction where the stored-lead check
saw none, and one lead could be counted in both `leadsCreated` and `leadsAttached`. A
review raised it as a code-level possibility and could not establish whether the parser
ever emits such a value.

It cannot. Both readers return either `null` or a regex-matched digit string. Measured
first across 518 documents — all 18 shared fixtures plus every blank-ish cell this repo has
seen (`""`, a space, a non-breaking space, `-`, `--`, `N/A`, `n/a`, `none`, `TBD`) in both
identifier columns across five delimiter styles — and zero found.

**Then written as a test, and the test was deleted.** It survived both mutations aimed at
it: making `registrationOnly` return the raw cell reds 51 other tests and leaves this one
green, and stopping `fieldSpans` from trimming leaves it green too. The property is
structural, so the case could not fire — the third time on this branch that the rule "a
guard that cannot fire should go" has decided an edit, and the first time it has decided
one against a test I had just written.

The elimination is a note beside `blank()` instead, which is where somebody would wonder,
and it says what would make the divergence reachable again: a reader changed to pass a raw
cell through.
