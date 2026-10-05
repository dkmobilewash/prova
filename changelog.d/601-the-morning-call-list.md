### `/sales` did not answer the one question it exists to answer (Cyrus)
`cyrus/sales-signals`

The screen somebody works down each morning ordered leads by **creation date**, so a
§4104 import — which can add up to 60 leads in one go — buried the handful carrying a
GC, a job and a confirmed trade under dozens of thin ones. Those few are the only ones
worth ringing; the band that says so was computed and thrown away.

**`BAND_RANK` was dead, and that is measured rather than asserted.** Grep over the
whole repo before the change returned exactly one importer: `sales-qualification.test.ts`,
asserting only that four bands have four distinct ranks. The declaration's own comment
reads *"Sort order for a list of leads: the ones worth calling first"*, and it ordered
nothing on screen. The band was derived inside the JSX map and discarded after
rendering, so it could not have reached a sort. This repo's recurring
"written, documented, and never called" shape, in the module whose whole job is to say
who to call.

**The tiebreak is load-bearing, and the reason was measured on a real Postgres 16
rather than reasoned about.** `SalesLead.createdAt` defaults to `CURRENT_TIMESTAMP`,
which in Postgres is TRANSACTION START, and `importSubListing` writes every lead in one
`$transaction`. Three inserts 120 ms apart inside one transaction produced **one
distinct timestamp**. So all 60 rows of an import tie, `ORDER BY createdAt DESC` is not
a total order for exactly the case this screen is about, and two loads could already
have shown the same 60 leads in different orders. An `id` tiebreak settles it.

Creation order was kept as the within-band tiebreak over "most recent activity" for
three reasons: `lastContactOn` is null on every freshly imported lead, so a
contact-based tiebreak leaves 60 rows in no order at all — the defect, not the fix; the
page already has a follow-up queue ranking the same leads by recency, and a second
competing ranking is the "is there a second list" shape; and keeping it means the band
is the only thing this change moves.

Bands are cut by **adjacency in the sorted list**, never by walking `FIT_BANDS`, so
there is no second statement anywhere about which band outranks which — the heading
sequence comes only from the comparator and cannot drift from it. A heading is written
only for a band something is in.

**Where the sort lives, and the honest reason it is not on the server.** All three
candidate homes refuse a pure comparator: `lib/actions/sales.ts` is `"use server"`, so
every export must be an async function and exporting a sort would mint a POST endpoint
for it; a page cannot export a non-reserved name (Next's TS plugin errors
`INVALID_ENTRY_EXPORT`); and a function exported from a `"use client"` module becomes a
client reference the server cannot call. So it sits in the module that also renders the
headings — which has the compensating virtue that the order a person reads and the
order the headings claim cannot disagree. The right home is a new
`lib/sales-lead-order.ts`; nothing else changes if it moves there.

Sort cost measured: **0.044 ms at 60 rows**, 1.63 ms at 5,000, 7.25 ms at 20,000 —
against a post-action server render this repo measures at 1.5–4.4 s. Nothing was given
up, because the page never ordered in the database in a way that mattered: it has no
`take`, already materialises every lead with all its children, and already ran
`qualify()` per lead in memory. **The cost that does exist is future:** `/sales` can
now never be paginated or ordered in SQL without storing a band, and storing derived
state is forbidden here. At a few thousand leads the thing that will hurt is the
unbounded query, which predates this.

**The 60-row cap is NOT a silent truncation, checked across all four layers rather
than assumed:** the action RETURNS a refusal naming both numbers, there is no `slice`
on rows anywhere, the paste and the selection survive the refusal on screen, and
`unread`/`rowsSkipped` are both reported. One real gap left deliberately untouched:
nothing warns BEFORE submit that more than 60 lines are ticked, so you learn on submit.
That is a refusal rather than a drop, and the fix belongs in `SubListingImport.tsx`.

