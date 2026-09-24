### Ask answers across several tools in one reply (Cyrus)
`cyrus/ask-compose-answers`

Ask "how's Maple Street doing?" and you used to get one lane — the margin,
or the invoices, never both. Now one answer carries the lot: what the job is
making, what the GC still owes, what is waiting on an answer, what is left
to finish. One lead line, one bullet per area, and the areas that are clean
on one line at the end rather than a bullet each.

**Almost nothing was in the way, and saying so is the point.** The loop has
composed since it was written — several tools in one pass, run together,
with `toolsUsed`, `citations` and `links` accumulated across all of them,
and `eval/top-questions.ts` has carried a `several` route the whole time.
What said "one tool" was the system prompt, in two places and by omission in
a third: it permitted a wide read and then only ever illustrated it with
COMPANY-wide questions, so a question about one job read as narrow; it had
no answer shape at all for one subject with several AREAS; and
`job_overview`'s own description claimed "how's Riverside looking" for a
single tool that holds no receivables — so the exact question this is for
routed to the one tool that cannot say the GC is 42 days late. The fix is
one prompt section and one tool description. No new machinery.

**THE FIGURE THIS WAS JUDGED ON: the guard blocks ZERO of the composed
answers.** The number-provenance guard (#462) shipped measured against
single-tool answers only, and a composed answer names more figures from more
sources — the shape most likely to make a guard start refusing good work,
which is how a guard gets switched off and then catches nothing at all.
`provenance.corpus.ts` now carries five composed entries (48 total, up from
43) and `provenanceCorpus.test.ts` counts what it would block: 0 of 5
composed, 0 of 48 overall.

That zero is only worth something because the set it is measured over cannot
quietly shrink. Three literals a person edits guard it, and the middle one
is new for exactly the reason CLAUDE.md's `scratch-cleanup-order` scar
records — a number-extractor that matches nothing refuses nothing and
reports a PERFECT false-positive rate. `COMPOSED_ENTRIES` (5) pins the
denominator, `COMPOSED_CLAIMS` (27) pins the parse over the composed entries
ALONE, and `CORPUS_CLAIMS` (180) pins it over everything. The narrow one is
necessary: breaking the extractor was mutation-tested, and both "blocks none
of them" tests went GREEN while `COMPOSED_CLAIMS` went red with "expected 0
to be 27". 153 claims from 43 single-tool answers would have drowned five
composed ones.

**A composed answer may say a total, and only through the calculator.** The
"never do arithmetic" rule is untouched and the new section restates it
twice: two areas' figures stay two figures side by side. Where a combined
one is genuinely wanted, `calculate` (#466) does it in code from figures
addressed by path, and its outcome is itself a tool result — which is the
only reason the guard lets the total be said at all. One corpus entry runs
the REAL calculator over a real ledger built from the same bytes the model
gets, so a path that stops resolving fails the build instead of quietly
offering nothing to trace against.

**Composing does not become a way around a refusal.** A question this app
cannot answer is still declined with four tool results open, which is harder
than declining with none — an adjacent number is more tempting the more of
them are on the table. `compose-payroll-declined` is that case in the
corpus: two tools' figures stated, the payroll half refused in a clause.

`composedStream.test.ts` is the wiring half, and it is the only place the
things that would actually break this in production are visible: all four
results reach the guard rather than whichever ran last; `toolsUsed` carries
every tool; three tools citing the same page produce ONE citation, not
three; eight item links dedupe to seven and cap at six, in that order; and a
composed answer that totals two tools itself is still retracted, with the
figure kept out of the refusal. Neutering the guard was mutation-tested —
that last test goes red and the answer streams through.

Cost, estimated rather than measured (no live calls were made): the new
prompt section is ~750 tokens in the cached prefix, so it costs every
question about +3.6% of its cache reads whether it composes or not, and a
composed question costs roughly 20-25% more than a narrow one — about half a
cent on `claude-opus-5` — almost all of it the extra tool_use blocks, not
the tool results. It does NOT add a pass: four tools run in one round, so
the latency is the slowest tool rather than the sum, and one question still
claims one unit of the allowance.
