### Arrows on the photo, kept beside it rather than burned into it (Diego)
`claude/prova-company-cam-feature-6170v6`

A site photo shows a condition. It does not show WHICH crack, or which of
four risers, or that the gap is three feet rather than three inches. Marking
up a photo is how a sub makes a photograph argue a point, and it is the
fourth item on the company-cam list.

**The decision everything else follows from: the pixels are never modified.**
The obvious build flattens the drawing into a new JPEG. That is wrong here
for a reason this schema already has a rule about — a site photo is an
evidence record, and flattening either destroys the original or silently
forks it into two files that disagree about what the camera saw. Marks are
rows beside the file, so the photograph stays exactly what was captured and
the markup stays editable and dated.

**What that costs, stated rather than discovered later.** The raw blob URL
still serves an UNMARKED photo. Anyone who downloads the file instead of
reading the page gets the picture without the arrows. So nothing in the app
calls a marked-up photo's file "the photo": the portal says in as many words
that opening the image gives you the original without the markup. The real
fix is a flattened export, and that is the same piece of work as the PDF
report (roadmap item 6) which has to exist before a marked-up photo is ever
ATTACHED to anything. It is deliberately not faked in the meantime.

**MEASURE does not measure, and the enum comment is the only place that can
stop somebody assuming it does.** There is no scale reference in a jobsite
photograph and no perspective correction, so a pixel length is not a
distance and cannot be converted into one. What is stored is a line the
person drew and a string the person typed — their claim, on their own
authority, exactly like a figure written on a printout in marker. Computing
a number and showing it to a GC as though the software had measured it would
be inventing evidence.

**Coordinates are fractions of the image, never pixels.** A photo renders at
whatever width a card, a gallery, a portal or a phone in landscape gives it,
and a pixel coordinate only means something next to the size it was captured
at — which would mean storing that size too and trusting it forever. A
fraction survives all of it with no second column to disagree with.

**One overlay component for the sub's gallery and the GC's portal**, which
is the single place the portal's usual rule is inverted on purpose. That
type shares almost nothing with the internal card — separate query, three
exclusions the compiler enforces — but an arrow drawn to show a GC where the
damage is has to land in the same place on their screen as it did on the
screen where somebody decided to show it. Two implementations would be two
chances for it not to.

**A row per mark rather than one JSON blob**, so each mark carries its own
author and timestamp, so the set can be counted and capped as ordinary rows,
and so shape validity is enforced once on the way in rather than defended
against by every later reader. The save REPLACES the set rather than
diffing it, and the cost of that is written down where it happens: ids and
authorship are reissued on every save, which is a real loss of per-mark
attribution, taken because a diff loses correctness instead of metadata.

**CASCADE on `JobMedia`, deliberately.** The trap #227 and #228 both fell
into is a per-job RESTRICT child that blocks the job delete while the static
guard stays green. A CASCADE child of `JobMedia` is reached by the
`jobMedia.deleteMany` both cleanup scripts already run — and the database
was asked directly rather than the schema text read: a dbtest creates a
photo with a mark, deletes the photo, and confirms the delete is neither
blocked nor leaves the mark behind.

**Two tests caught the author rather than the code, and both are recorded
because the mistake is instructive.** The capability case first set
`role: "ACCOUNTING"`, which `can()` never reads — capabilities come from
`jobFunction` — and then set `role: "OWNER"` with an ACCOUNTING function,
which `capabilitiesFor` rule 1 gives everything to regardless. Two green
runs would have proved nothing. It is MEMBER + ACCOUNTING now, with the
reason in the test.

The portal exclusion test has now gone red on purpose twice in two features —
`kind` for video, `marks` here — exactly as its own comment promised it
would "on the day somebody widens the type or the select". Both times the
key list was widened by one field rather than relaxed. `marks` carries
geometry and words and nothing about who drew them, asserted separately.

Verified: typecheck, lint, 2038 unit tests, 330 dbtests against a real local
Postgres 16, full build. The migration was applied and drift-checked rather
than only diffed — 76 migrations from scratch, `migrate status` names it,
`migrate diff --from-schema-datasource --to-schema-datamodel` returns an
empty migration. `reachable.test.ts` was mutation-tested: removing the one
call site turns it red naming `saveJobMediaAnnotations`.
