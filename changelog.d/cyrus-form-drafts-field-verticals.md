### Forms stop losing typed work on navigation — drafts for the field/ops verticals (Cyrus)
`cyrus/form-drafts-field-verticals`

Closes the field-vertical half of #239, redline item 01. Half-fill a
submittal, tap a job chip to check something, come back: before this the
typing was gone, silently — the audit on that issue counted 75 form
components and exactly one using any browser storage. Lost typed work is
the category's most rage-inducing review complaint, per the ten-competitor
research of 10 Sep.

One shared hook, `useFormDraft` (components/useFormDraft.tsx, pure logic
in components/formDraft.ts), now backs 27 form components across
equipment, vendors, vendor pricing, punch lists, daily field reports,
safety incidents, toolbox talks, material orders, RFIs, submittals,
drawings, worker certifications and photo metadata/tags. It saves the
form's fields to sessionStorage on every change, keyed with the row's
identity (`rfi:edit:<id>`), restores them when the form next mounts, says
so in a plain dismissable sentence with a Discard button (no toast), and
forgets the draft the moment the action reports success.

sessionStorage rather than localStorage on purpose: a draft should
survive navigating around the app in the same tab — which is exactly how
the work gets lost — but must NOT resurface days later half-describing a
punch item that was long since fixed. AskPanel made the same call for the
same reason. The other deliberate NOs: no global listeners (one onChange
prop on each form, per CLAUDE.md's rule), no drafting of file, password
or hidden inputs (hidden fields are server-set identity — restoring one
could repoint an edit at the wrong row), and every storage touch wrapped
in try/catch so a private window or blocked storage leaves the form
working exactly as before, just without drafts.

The specific checks: `formDraft.test.ts` (23 tests, node environment, no
DOM) covers capture, restore, the skip-list, storage that throws on every
call, garbage under our key, and two rows never sharing a draft. Three
mutations were run and every one was caught: inverting the restore condition
(4 red), dropping clear-on-success (1 red), a restore that never finds a
draft (2 red). Billing/estimating/jobs-page/CRM forms are untouched —
they adopt the hook from the office lane.
