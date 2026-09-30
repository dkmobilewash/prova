### What actually changed, in plain English (Cyrus)
`cyrus/seed-counters-zzbqtu`

Every button in this app that was working on something said so with a word
that did not move. `Saving…`, a hundred and thirty times, and the ellipsis
was the only promise that anything was happening. Cyrus found it while
filming: *"it's just a stagnate word, no loading icon, and I think it makes
people think the thing crashed."* He is right, and it is worse than cosmetic
— a page that looks dead invites a second click, and no create action in
this app is idempotent. `SubmitButton` exists because of exactly that.

So `components/Spinner.tsx` now sits beside all of them. The word STAYS: the
spinner is `aria-hidden`, so the label is the whole of what a screen reader
gets and the only thing that says *what* is happening.

**The two that mattered most were not in the hundred and thirty**, because
they had no word to find. `SubmitButton` — 48 call sites across 22 files —
disabled itself, set `aria-busy`, and changed nothing you can see. It greyed
out. There was no static label for a census to catch, so this was the one
place where the fix and the check both had to be written from scratch.

**44 of the 48, not all 48, and the four exceptions are the interesting
part.** `useFormStatus` reports the nearest enclosing form, so the spinner
fires only where that form is driven by a server action. Measured rather than
assumed: 19 of the 22 files are, through `<ActionForm>` (which renders
`<form action={…}>`) or a literal one. The other three — `ContactEditForm`,
`SalesLeadEditForm`, `TakeoffPlanUploader` — are `onSubmit` forms where
`pending` is always false, so `SubmitButton` contributes nothing there. They
are not a gap: each already carries its own `disabled={isPending}`, so the
duplicate-submit protection this component exists for is intact, and each got
a label-level spinner in the sweep. That also means they cannot double-spin,
which was the risk worth checking. The 48th is the armed confirm below.

**One button deliberately did not get one, and that is the interesting
half.** `ConfirmDelete`'s armed confirm is reached by 67 `pendingLabel` call
sites — one line, enormously tempting. It was patched and then reverted. That
component's own header states the invariant: once armed, it renders exactly
the DOM it rendered before. A spinner WIDENS the confirm, and CLAUDE.md's
"Cancel inherits the delete pixel" entry measured that cluster in real
Chromium across three axes — the third being a confirm drifting under the
delete's vacated pixel *precisely because the armed pair stopped covering the
same span*. No test here can see layout (happy-dom returns zeros from
`getBoundingClientRect`), and `pending={isPending}` at 70 of those sites
comes from a shared `useTransition`, so it is not only true after the confirm
click. The honest move was to leave it alone. It has a `spinner={false}`
opt-out and `spinnerCensus.test.ts` pins that opt-out at **exactly one use**
— a second one fails the build, because the next one will be somebody
quietening a spinner they found noisy, which is the opposite of the point.

**The check.** `lib/spinnerCensus.test.ts` asserts per EXPRESSION, not per
file: half these files have three or four buttons and importing `Spinner`
once proves nothing about the other three. It takes its scan roots from
Tailwind's `content` globs (`theme-contrast.test.ts`'s scar — nothing is ever
missing from a directory you do not walk), asserts one root per glob and that
each exists, and counts the labels a second way that shares no logic with the
first, requiring the two totals to agree exactly. It strips comments through
a brace-tracking tokenizer with a balance control, and that is load-bearing
rather than tidy: `Spinner.tsx`, `AskPanel.tsx` and `askDemoScript.ts` all
quote these labels in prose, and the opt-out site's own comment quotes
`spinner={false}` — so a raw-text scan would count two opt-outs and pass an
assertion of "exactly one" against the wrong two. That was observed, not
predicted: a mutation that removed the real opt-out left the quoted one
behind, and the census still correctly reported zero.

Mutation-tested four ways, each red and each naming the offender: the opt-out
removed, a second caller opting out, `SubmitButton` made to render nothing
(CLAUDE.md's own "make it render nothing" mutation), and a label stripped of
its spinner.

**And the sweep broke a census on its way through, which is the part worth
recording.** `hintCensus.test.ts` went red naming five money controls — Save
backcharge, and the four QuickBooks send buttons — as buttons that "no longer
exist under that label". They had not been renamed. `enclosingTag` took the
tag whose `<` most recently preceded the label, which is the enclosing
element only while the label is the button's FIRST child; wrapping the label
put a `</span>` there, the name regex failed, and the lookup returned
nothing. The census was RIGHT to fail — it cannot distinguish "renamed" from
"I can no longer see this", and it must never assume the second. But the
model of "enclosing" was one level too shallow, so it now walks left with a
depth count: a closing tag deepens, a self-closing element is balanced and
skipped, an opening tag at depth zero is the answer. `<h2>Log a
backcharge</h2>` still resolves to `h2` and is still not a control, which is
the exclusion that function exists for.

Also in here, from the same filming session: the Ask box is a `<textarea>`
that grows to 144px instead of scrolling a long prompt sideways out of view
— Enter sends, Shift+Enter makes a new line.
