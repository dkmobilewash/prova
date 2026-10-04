### Nine findings and not one of them said how sure it was (Diego)
`diego/spec-click-findings`

The spec reader (#604) was clicked through on production the day it shipped.
Most of it held: it found the mock-up buried on page 2, Level 5, UL U465; it
did **not** report the fireproofing or seismic bracing that page 3 expressly
excludes; the spec meter moved by exactly 3 and the plan-sheet and
addendum-page meters never moved; the off switch refused in a readable sentence
and charged nothing. Four real defects came out of it, and the two that matter
were both invisible to every test in this repo.

**Confidence was shown for LOW findings and for nothing else.** The run
returned nine findings, every one MEDIUM or HIGH, so the screen showed no
confidence anywhere — and the tester reported the lowest-confidence-first
ordering as *unverifiable*, because there was nothing on the page to order.

That is not untidiness. This whole feature rests on `DECISIONS.md`'s rule —
*"a count that is 85% accurate and says so is useful; a count that is 85%
accurate and reads as certain is a wrong bid"* — and a MEDIUM finding rendered
identically to a HIGH one reads as certain. **The eval cannot catch it**: it
reads the `confidence` field, which was correct the whole time. Only a person
looking at the screen could, and one did. Every finding now carries a word —
"clear in the section", "worth checking", "least sure" — with the amber colour
still only on LOW, so the badge keeps meaning "look here" while the other two
stop meaning nothing. A word and a colour, never a colour, and never neither.

**Spec pages were missing from the cost panel, and this is the expensive one.**
The unit was registered in eight places that fail to compile when one is
missed — `AI_FEATURES`, `FEATURE_MODEL`, the `AiFeature` enum,
`AI_FEATURE_LABEL`, `AI_FEATURE_DESCRIPTION`, `AskUsageFeature`, the gate
census, `FEATURE_LABELS` — and all eight were done. `unitDefs` in
`cost-query.ts` is a ninth and is a hand-written array, so nothing forced it.
`allowanceOver` never summed `specPagesUsed` either.

The symptom was the quietest available: the per-FEATURE table showed
`spec-read` and its 10,894 tokens correctly, so the screen looked complete,
while the cost **per spec page** — the one figure step 2 of the AI plan exists
to produce, and the only thing that can answer whether 1,800 pages a month is
right — was never computed. The allowance decision was resting on a number the
panel could not produce.

`unitCensus.test.ts` closes it, and asks the second-list question rather than
the completeness one, per CLAUDE.md's #526 entry: *a guard that a list is
complete cannot notice a second list.* It derives the metered units from
`AskAllowancePeriod`'s own `…Used` columns — a unit is metered exactly when a
column counts it — and the panel's units from `unitDefs`, asserts both sizes
against counts taken a different way, strips comments first (`cost-query.ts`
now discusses the missing row at length, and a raw-text census would find it
in the prose and call it registered — the #185 shape), and fails in both
directions. Mutation-proved by cutting the spec entry back out: **3 of 4 red**,
on the world exactly as #604 shipped it.

**The refusal rendered at the top, above nine findings.** You press "Read it
again" at the bottom; the gate refusal appeared under the summary line, off the
top of a long scroll, and was not announced to screen readers. A refusal nobody
reads is a dead button — the exact failure the `ActionResult` convention exists
to prevent, lost at the last step by putting the correct string somewhere nobody
looks. It now renders directly under whichever control was pressed, in a
`role="alert"` region.

**And "3 pages" became "3 pages charged"**, matching the promise the line above
the button makes before the press.

**Two things the run flagged that are NOT defects**, checked rather than
assumed. The row reading "09 21 16ZZ-TEST Gypsum Board Assemblies" is text
extraction, not layout: the number and title are separate spans and the second
carries `ml-2`, the identical pattern the addendum and bid-form rows in that
file already use — there is a gap on screen and no whitespace text node for
`textContent` to report. And the model's mock-up quote stopping before "shall be
demolished and removed" is quote selection, not a miss; the finding's own
wording carries the demolition.

**The honest gap in that run, now closed.** The tester's mouse, keyboard and
screenshots all failed together, so it worked by script and said so: *"I can't
confirm that a real mouse click works on these buttons."* Right to flag it, and
it left the data path proved and the first press unproved.
`bidComplianceSpecClick.test.tsx` does the press properly — `element.click()`
through React's own delegated listener, no handler reached for, nothing asserted
about internal state, only what a person would then see. It also proves the
spec button opens the **spec** form rather than one of its two neighbours, and
that opening a form calls no action.

Mutation-proved three ways, the last being the decisive one from the
expo-router scar — *make it render nothing*: point the button at the addendum
form, 3 red; make the handler a no-op, 3 red; hide confidence for HIGH and
MEDIUM as it shipped, 2 red. The first run of that file also printed
`act(...) is not configured` on every test while passing all six, which is luck
about React's scheduling rather than a result, so the flag was set before the
greens were believed. And `tsc` caught the fixture missing a required `id` after
vitest had run it green — a reminder that the runner does not typecheck.

559 test files, 8,692 tests.
