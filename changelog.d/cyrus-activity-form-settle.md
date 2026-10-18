### A form that closed onto stale data, and a census a comment could satisfy (Cyrus)
`cyrus/activity-form-settle`

**#163.** Logging a sales activity looked like it had failed. `SalesActivityForm`
ran `router.refresh(); reset(); setIsOpen(false)` the instant the action
resolved — and CLAUDE.md had already measured the gap on production with the
clock started on the Save click: **action resolved and form closed at 1,251ms,
row repainted at 3,502ms.** So for 2.25 seconds the form was gone, telling the
estimator it had saved, while the row behind it still showed the old value. Two
separate click-throughs reported that as a lost update; neither timed it, which
is exactly why that entry now demands a timestamp before a report of this shape
counts as evidence.

The fix already existed in `ActionForm` — fire the success side-effects from a
settle effect gated on `useTransition`'s `isPending`, so a form closes onto
fresh data — and had never reached this one, because this form hand-rolls
`router.refresh()`. Ported rather than converted, and **the deciding reason is
the Cancel button**: `ActionForm` owns its own transition and exposes no
`isPending`, so Cancel would be clickable mid-flight, and a mid-flight Cancel
calls `setIsOpen(false)` directly — the same defect arriving through a different
door. `router.refresh()` stays inside the transition deliberately: it is what
holds `isPending` true until the refreshed tree commits, so the gate waits on
the repaint rather than on the round trip.

**THE COST IS REAL AND IS STATED IN THE COMPONENT:** a successful save now
leaves the form open about two seconds longer, button disabled, `aria-busy` and
spinning. That is the right trade — a form that closes onto stale data is worse
than one that takes two seconds — and the two seconds are the measured server
render, not overhead this adds. `aria-busy` was missing from the hand-rolled
button, so those extra seconds would have been silent to a screen reader.

**The mutation that mattered came back GREEN first.** Reverting the whole fix
reds the settle test, as expected. But the NARROWER mutation — move only
`setIsOpen(false)` inline, leave the reset queued — passed, because once the
form unmounts `formRef.current` is null, so the queued reset silently stops
happening and the remounted textarea is empty anyway. No symptom in happy-dom.
"Nothing is ever missing from a question nobody is asking." The answer is a test
that reads **commit order** off `MutationObserver` records: the Save button's
`aria-busy` must clear *before* the record that removes the form — the save
visibly finishes while the form is still on screen. Two harness failures were
caught by their own controls on the way: a per-batch snapshot could not separate
the commits at all and went red on working code, and the first ordering
predicate matched `aria-busy` being ADDED rather than cleared, so it passed on
the very mutant it was written for.

**#541.** `action-capability-guards.test.ts` could be satisfied by a
**commented-out** guard. The issue's framing needed narrowing and the file now
says so: the execution layer in section 5 is a real backstop and caught the
mutation, so the whole file was never green. What was broken is narrower and
worse — three decision registers (`KNOWN_OPEN`,
`UNDECIDED_BEHIND_AN_AMBIGUOUS_PAGE`, `MIXED_DOORS` with a null capability) ask
the source reader whether a guard exists **in the negative**, nothing executes
for them because the action is recorded open on purpose, and a comment was
enough to make one lie.

**And the reader was worse than "comments counted": it never found the body at
all in six cases.** The brace counter took the first `{` after the declaration,
so an inline object type in the return annotation —
`Promise<ActionResultWith<{ pathname: string }>>` — closed the count before the
body began. 402 of 408 bodies read correctly; six truncated to 100-300 bytes.
Replaced with a TypeScript-parser walk, where comments are not nodes, so
nothing returned can come from one. `withoutComments` was read and rejected:
stripping comments from a signature still leaves a signature.

**That truncation had already produced a false record.**
`ask.prepareAskAttachment` has asserted `can(context, "MANAGE_JOBS")` since it
was written, and this census had never seen it — so it sat recorded as an
**open endpoint that was in fact closed**, in a list nothing executes. Moved to
the decided section, where it now runs. No application code changed; the guard
was always there.

**Prose-only guards: none**, said plainly because it is a real finding. Two
independent sweeps — a raw-vs-AST diff over all 408 actions, and a scanner pass
over every comment token in all 82 action modules — found zero. The census was
correct about every action it could see, even though it could be fooled.

Filed rather than fixed: **#677**, the same reader in
`portalCredentialCensus.test.ts`, on the credential that logs a GC in, where it
is worse — that file uses the match OFFSET to decide whether the guard comes
before the write, so a comment can make a guard look both present and first.
Nothing is hidden there today; the mechanism is live. Billing is Diego's lane.

Not touched, deliberately: the other 52 hand-rolled forms carry #163's defect,
and `components/ContactInteractionForm.tsx` is the identical shape line for
line. Widening this PR to 52 forms is how one fix becomes an unreviewable diff.
