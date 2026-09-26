### When the E2E seed is refused, the log now says which rule refused it (Diego)
`diego/e2e-floor`

The two Clerk secrets went in today, so `ci.yml`'s `e2e` job ran its first
real pass — the first time anything behind sign-in has been checked in a
browser by CI. It got through install, Prisma, a real `next build` and a
booted server, and then died in global setup with this as the complete
explanation:

```
ClerkAPIResponseError: Unprocessable Entity
   at ../lib/seedClerkUsers.ts:46
```

That is the HTTP reason phrase and nothing else. **Clerk had already sent
the reason** — a `code`, a `message` and a human-written `longMessage` per
error, sitting on the thrown object — and `toString()` drops every word of
it. All of it was one property access away the whole time.

**Why the missing word is the expensive part.** A 422 from `createUser` is
always an instance RULE refusing an address, and *which* rule decides where
the fix goes: an allowlist or a blocklist is a dashboard toggle, blocked
subaddresses is a toggle, a rejected address format is a change to
`personas.ts`. Those have nothing in common except the status code. Without
`code` you cannot tell them apart, so the next move is a guess — and the
cheapest guess was wrong: "Block email subaddresses" looks obvious because
all six personas carry `+clerk_test`, but that rule keys on the address with
its subaddress REMOVED, and the six bases are distinct, so each one is a
first sign-up and allowed. An hour would have gone into the wrong toggle.

`describeClerkSeedFailure` prints Clerk's own `code`, `message`,
`longMessage`, HTTP status and `clerkTraceId`, names the persona that could
not be created, and says the one thing that is true whatever the code:
this is a setting on the instance those secrets point at, not a bug in the
app — so nobody's first move is reading app code.

**Deliberately NOT a lookup table keyed by Clerk's error codes.** Writing
one means inventing code strings that cannot be verified from here, and a
hint keyed to a code that does not exist is this repo's "written,
documented, and never called" shape — it reads as coverage while matching
nothing. Clerk writes `longMessage` for a person to read; printing it beats
paraphrasing it.

**The `instanceof` that would have failed only in CI.** The check is
duck-typed on purpose. `ClerkAPIResponseError` is re-exported by
`@clerk/backend` from `@clerk/shared`, which is not a direct dependency
here, so an identity check can be made against a different copy of the
class and silently return false — landing back on a bare "Unprocessable
Entity" with a unit test still green. That is mutation M2 below, and it is
the reason the test asserts against a plain object.

| mutation | result |
| --- | --- |
| stop printing Clerk's `code` | RED, 3 failed |
| `instanceof` instead of the duck-typed read | RED, 3 failed |
| the blank-line-eating filter this nearly shipped with | RED, 1 failed |

The third one is not hypothetical — I wrote it, in the first draft. Dropping
an absent `clerkTraceId` line with `.filter(line => line !== "")` also eats
every paragraph break, flattening the message into one block in a wall of
scrolling CI log. It is a `null` sentinel now, and a test holds the blank
lines.

**A false green in my own mutation harness, worth recording.** The first M1
run reported 9 passed — because the `perl` substitution had failed on a
`??` in the pattern and never applied, so it tested an unmodified file. A
mutation that does not apply is indistinguishable from a guard that works.
The harness now exits 3 if its needle is absent, which is the same rule
this repo already has for censuses (assert the set is non-empty before
reasoning about it) arriving in the tooling that checks them.

Nothing here changes what the suite tests. It changes what happens when the
suite cannot start, which on 2026-09-24 was the difference between a
diagnosis and a guess.

## It ran, and it caught the author choosing the wrong fields

The first version shipped, CI ran it, and the answer came back:

```
Clerk said (HTTP 422):
  - [form_data_missing] missing data
  clerkTraceId: 26ebe7ad7766ee667df8fe5df9f576f7
```

**Which is a MISSING FIELD, not a restriction** — the other family entirely
from the one the message confidently told the reader to go and look at.
Two things were wrong, and both are the same mistake:

- the pointer named Restrictions and nothing else, so it aimed an
  afternoon at the wrong dashboard page. It now names both families and
  says the `code` is what distinguishes them;
