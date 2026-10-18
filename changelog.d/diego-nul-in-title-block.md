### Three sheets "could not be read", and the drawing was never the problem (Diego)

`diego/nul-in-title-block`

Three sheets of School-01's 60-sheet set failed every attempt, with the only
message anybody saw being:

> This page could not be read. Nothing about it was saved. Retry it, and tell C
> Stream if it keeps failing.

They were sheets 22, 30 and 52 — **all three of them the partition schedule**,
which is the one sheet the estimating side needs. Retrying cost three attempts
each and changed nothing.

#### The real error, from the runtime log

That sentence is what `runner.ts` writes when a stage THROWS, and it is
deliberately generic because a thrown error's own text can carry a connection
string. The actual one was logged beside it:

```
PostgresError { code: "22021",
  message: "invalid byte sequence for encoding \"UTF8\": 0x00" }
  at saveSheetText → prisma.planSheetText.upsert()
```

**A NUL byte in the title-block text.** Postgres `text` has no representation for
`\u0000` at any length — it is not a size limit and not an escaping problem.
Measured across the whole file: **3 pages of 60 carry one, and they are exactly
the three that failed.**

#### Every instrument said those pages were fine, because they are

This is the part worth keeping. The pages are not damaged and not unusual — they
are the *cheapest* pages in the set:

| | pages 22 / 30 / 52 | a page that worked |
| --- | --- | --- |
| text items | 47 | 43–841 |
| stroke segments | 76 | 622 |
| time to read both halves | **2–5 ms** | 11–199 ms |

`openPlanPdf`, `pageText`, `titleBlockText` and `pageStrokes` all succeed on
them. The **real inventory stage**, run against the **real file** with in-memory
ports, returns `ok` for every one. Only a real Postgres refuses. So the message
blamed the drawing for something the storage layer could not swallow, and it
hid the schedule sheet while doing it.

#### Fixed where the text is produced, not where it was thrown

`storableText` strips NUL in `openPlanPdf`'s extraction loop, so every reader of
a page's items is covered. The stack named `saveSheetText`, but `declaredText`
and `agreedText` on the scale reading reach a `text` column by other routes, and
so does the title-block prompt — fixing the one call site in the stack would
leave the siblings broken for the next such file.

Lone surrogates go too. Not what was measured; the same failure, since an
unpaired `\uD800`–`\uDFFF` has no UTF-8 encoding and raises the same error class
on the same write. PDFs produce them from damaged `ToUnicode` maps.

#### The test that could not be faked, and the one that was

`planSheetText.dbtest.ts` runs against a real Postgres, and its **first** case
does not test our code at all — it asserts that Postgres **refuses** the raw
value, reproducing `22021` exactly. Without it the second case is vacuous: a
write succeeding proves nothing if the unsanitised one would also have
succeeded, and "the database would have taken it anyway" is precisely the
assumption that let this ship.

**And one case here was vacuous and is written up rather than quietly fixed.**
It was an end-to-end test: build a fixture sheet whose text carries a NUL, read
it back, assert none comes out. It passed — and it passed with `storableText`
deleted from the extraction loop. **pdfjs itself drops the fixture's NUL**:
`planFixtures` uses a standard font, byte `0x00` maps to no glyph, and
`getTextContent` never emits it. The real sheets' NULs survive extraction, which
is the entire defect, so reproducing it needs a font whose `ToUnicode` CMap maps
a code to U+0000 — a fixture nobody has built. It is a wiring census now, saying
so in as many words. Caught by mutation, not by reading it.

#### Checks

Preflight green, 10,045 tests, no migration. **Five mutations, five red, zero
blind** — including the defect as shipped and the call site reverting to raw
text. The dbtest was run against a real Postgres via `scratch-postgres.mjs`.
