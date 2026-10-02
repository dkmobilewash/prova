### The symbol-counting question is measured: yes on Opus, dangerously no on Haiku (Diego)
`diego/ai-cost-click-findings`

`docs/ai/DECISIONS.md` carried *"whether symbol-counting can reach a precision an
estimator would accept"* as an open question with **zero code behind it**, and it
gates the whole takeoff-from-drawings project. It is measured now.

`lib/takeoff/symbolCount.eval.ts` — eight cases, synthetic sheets, two runs:

| model | correct | OVERCLAIMED | declined |
| --- | --- | --- | --- |
| **claude-opus-5** | **8 / 8** | **0** | 0 |
| claude-haiku-4-5 | 4 / 8 | **4** | **0** |

**THE EXPECTED ANSWER WAS "IT NEEDS TILING", AND IT IS REFUTED.** The eval has two
arms because `plan-ingest/planPdf.ts` had already measured the constraint that
made tiling look inevitable: an ARCH D sheet is 36 inches wide, so it fits a
vision tier at ~44 DPI, which is why title blocks are read as vector text and
never looked at. The prediction was that symbols would count on a letter-size
sheet (~143 DPI) and not on a full one, making drawing takeoff a rasterisation
project before it could be a feature.

Opus counted a full ARCH D sheet at 44 DPI, four cases out of four, with
confidence tracking the real difficulty — MEDIUM on every ARCH D case, HIGH only
on the two easy high-resolution ones. **So the blocker is not resolution, and
nobody has to build a tiler to find that out.** That is the expensive project the
paired arms existed to avoid starting on a guess.

**WHAT HAIKU DID IS THE MORE IMPORTANT HALF, because it is the failure a feature
would have shipped.** Not 4 wrong out of 8 — 4 wrong at **HIGH** confidence, with
**zero declines in sixteen opportunities**, and specific fabricated reassurance:

    doors-11@DETAIL   said 14, truth 11, HIGH
      "All 14 are plainly resolved at this resolution with distinct
       quarter-circle swing arcs. I examined the entire sheet and counted each one."

The prompt invites a decline in its first rule, in capitals, and promises no
penalty for it. Haiku never took it once. And DETAIL was **worse** than ARCH_D for
doors — more pixels made it further wrong — so this is not a seeing problem, it is
a not-knowing-it-cannot-count problem, which no resolution fixes. Exactly the
metric this repo says to care about: *"a count that is 85% accurate and reads as
certain is a wrong bid."*

**A FEATURE MUST NOT INHERIT `PLAN_INGESTION`'s MODEL.** That is Haiku for a
VOLUME reason — hundreds of sheets per set — and counting symbols on one sheet an
estimator chose is not that. The eval asked Haiku first only because plan
ingestion was the nearest feature to borrow a model from; that was the wrong
stand-in, and it now defaults to Opus with `ANTHROPIC_MODEL_SYMBOL_COUNT` to
re-measure any model.

**THE FIXTURES ARE WRITTEN BYTE BY BYTE, and the fixture is proved before
anything is measured against it.** Synthetic because *"never use real customer
files in tests or fixtures"* and a GC's drawing set is precisely that. Hand-rolled
PDF rather than a new dependency, so there is no licence to review and the bytes
an eval is graded against are auditable in the same file. `syntheticSheet.test.ts`
opens every sheet with the `pdfjs-dist` the app already ships and asserts the page
count, the media box, that the operator count GROWS with the symbol count (an
empty valid PDF would pass everything else), that the title-block text extracts,
and that two runs are byte-identical. This repo's harness rule: *a control that
fails is the instruction to fix the harness, not a result to read.*

**`countSymbols` IS AN INSTRUMENT, NOT A FEATURE** — no action calls it, it is not
in `AI_FEATURES`, it is not metered, and `FEATURE-AUDIT.md` keeps drawing takeoff
as Missing. `aiFeatureGateCensus.test.ts` caught it on the first run, correctly,
as the "written, documented, and never called" shape. Rather than skip it, the
census grew a second and differently-shaped exemption that **pins** the state: an
instrument must be imported by at least one `*.eval.ts` and by **no other file**.
The first half means it is not dead; the second means it has not become a path a
customer reaches. Mutation-proven both ways — remove the eval's import and it
reds as dead code; add a non-eval importer and it reds naming the file, with the
original ungated-caller assertion firing too.

**BOUNDED, and the bound is wide.** Clean synthetic geometry, one symbol kind per
sheet, no hatching, no dimension strings, no overlapping notes, no scanner noise.
A pass is a **FLOOR**: Opus can count marks it can see and knows roughly how sure
it is. It does not mean Opus can take off a real drawing set, and the measurement
that would justify building anything needs sheets with competing geometry.

**And the eval guard had the scope bug its own comment warns about.**
`harness.test.ts` says, in these words, *"this walks the directory rather than a
list — nothing is ever missing from a directory you do not walk"* — and
`DIR = join(import.meta.dirname, ".")` walked only `lib/ask/eval/`, which holds
**two** of the repo's nine eval files. The other seven live beside the features
they measure and were outside the walk entirely. `theme-contrast.test.ts` and
`packages/ui/Button.tsx` again: right pattern, wrong scope, and no size assertion
can see it because a file outside the walk is not a small set — it is not in the
set at all. Citing the rule it was breaking is what stopped anyone looking.

Rescoping it to all of `lib/` found one live violation: **`addenda.eval.ts`
demanded its API key INSIDE the `it` body**, the one placement that file's own
comment describes as the thing to refuse — so a keyless run started the suite and
threw once per case, reading as a measurement that went badly rather than one
that never happened. Moved to collection scope. The guard's floor went from 2 to
8 (a floor the old scope could not reach, so the fix cannot be undone quietly)
and it now asserts the walk leaves that folder.

Five of the six "violations" the rescoped guard first reported were false alarms
from my own over-strict regex — it demanded column-zero placement and one exact
function name, while six evals legitimately call the **better** shared helper
(`requireEvalApiKey`, which also rejects the "…" placeholder from an eval's own
run instructions) from the `describe` body, which runs at collection. The
assertion now states the property — reached before any case, never inside an
`it` — instead of a position. Mutation-proven.

Checked: `typecheck`, `lint`, **545 test files and 8,566 unit tests passing.** The
eval is not in CI and never will be: it spends money, `*.eval.ts` is outside the
unit config's include, and it is run by hand with `pnpm eval:symbols`.
