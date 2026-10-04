### The two records that come back from the GC can now say where their paper lives (Cyrus)
`cyrus/seed-counters-zzbqtu`

`recordSubmittalResponse` stored the outcome the stamp said and the reviewer's
notes, and had nowhere to point at the stamp itself. `answerRfi` stored the
answer somebody typed, and had nowhere to point at the letter it was typed
from. Both are the document an argument is had over when a crew is told it
built the wrong thing, and both lived only in somebody's inbox.

**Four nullable columns, not an upload.** `SubmittalRevision.responseUrl` /
`responseFileName` and `Rfi.answerUrl` / `answerFileName`, migration
`20260930020000_add_correspondence_document_links` — additive, no backfill,
nothing reads them until somebody fills one in.

**A pasted LINK rather than a file, and that was a correction to my own first
design.** I had this as blob upload until I read what the app already does with
a document that arrives from outside: `DrawingRevision.fileUrl` is a pasted
link, and its own help text names where those documents actually live —
"Procore, Box, the GC's portal". The stamped submittal is already stored
somewhere the GC controls and the sub cannot delete, which is better provenance
than a copy in our blob store, and it needs no plumbing to get there.

**The scope narrowed twice, both times by reading rather than by arguing.**
This started as "the four evidence records with no paper". Punch list items
already hold photos. RFIs already carry a free-text drawing reference, which is
a different field answering a different question. What was left is the two
records whose document comes BACK from the GC, which is also the half that
matters in a dispute.

**Both actions use `optionalLinkOrThrow`**, which is correct here because both
are inside `runAction` — see the entry for the link-validator consolidation on
this same branch for why the pair exists at all. **The census shipped with that
change covered both new fields with no edit to it**, which is the outcome an
"is there a second one" guard is for: mutating the submittal action back to a
bare `text()` read makes `linkValidationCensus.test.ts` name the field.

**Exported rather than withheld.** `answerUrl` and `answerFileName` are in the
`rfis` export dataset's `columns`. `exportColumnCensus.test.ts` forces that
decision rather than letting the columns default into silence, and the decision
is: a note of where the customer's own evidence lives is not a credential —
opening it still needs the GC's own login — and a customer leaving with the
summary and no way to find the original has been given the weaker half. The
submittal columns needed no entry because they went on `SubmittalRevision`,
which is not an exported model.

**The test is a render test, and the third case is what keeps it honest.** A
column nothing renders is this repo's "written, documented, and never called"
shape wearing a migration, so `correspondenceDocumentLink.test.ts` reads the
assertions off the DOM and its anchor query THROWS when it finds nothing — a
test that silently matched no anchor would pass on a row that had stopped
rendering the link. Null must render NOTHING: recording an outcome with no
paper attached is the ordinary case, and a row that grew an empty "the stamped
submittal" link or a dangling separator would be this change making the common
path worse to serve the rare one. Mutation-tested three ways: the `RfiRow`
render removed (2 red), the `SubmittalRow` render removed (2 red), the
words-fallback label dropped (1 red).

Both view types took the new fields as REQUIRED rather than optional, so every
producer had to be visited and the compiler said which — `moneyRail.ts` passes
them through, `alerts-query.ts` selects and maps them, both page queries map
them, four fixtures updated. Optional would have let a producer silently hand
over a row with no link and no error.

One thing worth naming because it nearly went in wrong: my first pass at
threading `alerts-query.ts` was a regex, and it wrote `responseUrl: null` into
a Prisma `select` block — exactly the "structural regex inserted code into the
wrong block" trap. Fixed by hand to `responseUrl: true` plus the pass-through
in the map.
