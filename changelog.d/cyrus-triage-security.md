### Three forms stop throwing away what you typed when a save is refused (Cyrus)
`cyrus/triage-security`

Issue #311, and the two more files its own comment thread added to it.
`QuickBooksMapping.tsx`, `JobDetailsForm.tsx` and `CompanyProfileForm.tsx`
each submitted through React's `<form action={fn}>` prop. React 19 calls
`requestFormReset` UNCONDITIONALLY before running that action — it does not
wait to hear whether the save worked — so every refusal these three actions
return arrived over fields that had already snapped back to their defaults.

What that cost, concretely. On Settings → QuickBooks, a refused mapping put
the account picker back to "— Choose an account —", so the reason was
printed above a control that no longer held the choice it was complaining
about, and finding the right row again means re-reading a list fetched from
Intuit. On a job's details, a corrected name, a re-typed site address and a
rewritten scope all went. On the company profile, the EIN and the licence
numbers a person had just entered went — a form whose entire header is about
saying what is missing, wiping what was supplied.

All three are now `onSubmit` + `preventDefault()` + `new FormData(event
.currentTarget)`, read synchronously because `currentTarget` is null by the
time the transition's callback runs. None of the three resets on either
branch, which is right rather than lazy: all three are edit forms, so on
success what is on screen already IS the saved record.

**The check for it is the census removing its own exception.**
`components/formActionCensus.test.ts` already knew about all three — it
listed them as `KNOWN_EXCEPTIONS` pointing at #311, because they sat in the
other lane. Deleting those three lines is what re-arms the census over those
files, so the test for the fix is the fix itself: put `action={…}` back on
any one of them and the census names that file and line. Done for all three
and watched go red, one at a time, each mutation confirmed present in the
file before its result was read.

The test that used to hold the exception in place (`keeps #311 on the list
until it is fixed`) is REPLACED rather than deleted, by its inverse: the
three paths must NOT appear in `KNOWN_EXCEPTIONS`, and they must still exist
on disk so the assertion cannot pass by naming nothing. Without that, re-adding
an exception is a two-line change that makes the census green over a
re-broken form, and the only surviving record that it was ever fixed is a
merged PR nobody re-reads. Mutation-tested by re-adding one while the file
was still correct: both that check and the census's own stale-exception check
fire.

**AND THE HALF THE CENSUS CANNOT SEE: DOES EACH FORM STILL SAVE?** The census
proves the forbidden prop is gone. It executes nothing, so it proves nothing
about the replacement — and rewiring three real forms onto a hand-rolled
`onSubmit` has three silent failure modes, every one of which leaves this
whole repo green and the form quietly not saving: the FormData read after an
`await` (by then `event.currentTarget` is null), the call left outside the
`useTransition` (so the button stops disabling and #19's duplicate-record
guard is gone), and a missed `preventDefault()` (a full native POST that
looks like a save). What these three forms had before was `jobDetailsForm
.test.ts`, which reads the rendered controls without ever submitting;
`companyPointer.test.ts`, which reads `CompanyProfileForm.tsx` as a STRING;
and for `QuickBooksMapping.tsx`, nothing at all. No e2e spec touches any of
the three screens.

So each form now has a behavioural suite that mounts the real component,
types into it, FIRES A REAL SUBMIT and asserts four things: the action ran
exactly once, the FormData it received carries what was TYPED rather than the
defaults, a refusal leaves every typed value on screen with the reason beside
it, and `defaultPrevented` is true. Plus the pending button, because that is
where #19 lives. `quickBooksMapping.test.ts` is the one worth reading: that
form does not exist on screen until a chart of accounts comes back from
Intuit, which is why it shipped untested and why Cyrus cannot easily click
it, and its account NAME is written into a hidden input by the select's own
`onChange` — so a FormData read at the wrong moment loses both halves of the
mapping at once.

Seven mutations, each confirmed present in the file by `grep` before its
result was read, each red, each restored: `preventDefault()` removed (×3),
the FormData read moved after an `await` (×3), and the call taken out of the
transition (×1, on the job form, so the pending assertion is not vacuous).

**One assertion was DROPPED rather than written, and the reason is measured.**
Whether the hidden QuickBooks account-name field survives a refusal cannot be
answered here: happy-dom does not implement the HTML dirty-value flag, so
assigning `defaultValue` overwrites a live `value` it should have left alone,
and React assigns `node.defaultValue` on every re-render. In here the field
reads empty after the refusal re-render; in a real browser, where setting
`.value` marks the control dirty, it should still hold the name. That "should"
is on the click-list, not in the suite — and the environment's behaviour is
itself asserted at the bottom of that file, so if happy-dom ever gains the
dirty flag the note goes red instead of quietly rotting.

**Also in this branch, and no code with it: seven other issues assigned to
Diego were triaged against the current code rather than against what they
said when filed.** Five had been fixed under them and their issues never
updated — #26's inverted P2002 guard (now `isUniqueConstraintError`, with
`prisma-error-guards.test.ts` standing over it), #62's wage-determination
crash (now `actionFail`, asserted as a returned value in
`prevailingWage.dbtest.ts`), #351's ungated money deletes (capability added
by #392, two-step `ConfirmDelete` present on both), #352's unmetered
outbound email (now `MANAGE_JOBS` + `outbound-email-limit.ts`) and #353's
unbounded compliance extraction (now claimed against the fail-closed paid
allowance). The parts that are still real are argued on the issues; nothing
touching a money figure, a permission boundary or a security posture was
changed here, because those are Cyrus's to decide and not an agent's.
