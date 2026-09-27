### The launch video, rehearsed by a machine the night before the shoot (Cyrus)
`cyrus/shoot-rehearsal`

Cyrus films the launch VSL tomorrow morning off a run sheet that states, for
every beat, the result the screen must produce — and for three beats, the
wrong result that means "stop and retake". Nobody had checked one of those
promises in a browser. `apps/web/e2e/specs/shoot-rehearsal.spec.ts` walks the
beats in order in CI's signed-in Chromium and asserts each promise as
arithmetic, and it found three things wrong with the run sheet rather than
with the product.

**Beat 2's retake instruction fires on correct behaviour.** The sheet says
the assistant's retainage total "matches the rail figure", and that a
difference "by any amount" means stop and retake — "that match is the entire
claim of the beat". The rail's Getting-paid stage is
`unbilledContractValue + retainageHeld` (`lib/moneyRail.ts`) and prints that
definition on screen as its own caption. It equals retainage held only on a
company billed to the last dollar. The spec builds the ordinary case — one
contracted job, part billed — and measures the gap: the rail reads $3,788.00
against $468.00 of retainage, the difference being exactly the $3,320.00 not
yet invoiced. Following the sheet would have burned the morning retaking a
beat that cannot match.

**Beat 4 points the camera at the wrong tab for its own evidence.** The
clicks keep the shot on the Estimate tab and then say to point at "the new
line tagged CO #2". That badge is rendered by
`components/ContractSummary.tsx`, which only the job Overview tab uses. The
contract total and % complete do move on the Estimate tab — both asserted as
before/after arithmetic, +$2,000.00 exactly and 25.0% → 20.0% — and the
tagged line is on Overview. The spec counts the tag as a *schedule row*
carrying both the scope and the badge, not as the string "CO #2", because
that string is on the Estimate tab already: it is the change-order card's own
heading, and a substring check would have reported the sheet as correct.

**Beat A's fallback describes a state the product cannot reach.** The sheet
offers "Nothing is red → a payroll register was imported" as a better take.
`lib/wh347.ts` adds `statementOfCompliance` to the blocking set
unconditionally — page 2 of the form is not built — so `fileable` is false on
every week of every job and the red banner can never be absent. Good news for
the take, a false line on the sheet. The spec asserts the banner's stated
count equals the number of boxes it actually lists, so a panel reading
"0 things are missing" fails instead of satisfying a substring.

**And a fourth thing, found by the spec's own first CI run rather than by
reading.** `/cash-flow` prints **"Total outstanding" twice, about two
different sums** — the AR aging total, net of retainage, and the retainage
receivable — one section apart, same three words, same type size. The first
version of this spec asked for that label without naming a section and failed
on its own count assertion instead of reading whichever one Playwright reached
first, which is the only reason it is written down here rather than having
produced a confidently wrong figure. Beat 2's cross-check points a finger at
"the retainage total on /cash-flow"; there are two candidates, and only one of
them is retainage. The count is now asserted as exactly two and the figure is
read from inside the section that owns it, so a third label or a missing one
says so rather than being read by position.

That first run also cost three good beats their verdicts: the block is serial,
so the locator failure skipped beats A, B and 6 and they came back as SKIPPED —
neither a pass nor a fail. The cross-check is now the LAST test in the file,
because it is the one most likely to be about a locator and the three after it
were read-only and depended on nothing in it.

**What it deliberately does not prove, said in the file rather than left to be
discovered.** The shoot runs on the demo dataset and this suite has none of
it, so every beat is walked against a job the spec builds; that proves the
mechanism and no figure the sheet quotes about Riverside. Beats 2 and 3 call
a live model and `playwright.config.ts` forces `ANTHROPIC_API_KEY: ""` into
the server under test, so they are recorded as unproved by a test that clicks
Settings → Assistant → Check connection and asserts the "No Anthropic API key
is set on this server" sentence — which also means the day somebody removes
that override, this suite goes red instead of quietly starting to bill
Anthropic. Beat B needs a union local, tiered and untiered crafts, fringe
schedules, a ratio rule and several shaped days of hours, all of which
`seed-demo.mjs` builds on purpose; it is recorded as unreachable, and the
reason it is not faked is written down: the phrase beat B points at,
"can't be judged", is in `/union-compliance`'s standing explanatory paragraph
and renders on a company with no union data at all, so a check for it would
go green and mean nothing.

`SHOOT` is a new persona with its own company, and it needs one more than any
other row in that table: beat 5 submits a pay application, which creates an
invoice, and this product has no way to delete one.
