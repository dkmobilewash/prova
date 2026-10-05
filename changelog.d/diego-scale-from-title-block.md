### The title block was read, shown, and believed by nobody (Diego)
`diego/scale-from-title-block`

Plan ingestion asks a model for six things off each sheet's title block. Two of
them — the sheet number and the title — have an accept path. `proposedScale` was
extracted, stored, and concatenated into a ` · ` metadata line on
`PlanSheetReview`, **and read by nothing else in the repo**: three references
total, the writer, the query and that one string. The app paid for the token,
printed the answer, and threw it away.

This makes it the one thing in the calibration dialog that can disagree with the
estimator.

**Why that is worth having, and it is not convenience.** `takeoff-plan.ts` opens
by quoting the sentence that deferred the whole feature for weeks — *"a measuring
tool that is slightly wrong is more dangerous than no measuring tool, because a
number that came off a screen gets trusted."* Every notice the dialog shows today
is derived from the same two clicks and the same typed distance, so a calibration
dragged along the wrong dimension is **self-consistent and silent**: it reads
back as a real standard scale, the sheet width looks plausible, no notice fires,
and every quantity taken off that sheet is wrong by that factor. The title block
is the only evidence in the system that did not come from those two clicks.

So `calibrationNotices` now names both readings when they disagree:

> The title block on this sheet says 1/4" = 1'-0", and this calibration reads
> 1 in = 8 ft. If you calibrated against a blown-up detail that is expected —
> otherwise check the dimension you dragged along.

**A WARN, never a refusal, and that is not timidity.** A detail blown up on a
sheet whose title block names the plan's scale is ordinary draughting; `AS NOTED`
exists precisely because one sheet carries several scales, and multi-scale
detection is explicitly not built. This file cannot tell that from a mistake, so
it names the two readings and says which case would explain them rather than
deciding. Same position `bid-responsiveness.ts` takes by having no "compliant"
verdict.

**It never calibrates anything, and the type says so.** A calibration is the line
somebody dragged — `TakeoffScaleCalibration` stores that line and deliberately
never a factor, so the printed scale cannot become one without inventing a second
calibration mechanism with different evidence behind it. `PlanSheet.printedScale`
is comparison input and nothing else.

**`standardScaleFromText` matches names rather than parsing arithmetic.**
`STANDARD_SCALES` is already the list of scales this app can name, and a parser
would be a second, divergent authority on the same question. It returns null
rather than guessing on all three "no answer" cases, which are different from
each other and equally uncomparable: nothing was read, the sheet said `AS NOTED`
or `NTS`, or it printed a form this file does not list — including metric
`1:100`. A number invented from any of those would then contradict a correct
calibration, which is worse than silence.

**The prime-mark table is reused, not retyped.** A model reading a title block
returns `1/4″ = 1′-0″` some of the time, and `specs/quoteMatch.ts` already owns
`TYPOGRAPHIC_EQUIVALENTS` — U+2019 is the variant a real paid run produced there.
That is a fact about typography, not about specs, and a second copy of the list
is the defect this repo writes censuses to catch. Whitespace and hyphens come out
too: `1/4"=1'0"` and `1/4" = 1'-0"` are one scale typed by two people.

**The new argument is REQUIRED rather than defaulted.** A defaulted safety
argument is off until somebody remembers it, and #622 landed this afternoon
because a gate existed and could not be reached. The server action passes `null`
explicitly with its reason on the line above — the comparison is a warn and
`calibrationRefusal` reads only refusals, so loading the proposal there would
change no outcome, and a title-block disagreement must never block a save. An
omission that is visible in a diff is not the same as a missing argument.

Nine tests, and two mutations: `standardScaleFromText` forced to never match
reds five of them; dropping the punctuation normalisation reds exactly the two
prime-mark cases — the failure that would otherwise go quiet rather than wrong.
`typecheck`, `lint`, 569 files / 8,840 unit tests. No schema change, no
migration.

Still deliberately absent, and now cheap: nothing prefills the typed distance,
because the printed scale implies a factor and not a dimension; and a sheet
carrying several scales still has one calibration per page.
