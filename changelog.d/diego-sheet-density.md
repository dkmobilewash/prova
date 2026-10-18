### A sheet too dense to pair now says so instead of never returning (Diego)
`diego/sheet-density`

Press **Find the walls** on page 7 of a real airport concourse set and nothing
happens. Not an error, not an empty result — the button spins and the pairer
never comes back.

#### What it actually was, which is not what was reported

The reported defect was *"Houston Hobby page 7 hangs in `pageStrokes`"* — the
PDF parse. Timing every page with a 20-second deadline disproved that in one
run: all 16 pages return, **median 109ms, worst 600ms, nothing over three
seconds.** The stage named in the report was not the stage.

Timed stage by stage instead, the pipeline enters `wallsFromBothEngines` with
152,189 segments and stops there.

| page | raw segments | usable (≥2 ft) | pair tests |
| --- | --- | --- | --- |
| **Houston p7** | 152,189 | **30,825** | **475,000,000** |
| Houston p11 | 387,891 | 16,288 | 133,000,000 |
| a school set's floor plan | ~2,000 | hundreds | ~1,000,000 |

`wallsFromStrokes` is O(n²) with `inAHatchSeries` scanning inside the inner
loop. p7 is **240× the work of a page that finishes.** CLAUDE.md already warned
about this shape at 79,001 segments; nothing bounded it.

#### A budget on the work, not a ceiling on the input

A segment-count limit would be a proxy for the thing that matters and wrong in
both directions: a page of hatching can be hundreds of thousands of raw strokes
that all drop out of the 2 ft pre-filter, and a page with fewer long ones can
cost more. Counting the **pair tests** bounds the real cost, so any sheet that
fits finishes exactly as it does today and only a sheet that cannot is refused.

**40 million**, which sits in a gap rather than on a line: working pages measure
around one million, and the two that hang are 133 and 475.

**Refused up front, not part-way through.** The pair count is known from the
input alone, so the sentence arrives immediately — p7 now refuses in **22ms**,
and that whole 16-page set runs end to end where before it stopped at page 7.

#### It throws rather than returning what it had

Returning the walls found so far is the tempting option and it is the shape this
repo has a name for: a result that *looks* like an answer. An estimator would
get a plausible, silently incomplete set of runs off a sheet the app could not
read, with nothing on screen saying which.

#### And the message says what is true

The generic catch said *"The lines on this sheet couldn't be read"*, which would
be false here — the sheet read fine and there is too much of it. A dense sheet
now gets its own sentence naming the count and what to do:

> This sheet has 30,822 lines long enough to be walls, which is more than the
> wall finder can pair. Trace the walls by hand on this one.

`SheetTooDenseError` is its own class so the viewer can tell it from a pdfjs
failure, which wants the other sentence.

#### Checks

- **Five mutations, every one red**: the budget removed (the hang returns);
  raised past every real sheet; lowered so ordinary floor plans are refused;
  counted on RAW segments so a hatched sheet is refused for nothing; and the
  viewer showing the generic message instead of the specific one.
- A test asserts the refusal takes **under two seconds**, because a refusal
  somebody waits for is still a button that feels broken.
- A test asserts 40,000 SHORT segments do **not** trigger it — the reason the
  count is taken after the length filter.
- 9 new tests, 539 across takeoff. Preflight green. No migration.

#### Click-list

1. Open a dense sheet — an airport, a hospital, anything with heavy equipment
   or hatching — and press **Find the walls**.
2. It must answer **immediately**, either with groups or with a message naming
   how many lines it found and telling you to trace by hand. It must not spin.
3. On an ordinary floor plan, the groups must appear exactly as they did before.
