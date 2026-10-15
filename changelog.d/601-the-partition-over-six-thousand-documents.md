### The reader's central guarantee, checked over 6,000 generated documents (Cyrus)
`cyrus/sales-signals`

`parse.ts` classifies every non-blank line into exactly one of four buckets — a row, a header
line, named page furniture, or unread — and `accountedFor` must equal `nonBlankLines`. Its own
header calls this the guarantee that **nothing VANISHES**, and the file records it being FALSE
twice: once when a row carrying no numeric token dropped out with `agreed: true`, and once when
`TOTAL_LINE` matched against a whole line and took a real California contractor with it.

It was asserted across `SUB_LISTING_CASES` — **18 documents, 26 rows.** That is the right corpus
for asking whether a line lands in the *right* bucket, because each fixture is a document
somebody looked at. It is a thin corpus for asking whether a line lands in **any** bucket, which
is a property of arbitrary text rather than of a document.

So the invariant is now generated against instead: header lines in and out of place, rows with
cells missing, five delimiter styles, blank lines, page furniture, money and percentage lines,
names that normalise to nothing, licences of every shape this repo has seen refused. Seven
properties per document — no throw, the four buckets summing to `accountedFor`, `accountedFor`
equalling `nonBlankLines`, each count agreeing with its own array's length, `nonBlankLines`
matching the real count of non-blank lines, `agreed` matching its definition, and no row whose
company name is blank.

**6,000 documents, zero failures.** Verified at 20,000 first; committed at 6,000 because each
case walks the whole corpus and 20,000 cost 6.9 s of every CI run for input space nobody was
going to read. 6,000 is still ~330× the fixture corpus and runs in 2.6 s. Deterministic from one
seed, so a failure is reproducible rather than a story about a run nobody can repeat.

**THE CONTROL IS THE DIFFERENCE BETWEEN THIS AND A FUZZ RUN ABOUT NOTHING, and it is the
lesson this branch has paid for repeatedly.** The partition is trivially true of a document with
no lines, so a generator emitting empty strings would satisfy every property above. One case
therefore asserts the corpus actually reaches all four buckets, produces documents the reader
objects to, and is **not uniformly clean** — if every generated document `agreed`, the unread and
problem paths went unwalked. Proved by mutation: making the generator emit `""` reds exactly that
control while the other two cases pass, vacuously, as predicted.

**What it does not claim**, which is exactly what the module header says the partition does not
prove: nothing about whether a line is in the bucket it BELONGS in. A confident wrong bucket
loses a subcontractor as thoroughly as no bucket at all, and that half is `hasDataEvidence` plus
the converse cases in `parse.test.ts`. This is the other half, and only the other half.

479 unit tests, from 476.
