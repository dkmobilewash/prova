### The first real upload, and the three things it found (Cyrus)
`cyrus/integration`

Diego connected a `prova-dev` Blob store, the token went in, and `/intake`
was clicked end to end for the first time. Three files in. Every one of these
was invisible to 2,949 tests, a dry run over 85 filenames, and reading the
code.

**1. The classifier was being fed a mangled filename, and losing accuracy
for it.** `recordIntakeDocument` ran the stored name through
`intakeFileName` — which is the STORE PATH sanitiser, replacing every run of
non-`[A-Za-z0-9._-]` with a hyphen. Two costs, and the second is the one
that matters:

  - the table showed `Nevada-contractor-s-license-C-4.pdf` rather than what
    the person's file is called — which the schema had already said it must
    not, in as many words: *"before the store's random suffix and BEFORE the
    sanitising … it is what somebody recognises the row by"*;
  - **the same string went to the classifier**, whose patterns are written
    against real filenames. `contractors?(?:'s)?\s+licen[sc]e` needs an
    apostrophe and a space, and the sanitiser had just removed both. That
    file reads `COMPLIANCE_DOC / HIGH` on its real name and came back
    `MEDIUM — "contains 'license', not conclusive"` through the upload path.

`displayFileName` keeps the characters and does only what a label needs:
leaf of a dropped folder's path, no control characters, collapsed
whitespace, bounded length. `intakeFileName` still guards the store path,
where it belongs. A test asserts the two still DISAGREE on that filename, so
nobody can quietly merge them again.

**2. A filename hint never matched a job, in three separate places.** Job
names are long ("Riverside Medical Office Building [demo]"); the hint a
classifier reads out of `Riverside COI 2027.pdf` is "Riverside". All three
call sites compared them with equality, so a hint matched nothing, ever:

  - `jobFromHint` in the action left `jobId` null on every row;
  - the table then printed *"Looks like Riverside, which is not a job here"*
    **directly above a dropdown containing Riverside Medical Office
    Building** — the version a person sees and disbelieves;
  - `intakeTraySummary` said the same thing in an alert.

One rule now — `jobNameMatchesHint`, prefix at a word boundary, in
`lib/intake/review.ts` — and all three read it. Not a substring ("Park"
would match "Cedar Park Elementary" and equally "Parkway Tower"), not a
fuzzy distance; "River" still does not match "Riverside".

`soleJobForHint` refuses an AMBIGUOUS hint rather than guessing: two jobs
both starting "Riverside" mean the filename does not say which, and
pre-filling one for somebody to rubber-stamp is worse than leaving it blank.

**3. And the jurisdiction fix held on the live path.**
`Nevada contractor's license C-4.pdf` produced no job hint at all, which is
the point of it — "Nevada" is a state, not a job.

Verified by result rather than by claim, on the running app:

| | before | after |
| --- | --- | --- |
| filename shown | `Nevada-contractor-s-license-C-4.pdf` | `Nevada contractor's license C-4.pdf` |
| that file's confidence | MEDIUM | **HIGH** |
| `Riverside COI 2027.pdf` | no job, "not a job here" | Riverside Medical Office Building |
| `Northgate pay app 2.pdf` | no job | Northgate Apartments Phase 2 |

**The dry run could not have caught the first one**, and that is worth
writing down: it fed the classifier raw filenames, which is not what the
upload path does. A fixture that skips a transformation the real path
applies is a fixture that tests a code path nobody runs.

typecheck 4/4, lint 4/4, test 173 files / 2956 tests.
