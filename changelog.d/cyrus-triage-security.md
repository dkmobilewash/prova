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
