### A second generator, for the document shape that had no corpus at all

`parseSubListing` has three early returns for documents that are FORMS rather than tables
— the Caltrans numbered-box shape, the labelled-column shape, and a generic refusal. They
are the only paths where `accountedFor` is deliberately not the sum of the four buckets:
one label line carries up to six subcontractors' data while one subcontractor is assembled
from five lines, so the partition's one-row-per-line premise does not hold and the reader
refuses to claim a completeness it cannot compute.

A review censused the 6,000 documents `parsePartition.test.ts` generates and found **zero**
that reach any of the three. So the file asserting the reader's central guarantee was blind
to them, and two of its seven properties would go red on correct code if its generator ever
produced one.

**That gap is where both of 5 October's worst defects lived.** The labelled reader is where
two rows share a line, and that is the shape in which a multi-bidder listing could be read
and never imported, and in which the per-lead claim dedupe had been deleted on the false
premise that two rows of one paste always have different line numbers. Neither was visible
to 483 unit tests or 61 db tests, because no corpus in the repo had the shape. Four hand-
written fixtures in `parseShapes.test.ts` were the whole of it.

So: 2,000 generated labelled-column forms — one to three slots, zero to four bidder columns
at fixed offsets, ragged slots, blank-ish cells in every column, four head-line spellings,
optional city row, optional totals line. Measured reach: **1,095 read as forms, 809 with two
or more rows on ONE line, up to four on one line, 5,820 rows**.

Four properties, chosen as what the importer rests on rather than as the partition the
readers legitimately do not provide: it never throws; every row has a trimmed name and a
`line` that is a real non-blank line of the document; the counts agree with the arrays they
count; **`rowKeysFor` gives every row a distinct key even where several share a line**; and
the reconciliation has the documented form-reader shape, which pins in a test the sentence
`parsePartition.test.ts` could only state in prose.

### The circularity it shipped with first, and the fix

Its detector for "a form reader ran" was `accountedFor === ignoredLines` — which is also one
of the properties asserted. Mutating the reader's `accountedFor` therefore made the detector
return false for all 2,000 documents: the control went red saying the corpus reached no
forms, and the reconciliation case passed over an **empty set**. The mutation disabled the
property instead of failing it.

The scope is the GENERATOR's own facts now — at least one bidder column and at least two
slots — and the second half is worth writing down: `buildingConnectedListing` needs two
"Name of Business" lines and two "License No." lines before it will dispatch, so a one-slot
form goes down the ordinary table path. The first version of the fix scoped on columns alone
and red the reconciliation case for the right reason about the wrong set.

### Mutations

Six of eight killed, each naming the case: no bidder columns, exactly one bidder column,
`rowKeysFor` losing the ordinal, `accountedFor` as the bucket sum, `agreed: true`, an
untrimmed name, and every row stamped line 1. The one that **survives** is
`registrationOnly` returning a raw cell — it reds 51 other tests and leaves this file green,
because both identifier readers return `null` or a regex-matched digit string. That property
is therefore recorded in the file as insurance rather than as a live guard, which is the
same honesty the blank-name case in `parsePartition.test.ts` now carries.

487 unit tests, from 483.
