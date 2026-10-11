### The symbol-count eval reproduces exactly, so nobody pays for it a third time (Diego)

`diego/symbol-eval-repro`

**DOCS-ONLY — an audit, under the exception CLAUDE.md's working agreement grants
for one.** It records what a run established so the next person does not re-run
the same checks.

The symbol-count eval was run again on 2026-10-10, eight days after the
measurement `docs/ai/DECISIONS.md` already carries. Sixteen cases, Opus,
103 seconds, roughly a dollar.

**Every number reproduced cell for cell** — 4/4 and 4/4 on the clean control,
0/4 with three honest declines on cluttered ARCH_D, 3/4 on cluttered DETAIL, and
the two OVERCLAIMED both `doors-11` (said 8 against a truth of 11; said 10
against 11). `verdicts: requested 16, returned 16`.

#### Why that is worth a commit when the result is not new

The result was already there and already argued. What the re-run adds is that a
**stochastic** instrument returned an identical verdict table a week apart — so
the existing refusal to build symbol counting does not rest on one sample of a
sampling model. The two door failures are a property of thin strokes under
hatching, not of a lucky seed.

The model's uncertainty prose differed in wording and named the same cause both
times: hatch bands concealing swings it could not verify. That is the finding
the section calls more important than the counts — *a model that knows, says so,
and fills in `count` anyway.*

#### And the correction this carries

**I listed "run the symbol-count eval" as an open item blocked on an API key.
It was not open.** It had been run and answered on 2026-10-02, in the file that
defines the question, with a conclusion that refuses to build Phase 1 as
designed. The key bought a confirmation, not an answer.

Recorded because the shape is this repo's most expensive recurring one in
miniature: a question that reads as open because the person reading the backlog
has not read the file where it was closed. The entry now says, in its own
heading, not to run it a third time — and says what the next run worth paying
for actually is.

#### And the stale claim it turned up

`FEATURE-AUDIT.md`'s CV-takeoff row said the symbol-counting question was *"an
open question with zero code behind it."* **Struck** — it has been asked and
answered twice, and the row now carries the answer: correct on clean sheets,
OVERCLAIMS on cluttered ones, and no confidence band is safe to ship.

The row stays **Missing**, for a stronger reason than deferral: it was measured
and refused. That distinction is the whole point of correcting it — "untried"
invites somebody to try it, and this one has a bill attached.

The row also now says plainly that **wall detection from the PDF's own line work
is a different thing and has SHIPPED** (`wallsFromBothEngines`, the "Find the
walls" button). I conflated the two myself today — told Diego that detection was
unwired, from a planning note that predates the work, while the button has been
on the toolbar the whole time. Reading a document instead of the code, which is
the mistake this file exists to prevent.

No code change. No schema change.
