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
`<AfterMount>`; `/sign-in` and `/sign-up` are named exemptions, because there
Clerk's card IS the page, it is outside the signed-in shell, and `e2e-public`
walks both at 320, 375 and 1280 — and each exemption is asserted to still exist
and still render a Clerk card, so an allowlist cannot outlive what it exempts.
The census counts the files it parsed against a second expression sharing no
regex with the first, derives its roots from `content` rather than its own
directory, and strips comments before every structural read — which is
load-bearing rather than tidy, since `AfterMount.tsx` and `Topbar.tsx` both
print `<UserButton />` in their own headers. Mutation-tested five ways, each
red naming the offender: gate removed, gate present only in a comment, the
import pattern drifted (red on the COUNT — "the sources contain 4 files and
this census parsed 0"), a new Clerk widget added, and a `content` glob pointed
at a directory that does not exist.