Nine mutations, no survivors, every total read before the colour. Two matter. **Making
the ordering a no-op reds 9 of 15 including BOTH render tests**, so the suite is
measuring the DOM rather than a mock — verified independently here. **Dropping the `id`
tiebreak reds exactly one test**, the import-tie case, and that test is the
distinguishing one: asserting a single expected sequence proves nothing because
`Array.sort` is stable and would satisfy it, so it feeds the same rows REVERSED and
requires the same output, which stability cannot produce.

A defect the agent's own test found in its own markup: `gap-2` separated a band label
from its count in pixels only, so `textContent` read "Call this one**1 lead**" — a
screen reader and any Playwright text locator would see the words run together. Fixed
with an explicit space, which costs nothing on screen.

`e2e/specs/sales-crm.spec.ts` was checked by REPLAYING its own locators against the new
markup, not by reading it: the `li` filter still resolves to exactly one, an exact-text
match for "Call this one" still returns 0 on the fixture (which is why only non-empty
bands get a heading, pinned by its own test), the Pipeline section filter still
resolves to one, and the lead link still resolves to one. CI's `e2e` job is the proof.

### Two CI failures this caused, and why the local checks could not see either

**`ci` went red twice on this work** — the first red `ci` on the branch — and both
were the harness rather than the feature. They are recorded because the second one
corrects how this repo's own typecheck advice was being applied.

**One: a comparator behind `"use client"`.** `lib/client-boundary.test.ts` refused
`compareForCalling`, `orderForCalling` and `groupForCalling` living in
`components/SalesLeadRow.tsx`: across the RSC boundary a non-component value from a
`"use client"` module arrives as a CLIENT-REFERENCE PROXY, not the function. Nothing
was broken at runtime, because the sort was only ever called from inside a client
component — the violation was that the values were REACHABLE, and a guard that waited
for somebody to actually call one would fire on the day a server component imported it
rather than the day it became possible. The census named the fix in its own failure
message and `lib/sales-lead-order.ts` is it.

**Two: `TS2307` IS NOT ONLY NOISE — IT IS A BLINDFOLD, and that is the lesson.** CI's
Typecheck failed on one error, `salesLeadOrder.test.ts(78,63): TS2769 No overload
matches this call` — a `next/link` mock typing `children?: unknown` where
`components/Sidebar.test.ts`, the file it was copied from, types it `ReactNode`.

The local typecheck could not have caught it, and not for want of filtering. This
container's `apps/web/node_modules` is empty (the `xlsx` tarball 403), so that file
emitted five `TS2307 Cannot find module 'react'` — which means `createElement` is typed
`any`, so the compiler never reaches the overload check and **TS2769 cannot be emitted
for that call at all**. Thirteen TS2769s DO appear elsewhere in the same run, in files
whose types resolve, which is what proves the checker was able to report that class and
was blinded for this one specifically.

CLAUDE.md's existing rule is to count the lines naming your file so an empty filter is
not read as a pass. That is necessary and it is not sufficient: **five lines naming the
file were all TS2307, and every one of them was a real type error that could no longer
be reported.** The honest reading of a `TS2307` on an import is "every inference
downstream of this import is now `any`, so this file is unchecked" — not "one more line
of cascade". Where a diff touches a file whose imports do not resolve here, CI's
Typecheck step is the only instrument, and a local zero means nothing about it.

**Three: the mocks belong in the test file, not in a config.** The five render tests
passed locally and failed in CI with `invariant expected app router to be mounted`,
because a scratchpad config aliased `next/link` and `next/navigation` to stubs and
`vitest.config.mts` has no such aliases. A harness more permissive than the real one
produces a green that says nothing. The mocks are in the file now, copied from
`Sidebar.test.ts`, and CI's Test step passes 584 of 584 with them.

The control that made the local diagnosis readable rather than a shrug:
`Sidebar.test.ts` — green in CI — fails in this container identically, on `next/image`
resolution. So the resolve failure is a property of the container, not of the change.