- `meta` was **not printed**, and `meta` is where Clerk names the missing
  parameter. The formatter had chosen which fields to show, and the field
  it did not choose was the one that would have ended the investigation.

So the formatter no longer chooses. It prints the labelled fields **and**
dumps every error object verbatim, because the lesson of the round trip is
that the useful field is the one you did not anticipate. `safeJson` makes
that dump non-throwing — a diagnostic that replaces the error it is
reporting is the worst available outcome.

**And the second vacuous test of the day, in a test written to catch the
first.** The new "prints meta" case asserted `toContain("username")` and
passed with the structured meta line deleted entirely, because the raw
dump at the bottom carries the same string. Mutation M4 went GREEN when it
should have gone red. It asserts the labelled form now.

| mutation | result |
| --- | --- |
| stop printing `meta` | RED *(green until the test was fixed)* |
| drop the raw dump | RED |
| let `safeJson` throw | RED |

## The 15 mismatches: Clerk's UserButton, and the day it took to name it

React said it in one line, once it was allowed to speak:

```
<ClerkHostRenderer component="UserButton" mount={function} …>
+   <div ref={{current:null}} data-clerk-component="UserButton">
```

The `+` is the node the CLIENT added and the server never sent.
`<UserButton>` renders nothing during server rendering and a mount div on
the client — `@clerk/nextjs` 6.9.6 defers to clerk-js, which does not
exist on the server. It is in the Topbar, which `app/(app)/layout.tsx`
mounts on EVERY authenticated page, so it was one React error per full
page load across the whole signed-in app.

That also explains the thing that made it look random: the failing pages
changed every run — `/intake`, `/submittals`, `/closeout` one time,
`/proposals`, `/lien-deadlines`, `/bids` the next. Nothing is special
about those pages. Only a FULL page load hydrates; a client-side
navigation does not, and which links get prefetched varies. The spec's own
comment had already noticed the wandering and attributed it to the page.

**`UserMenu` holds the button back one frame.** Server markup and the
first client render are the same 28px circle, the effect swaps in the real
control after hydration has already matched, and nothing moves because the
placeholder is the avatar's own size. Not `suppressHydrationWarning`: that
silences one element's own attributes and text, does not reconcile a
subtree the server never sent, and would leave the mismatch happening
while hiding the evidence.

**The test hydrates rather than describes.** It server-renders, hydrates
that exact HTML, and asserts on `onRecoverableError` — the callback React
actually fires for a mismatch, not a proxy for it. It carries a MUTATION
CONTROL as a permanent case: the bare `UserButton` must still fail to
hydrate. If that ever passes, the stub has stopped modelling Clerk's
asymmetry and every other case in the file has quietly become vacuous.

| mutation | result |
| --- | --- |
| drop the deferral, render `UserButton` directly | RED, 3 failed |

**The expensive part was not the bug, it was that production React will
not say what differed.** A mismatch arrives as `#418` with args
`["HTML", ""]` — the page, never the element. So the only tool left was
reading, and four hypotheses came out of the shell's 85 transitive imports
before one was right. One of them was a probe that "cleared" the Topbar
**because it had mocked `UserButton` away** — the suspect removed from the
line-up by the person running it.

`E2E_DEV_SERVER=1` now exists for exactly this and printed the stack above
in a single run. Reach for it FIRST next time; a day of reading is worth
less than one dev-server run.

## A hydration mismatch on every authenticated page, for every Mac user

Found while chasing the E2E hydration failures, and it is **not** what E2E
was seeing — that distinction is the whole entry.

`SearchLauncher` picked its shortcut hint during render:

```tsx
const shortcutLabel = isMac() ? "⌘K" : "Ctrl K";
```

The server and the browser are different machines. Vercel runs Linux, so
the HTML says "Ctrl K"; a reader on a Mac, iPhone or iPad gets "⌘K" on the
first client render. Two different text nodes in the same place on the
first render is a React hydration mismatch — and this component is in the
Topbar, which `app/(app)/layout.tsx` mounts on EVERY authenticated page.
One error per page load, per Mac user, since `c538c3ad` (2026-09-20).

