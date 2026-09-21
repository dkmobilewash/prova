### The first screen never shows a digest (Cyrus)
`cyrus/first-screen-no-digest`

Cyrus signed up as a test contractor and the first thing the product showed
him was Next's stock page: "Application error: a server-side exception has
occurred … Digest: 446730191". Two separate defects produced that screen,
and only one of them was the environment.

**The error boundary could not see the layout.** `app/(app)/error.tsx` was
the only boundary in the app, and a Next.js `error.tsx` renders INSIDE its
own segment's `layout.tsx` — so it catches a failing page and never the
failing layout beside it. `app/(app)/layout.tsx` is the first server code a
signed-in person runs (the Company row, four queries) and was the one place
a first-run failure could come from that nothing could catch. That morning's
trigger was demo-database drift — a column the preview's database did not
have yet — which is exactly the case the boundary's preview paragraph names
and tells you how to fix (run the Migrate demo database workflow). It sat one
segment too low to be shown.

Now there are three boundaries rendering ONE component
(`components/PageLoadError.tsx`): `app/(app)/error.tsx` for a page inside
the shell, `app/error.tsx` above the `(app)` layout (also covering
`/welcome`, `/pilot` and sign-in, which had nothing), and
`app/global-error.tsx` for the root layout itself. Same copy everywhere —
the don't-resubmit line, the digest to quote, and the preview hint by
environment. `lib/errorBoundaryCoverage.test.ts` walks `app/`, checks the
walk against `git ls-files`, and fails the build if any layout lacks a
boundary in a STRICT ancestor or any page lacks one at all; it also renders
all three boundaries and asserts the preview paragraph appears on a preview
and not on production. Mutation-tested: removing `app/error.tsx` fails 12
tests, removing `global-error.tsx` fails 5, dropping the preview paragraph
fails 3.

**Save with nothing selected on `/welcome` threw.** Reproduced before it was
fixed, not taken from the report: `saveBusinessScope(new FormData())`
rejected with `"contractingRelationship" must be one of: …`. The chain was
two classes with one name — `lib/actions/company.ts` declared its OWN
`InputError` and its own `runAction` that caught only that class, while the
shared `enumFromForm` it calls threw a bare `Error`; `instanceof` false,
rethrown, redacted to a digest in production, and `CompanySetupGate`
awaited it with no try/catch on a page with no boundary above it.

Four changes, each with its own red mutation: `enumFromForm` and
`optionalEnumFromForm` throw the shared `InputError`; `company.ts` drops its
local copies and imports the shared pair; `saveBusinessScope` checks for an
unanswered question FIRST and returns a sentence about the three questions
rather than the parser's field-and-constants list; `CompanySetupGate` (and
the Settings form for the same action) catches a thrown action and renders
"Couldn't save just now" instead of escaping; and every radio is `required`,
so a browser refuses an empty Save before any request is made.
`lib/businessScope-save.test.ts` and `components/companySetupGate.test.ts`
pin all of it, both directions — the refusal for the empty submit AND the
real write for the full one.

Blast radius of the `InputError` change, measured rather than assumed
(`grep "^class InputError" lib/actions/`): a module calling `enumFromForm`
is in one of three states. Using the shared `runAction` — it now gets a
readable refusal where it got a digest. No boundary at all — still
rethrows, unchanged (`InputError extends Error`, so nothing that caught
`Error` stops catching it). Or — FIFTEEN of them, `submittals.ts` through
`alerts.ts` — declaring their own local `InputError` with a local
`runAction` that catches only that, which is `company.ts`'s exact defect
fifteen more times: for those the parser's refusal was rethrown before and
is rethrown now. Not widened into this PR, which is about the first screen;
filed as its own follow-up. The one-class rule in `shared.ts`'s own comment
("five structurally identical copies free to drift") is the fix, and it is
mechanical.
