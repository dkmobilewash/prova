### What actually changed, in plain English (Diego)
`diego/junk-three`

**A text item knows which way it runs, and every rule that asks where a
word is uses its middle.** `pageText` now carries each item's run angle, and
`textItemCentre` puts a vertical dimension string's middle on the string
instead of two feet off its start; the table-rows rule, the site-equipment
word rule and the junk census read positions through it. No junk moved and
no real wall moved on the training sweep — the figures those rules were
missing sit three to six feet from the candidate, not 1.5 — so this is a
correctness change with no gain claimed. Three candidates from the
unknown-junk report were priced on it and none ships: the wider
site-equipment vocabulary set aside 149 ft of real wall for 0 ft of junk and
is reverted with its price in the comment; the band-contains-two rule
catches nothing the dedup has not already removed. Details in `NOTES.md`.