**Why nothing caught it.** The `typeof navigator === "undefined"` guard
reads like it handles the server, and that is exactly what made it look
safe. It only stops the call from THROWING. Answering DIFFERENTLY on the
server than in the browser is the entire defect, and a guard that
confidently returns `false` is how it was produced.

**And why E2E was blind to it, which is the part worth keeping.** CI is
`ubuntu-latest` with a Linux Chromium, so both sides answer "Ctrl K" and
agree. The suite that exists to catch hydration mismatches could not see
this one, because the runner and the browser are the same platform. A
Mac-only defect is invisible to a Linux-only harness — so the test for it
is a unit test that RENDERS BOTH PLATFORMS, not another spec.

`searchLauncherHydration.test.tsx` calls `renderToString` twice with
nothing changing but the `navigator` the render can see, and requires the
markup to be identical — which is the comparison hydration itself makes. A
lint rule about `navigator` could be satisfied without that being true;
this cannot.

| mutation | result |
| --- | --- |
| restore the render-time `isMac()` | RED, 3 failed — names ⌘K against Ctrl K |

It pins the Linux-browser case too, precisely because that case ALWAYS
passed: a guard that only holds on the machine which never reproduces the
defect is not a guard.

**Still open, and explicitly not claimed as fixed by this:** the 15
mismatches the E2E run reports on `main`. They cannot be this bug, for the
reason above. Next step is to make production React name them — it reports
`#418` with args `["HTML", ""]`, which names nothing — by running the
suite once against `next dev`.

## And the raw dump paid for itself on the very next run

`meta` came back **empty** — `{}`. The answer was in `longMessage`, which
the labelled section printed and which the raw dump made impossible to
miss:

```
["username" "phone_number"] data doesn't match user requirements
set for this instance
```

So the `striking-jaybird` instance requires a username and a phone number,
and the suite was sending an email alone. Had the formatter still been
choosing fields — and `meta` was the field I added precisely to answer
this — the second round trip would have printed `meta: {}` and told us
nothing. That is the argument for the dump, made by the run after the one
that suggested it.

**Fixed on the suite's side, not the instance's.** Each persona gains a
username and a phone. The alternative — relaxing the requirement on
`striking-jaybird` — was rejected because that instance is SHARED: it
holds the original dev users, and loosening what it asks for so a test can
pass changes what every other dev sign-up is asked for. Sending two more
fields costs nothing and touches nobody.

The numbers are Clerk's documented fictional range, `+1 (XXX) 555-0100`
through `555-0199`, which send no SMS and verify with `424242` — the same
bargain `+clerk_test` makes for email. `personas.test.ts` holds both
invariants that are invisible at the point a seventh persona would be
added: every identity field distinct, and every phone inside the test
range. A real number there would text a stranger on every CI run.

| mutation | result |
| --- | --- |
| two personas share a phone | RED |
| two personas share a username | RED |
| a real phone number slips in | RED |

A duplicate would not fail where it was made — it fails inside
`createUser` on whichever persona is seeded second, as the same opaque 422
this whole PR started with.

## Seeding cleared, and the next layer was one setting wearing 24 disguises

With the users created, `verdicts: collected 36, returned 36` — every
verdict came back for the first time. 24 of them were failures, and they
read as 24 different bugs: `1. sign in` timing out at **120 seconds**,
six empty states failing `toBeVisible`, two fixtures timing out at 180s,
eleven journey steps SKIPPED.

They are one cause. Every persona landed on

```
/sign-in/tasks/choose-organization?redirect_url=/dashboard
```

which renders **0 visible characters**, because *this app does not use
Clerk organizations at all* — tenancy is Prova's own `Company`, adopted by
verified email in `lib/auth.ts`. Grepped rather than assumed: one hit for
`orgId` in the whole app and it is a string inside an unrelated test.

Clerk made **"Membership required" the default** for instances with
Organizations enabled on **2025-08-22**, and that setting routes every
session through `choose-organization` and disables personal accounts. It
is an instance setting the app cannot satisfy, so no amount of suite work
fixes it — **Configure → Organizations → membership optional**, on the
instance whose keys the secrets hold.

