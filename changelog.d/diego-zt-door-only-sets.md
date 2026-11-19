### A label whose wall review never ran is not a wall test, and the zero-touch eval now says so instead of charging it (Diego)
`diego/zt-door-only-sets`

The three fresh doors-exam sets (Huffman, Meadows, Levy) carry door keys and nothing else on walls — zero accepted, zero traced, every candidate left unreviewed. When their PDFs became visible to the zero-touch eval, their sheets entered WALL pricing against that empty "key", and everything the product posted counted as pure over: $556,750 of artifact that pushed the held-out headline from 59.5% to 89.5% (BASELINE-20261119.md reconciles it to the dollar). Diego's rule, 2026-11-19: a set with no reviewed walls is not a wall test.

`wallTestFromLabels` (in `heldOutScore.ts`, beside `keyFromLabels`) is the discriminator, and it is deliberately UNREVIEWED-based rather than empty-key-based: a sheet whose reviewer looked at everything and rejected it all has an honestly empty key — posting walls there IS junk and still scores. Only a label with no accepted or traced wall AND unreviewed candidates is excluded. The eval zeroes that sheet's wall and board terms, keeps its door and window terms, and prints one line naming the exclusion so a run's output says what it skipped.

Check: `heldOutScore.test.ts` pins four cases — the doors-exam shape excluded, the all-rejected sheet kept, accepted/traced kept, and a counts-less legacy file kept. The held-out rerun after this merges updates BASELINE-20261119.md's standing figure.
