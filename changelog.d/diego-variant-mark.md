### A printed variant mark is kept: "C6 (C6* at tub/shower locations, see legend)"

Hutto tags some partitions **C6*** and prints "TYP AT TUB/SHOWER LOCATIONS" beside
them. Its legend adds "AT *C, PROVIDE ADDITIONAL FR GYP BOARD ON TUB/SHOWER SIDE".
Diego's rule: for scoring C6* is C6, but the product keeps the mark, so the
estimator can price the extra board.

- **Reading.** The symbol, bare-text and plan-text readers matched codes exactly,
  so a "C6*" square never read as a tag. Those walls took C6 by propagation.
  Now a code with a trailing `*` reads as its own tag, "C6*" (`splitVariant`).
  Designation matching already ignores punctuation, so the group types and prices
  as C6.
- **The words.** `variantNotes` reads the lines printed with each marked tag
  ("TYP" dropped). The walls stage saves them per sheet in `TakeoffPlanTextRead`
  as kind `variant-notes`; no migration.
- **Shown.** The queue's suggestion and the group's tag chip read "C6 (C6* at
  tub/shower locations, see legend)", and "C6 (C6*, see legend)" when no words
  are printed.

Checked on Hutto A101 to A103 (held-out, read only): each gives
`{"C6*": "at tub/shower locations"}`, and A102's C6* tags are square symbols
like its C6 tags. `variantMark.test.ts` covers the split, the note, the label,
a bare tag keeping its mark, and the suggestion.