`failOnSessionTask` now fails in milliseconds and says that sentence,
instead of 24 assertions each failing on its own terms with nothing naming
the cause. It matches ANY `/sign-in/tasks` route rather than the one task
we have met — Clerk adds tasks, and an unknown one must not degrade back
into a two-minute timeout (mutation M10).

| mutation | result |
| --- | --- |
| only catch `choose-organization` | RED, 3 failed |
| stop checking at all | RED, 3 failed |

**A test-writing mistake I made twice in one session, so it is written
down.** Both `seedClerkUsers.test.ts` and `signIn.test.ts` first asserted
an exact PHRASE against a message that is hard-wrapped for a CI log, and
both failed on *where the text wrapped* rather than on a missing idea. A
test that breaks when you reflow a paragraph is measuring the wrong thing.
Assert against `text.replace(/\s+/g, " ")`, or per word.

**One thing for Diego rather than for this PR:** development requires
username and phone; nothing here establishes whether production
(`cstream.ai`) does. If it does not, the two instances disagree about what
a user needs, which is the kind of drift CLAUDE.md's Clerk table exists
for. Flagging, not fixing — it needs somebody who can read both
dashboards.

**And the same question about organizations is the more urgent half.** If
production also has Organizations with membership required, a brand new
signer-up there walks into the same blank `choose-organization` page — and
pilot contractors are the people who would find it. NOT ESTABLISHED from
here, and deliberately not asserted either way: an agent container cannot
reach either dashboard. What IS established is that the app has no code
that could satisfy that task on any instance. Worth ten seconds of
somebody's attention before it is somebody's first impression.

## The dev-server diagnostic ran, answered, and is switched back off

`E2E_DEV_SERVER` was temporarily forced ON (`2a885f13`, "REVERT THIS LINE")
so one CI run would print React's own hydration diff instead of a stripped
`#418`. It worked. Run `36097089609` named the element:

```
<withClerk(UserButton)>
  <UserButton …>
    <ClerkHostRenderer …>
+     <div ref={{current:null}} data-clerk-component="UserButton">
```

A node the browser's first render has and the server's HTML does not — an
ELEMENT-level mismatch, which is what `args[]=HTML` meant all along. Not a
date, and not `SearchLauncher`.

**The default is back to `=== "1"` and must stay opt-in.** Nothing in
`ci.yml` sets the variable, so a `!== "0"` default silently turns the
signed-in `e2e` job into a dev-server run — a suite whose entire premise is
"the way production runs it", reporting on something else. Two further
reasons from that same run, neither anticipated:

- **it is slow and self-noising** — 12.7 minutes, its own 120s timeouts and
  an `ERR_CONNECTION_RESET`, so 24 of 36 verdicts were red for reasons that
  are the server, not the app;
- **it inverts the crash/mismatch split.** `lib/health.ts` recognises a
  hydration mismatch by matching `Minified React error #418`, which a dev
  build never emits. So under `E2E_DEV_SERVER` every mismatch lands in
  `crashes` instead and fails the step it happened on — exactly the
  mid-spine failure step 11 was written to avoid. The flag changes what the
  monitor MEANS, which is why it is a diagnostic and never a mode.

`verdicts: collected 36, returned 36` on that run, which is the number worth
keeping from it: whatever else was red, nothing was silently absent.

## The Mac mismatch, measured rather than argued

The section above says the `SearchLauncher` defect cannot be what E2E sees.
That is now measured instead of reasoned, in real Chromium against a
production React build, by rendering the component's real source on the
server (no Mac) and hydrating it with `navigator.platform` overridden before
the first script runs:

| component | platform | React error |
| --- | --- | --- |
| before the fix | `MacIntel` | `#418 args=["text", ""]` |
| before the fix | `iPhone` | `#418 args=["text", ""]` |
| before the fix | `Linux x86_64` | none — **why CI was blind** |
| after the fix | `MacIntel` / `iPhone` / `Linux` | none, label still ends up `⌘K` |

`args[0]` is React's own name for the KIND: `throwOnHydrationMismatch` in
`react-dom@19.2.8` writes `fromText ? "text" : "HTML"`. So the two defects
are distinguishable from the error alone — this one is `text`, the shell's
is `HTML` — and a run that reports `HTML` was never reporting this.
