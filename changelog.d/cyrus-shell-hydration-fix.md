### The sidebar and top bar stop re-rendering a beat after the page (Cyrus)
`cyrus/shell-hydration-fix`

On roughly one signed-in page load in three the rail and the top bar appeared,
then redrew themselves a moment later. Underneath that was a React hydration
mismatch (#418) — the server's HTML and the browser's first render disagreeing
about an element — and the pilot journey's step 11 had been reporting it for
weeks on a different list of pages every run. Fourteen URLs in one run,
seventeen in the next, six in common.

**It was never a date, and it was never the pages it named.** Both the e2e
health monitor's own comment and step 11's failure message said it was "likely
something rendered from 'now'" and pointed at CLAUDE.md's Dates bullet. That
sentence sent three separate investigations at timezones. React's #418 carries
its kind as its first argument and every occurrence read `HTML`, not `text` —
an element-level disagreement, which a differently formatted date cannot
produce. Both comments are corrected here (PR #501 found this; its findings are
folded into this PR and it can be closed).

**What was actually wrong — two things, both in the signed-in shell.**

The first: the `(app)` layout is a server component and `<ShellRegion>` is a
client one, so writing `<ShellRegion region="sidebar"><Sidebar …/></ShellRegion>`
made `<Sidebar>` an element that had to cross the server/browser boundary.
React's production serializer defers any element it reaches past 3,200 bytes
and the browser turns that into a lazy placeholder — the same trap that took
every signed-in page down on 2026-09-21, from the other side. Each region is
now paired with its widget inside `components/AppChrome.tsx`, a browser
module, so the element is created where it is rendered and never crosses
anything. The layout mounts five `…Region` components and nothing else.

The second: Clerk's `<UserButton>` only renders when `clerk.loaded` is true —
a flag it reads while rendering, and one that is false on the server *always*.
So the server writes no avatar on any signed-in page, and if Clerk's script
loads before the browser hydrates, the browser's first render puts an element
where the server's HTML has none. It now waits for mount
(`components/AfterMount.tsx`). That cannot change what anyone sees, because
the server already rendered nothing there — it can only remove the
disagreement.

**And one thing that looks exactly like the bug and is not, recorded so the
next person does not lose a day to it.** Every authenticated page ships a
`<template id="B:…">` / `<div hidden id="S:…">` pair, and a MutationObserver
catches the sidebar being lifted out of that hidden div into the shell row.
That reads as a Suspense boundary having stalled. It has not: React streams a
boundary separately when it is merely BIG — over 12,800 bytes — having never
stalled at all, and the sidebar's markup measures 13,442. Proved by building
the shell at a public route on a local production build and counting the
markers before and after the first fix: three either way, byte-identical, while
the underlying payload changed completely. There is no app-level lever on it
and it is not the mismatch.

**The check.** `components/shellRegion.test.ts`'s fourth assertion now spans
two files instead of one and asserts more than it did: `AppChrome.tsx` wraps
every widget it imports in a region; the layout may import nothing from
`@/components/` but those region components and the failure fallback; every
region is rendered self-closing and takes no `children` at all, so the page
cannot end up inside one; and the layout may never write `<ShellRegion>`
itself, which is the new property and the fix. Every structural check runs on
the source with comments stripped, because both files print the wrong shape in
their own documentation. Mutation-tested four ways — MetricBar rendered bare in
the layout, the old pairing put back, a region given a `children` prop, and a
widget rendered outside its region in `AppChrome.tsx` — each red with the
offending name in the message, then green again. The 2026-09-21 property is
untouched: every region still has its own boundary, and that file's own
controls still prove a throwing widget cannot take the page down.

`components/afterMount.test.ts` asserts the mount gate renders nothing on the
server and its children afterwards, each half with a control.

**What the number did, and it is not zero.** Step 11 of the pilot journey prints
every URL a mismatch fired on, and on `main` it prints fourteen to nineteen, a
different list each run. With the region fix alone it printed **six**
(/dashboard, /messages, /proposals, /submittals and two job tabs); with the
Clerk gate as well it prints **one** — `/jobs/<id>/crew`. CI runs 36176373400
and 36176953068, head SHAs matching the pushed commits, 36 of 37 specs passing
in each.

That last one is left open deliberately rather than declared fixed.

**And the sentence that used to follow was wrong, so it is corrected here
rather than shipped.** It read: every symptom before this was on many pages at
once, which is what made it the shell; a single page is something on that page,
so start with the crew tab. The run before — region fix only — listed SIX pages
and crew was not one of them. Both runs walk every job tab, so a defect living
on the crew tab would be in both lists. It is in one. What is left is a residual
RACE at a rate low enough to land on one page in roughly forty loads, and which
page it lands on carries no information — the same thing this change says about
a list of seventeen, said about a list of one, where it is much harder to see.

**Settled by the next run rather than by that argument.** CI 36194376856, head
`062bcd7f` (this branch merged with `main`, so #493 is in): step 11 printed
THREE entries — `/dashboard`, `/pipeline`, `/material-orders` — and none of
them was the crew tab. `verdicts: collected 63, returned 63`, 62 of 63 specs
passing, step 11 the only failure. Three runs, three disjoint lists, only
`/dashboard` recurring. The list is the dice, not a location.

The crew tab has now been read anyway, so nobody re-reads it: its five unique
components read no clock, window, storage or mutable singleton in render
position and none nests a `<form>` on a first render, and the app-wide scan of
`useState`/`useMemo`/`useSyncExternalStore` initialisers finds exactly one
browser read in the whole codebase — `useMedia` in `WalkthroughTour.tsx` —
which nothing server-renders. Both are in CLAUDE.md's ELIMINATED list with the
evidence.

**The guard the second fix did not have.** `components/afterMount.test.ts`
proves the gate works and asserts nothing about anybody using it: delete the
two lines in `Topbar.tsx` that wrap `<UserButton>` and every test in this app
still passes while every signed-in page goes back to racing — the "written,
documented, and never called" shape wearing a hydration fix.
`components/clerkMountGate.test.ts` closes it. Every Clerk UI component
rendered anywhere Tailwind's `content` globs reach must sit inside
`<AfterMount>`; `/sign-in` and `/sign-up` are named exemptions, each asserted
to still exist and still render a Clerk card so an allowlist cannot outlive
what it exempts. The reason for the exemption is NOT that `e2e-public` walks
both pages and is green — that job calls `expectHealthy` without a monitor and
so never reads `pageerror` at all, and citing it would have put a vacuous green
inside a guard written to end vacuous greens. It is that gating those two
blanks the app's front door for a frame, and Clerk hands `SignIn`/`SignUp` a
`fallback` prop with `renderWhileLoading: true` so the waiting state is
something it draws. `SignIn` and `SignUp` do carry the same `clerk.loaded &&`
branch as `UserButton`, so that race exists there in principle; the only
evidence against it is that the journey's monitor is attached before
`signInAs` and no run has named `/sign-in`, which is weak and is said to be.
The census counts the files it parsed against a second expression sharing no
regex with the first, derives its roots from `content` rather than its own
directory, and strips comments before every structural read — which is
load-bearing rather than tidy, since `AfterMount.tsx` and `Topbar.tsx` both
print `<UserButton />` in their own headers. It also requires every Clerk import statement
to yield a component name, so a default or namespace import fails instead of
parsing to nothing. Mutation-tested six ways, each red naming the offender:
gate removed, gate present only in a comment, the import pattern drifted (red
on the COUNT — "the sources contain 4 files and this census parsed 0"), a new
Clerk widget added, a `content` glob pointed at a directory that does not
exist, and `<UserButton>` reached through a namespace import.

## The outlined-boundary hypothesis was the best one left, and it is refuted

With Clerk's `<UserButton>` gated, the surviving explanation for step 11 was the
sidebar region's own `<Suspense>`: React outlines it on every authenticated page
(13,442 bytes against a 12,800 `progressiveChunkSize`), so there is a window
between the bootstrap script and that region's `$RC` in which the boundary is
`<!--$?-->`. Measured in the served document the window is real and 13.3 KB
wide — bundle scripts at byte 510, bootstrap at 32,322, the sidebar's `$RC` at
45,671.

The consequence is what is false. Driven in real Chromium against the real
production bundles:

| arm | hydrated | rail rendered | #418 | other |
| --- | --- | --- | --- | --- |
| the document exactly as served | 40/40 | 40/40 | **0** | none |
| every `$RC(...)` replaced by `void 0` | 12/12 | 12/12 | **0** | **#419, every load** |

React answers a pending boundary with **#419** — "the server could not finish
this Suspense boundary… switched to client rendering" — and does the switch: it
rendered the rail itself on every load and cleared the markers. `health.ts`
matches `#(418|423|425)`, so a #419 is a CRASH in this suite's terms, and
`expectHealthy` asserts `monitor.crashes` is empty after every navigation. That
assertion has never failed. The mechanism is not just wrong about the number; it
has never occurred in the journey.

**How it was driven, because `next start` + `page.goto` cannot work in an agent
container.** Chromium there cannot reach loopback — every navigation is
`ERR_TUNNEL_CONNECTION_FAILED`, and Playwright re-forces it with
`--proxy-bypass-list=<-loopback>` even against `no_proxy`. The way that works
needs no network: capture the document once with `curl --noproxy '*'`, then
fulfil it and every `/_next/**` asset from disk with `page.route()`.

**Two harness failures are recorded, because each gave a confident wrong answer
first and each was caught only by its own control.** Hand-writing the boundary
HTML mismatched in all four arms including the completed control. Truncating the
document before the first hidden content div gave `hydratedLoads: 0`, because the
cut takes the tail of the Flight payload with it. A control that fails is an
instruction to fix the harness, not a result.

**Where this leaves it.** The shell alone, replayed from one captured document,
is clean over 40 loads with hydration and the rail both proved present — p≈0.04
against the journey's own rate, so evidence rather than proof, and bounded:
replaying one document removes every bit of server-side stream-timing variance.
Read with the page lists (`/dashboard`, `/pipeline`, `/material-orders`,
`/messages`, `/proposals`, `/submittals`, two job tabs) the weight has moved off
the chrome and onto the page bodies' own client components. Step 11 stays a hard
assertion and stays red until somebody gets there.
