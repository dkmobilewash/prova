### The #418 hydration mismatch: what it actually is, measured (Cyrus)
`cyrus/hydration-17`

DOCS-ONLY / AUDIT, flagged per the working agreement's 2026-09-07 exception.
No product code changes. It corrects two documented claims that were false
and were actively misdirecting anyone who read them, and records what four
instrumented CI runs established and eliminated.

The pilot journey's step 11 has been reporting a React #418 hydration
mismatch on a list of pages — fourteen in one run, seventeen in the next —
and both `e2e/lib/health.ts` and the assertion's own failure message said it
was "likely something rendered from 'now'", pointing at CLAUDE.md's Dates
bullet. That sentence is why this stayed open: three investigations went
looking at dates and timezones, and it cannot be a date.

The error says so itself. React's #418 carries its kind as its first
argument, and every occurrence in every run reads `args[]=HTML`. Read out of
the installed react-dom 19.2.8: `fromText` is true only for a text-node
mismatch, so `HTML` means an ELEMENT-level disagreement. A date formatted
differently is a text mismatch and produces a different message. And
Playwright sets no `timezoneId`, so in CI the server and the browser are
both UTC and every zone-derived value is identical on the two sides by
construction.

What it is instead, measured rather than argued. It is ONE defect in the
signed-in shell that fires on roughly one authenticated page load in three,
on no particular page. Two walks of the same 38 nav destinations in one
signed-in session named six pages and four pages with one in common;
reloading four pages ten times each gave 12 mismatches in 40 loads. The
list of URLs step 11 prints is therefore not a list of broken pages — it is
whichever pages lost the race that run.

The server's own HTML then confirmed it with no browser involved: on four
pages, counted straight out of the response, every one carries at least one
`<template id="B:n">` / `<div hidden id="S:n">` / `<!--$?-->` triple — a
shell Suspense boundary that suspended during server rendering and was
streamed out of order — and the biggest page carries two.

A MutationObserver installed before the page's first script caught what
React was doing in the same millisecond as one of them: a
`<div hidden id="S:0">` and a `<template id="B:0">` removed, the SIDEBAR
moved out of the hidden holder into the shell row, the `<!--$-->` marker
rewritten, then the same four for the TOP BAR. That is React's out-of-order
Suspense streaming being completed — which means a shell region's
`<Suspense>` SUSPENDED during server rendering, and `ShellRegion.tsx`'s own
docstring says "nothing here ever actually suspends". The fix has to keep
that file's error containment, so it is a change to discuss rather than a
patch to land; the diagnosis, the eliminations and the proposed direction
are in CLAUDE.md.

Also recorded, because each one is an afternoon nobody has to spend again:
`localToday` is eliminated (all eight non-client hits are comments, including
the one candidate, whose comment says it is deliberately not imported); the
`prova_tz` cookie is eliminated (the component renders nothing and computes
in an effect, and CI is UTC either way); invalid HTML nesting is eliminated
by a TypeScript-AST scan of 345 files and 460 components; and the public
e2e suite attaches no HealthMonitor, so its green says nothing about
hydration on public pages.
