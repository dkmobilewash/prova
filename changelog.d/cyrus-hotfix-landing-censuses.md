### `main` went red on a merge where every PR was green (Cyrus)
`cyrus/hotfix-landing-censuses`

Ten PRs merged in one batch on 2026-09-21. Every one of them was green on
its own base, GitHub reported every one MERGEABLE, and the tenth — #404,
the landing-page rebuild — turned `main` red. Four failures, none of them
present in any PR anybody read.

**All four are the same shape: #404 branched before the guards that judge
it existed.** It was written against a `main` that had no
`hoursRenderCensus`, no `pageWidthCensus` entry for its own file, and a
`PayAppSummaryInput` that still took a `retainagePercent`. Those three
things arrived in #409, #416 and #430 — in the same batch, ahead of it —
and a textual merge cannot see any of it. This is the semantic half of the
"green checks do not mean CI ran on your commit" scar: here CI *did* run,
on a commit whose base no longer existed by the time it landed.

What was actually wrong, in order of how much it would have cost:

**The marketing page was printing the bug it was built to advertise.**
`panelChrome.tsx` carried a FOURTH copy of the hours arithmetic —
`String(Number(h.toFixed(2)))` — and `ApprenticeRatioPanel` rendered four
hours values with no formatter at all. `lib/render-hours.ts` exists
precisely because a floating-point sum of `Decimal(5,2)` columns reaches
the screen as `35.300000000000004`, and the certified-payroll page printed
exactly that. The landing panels run the product's real functions on
purpose; rounding hours was the one place they quietly stopped, so a
prospect reading the apprentice-ratio panel could have been shown the
defect as a feature. Both now call `formatHours`/`formatHoursOrNull`.

**A rate back within reach of the retainage calculation.**
`PayApplicationPanel` passed `retainagePercent` to `calculatePayAppSummary`,
which #409 had deliberately removed — its comment there is worth reading:
`Invoice.retainageWithheld` is a snapshot taken at the rate in force that
period, and a rate sitting in that function's input is an invitation to
derive the figure live and silently restate certificates already sent to a
GC. The panel keeps the rate only for its own stand-in `withheld()`.

**One census entry that had already been satisfied.** #404 converted
`app/page.tsx` to `PageShell` — which is what `pageWidthCensus` wanted —
but left it on `UNCONVERTED_PAGES`, and that list is asserted to shrink,
never to hold a page that no longer belongs on it. Entry deleted, count
52 → 51. Its comment block said in as many words that the page was "being
rewritten in #404 as this landed", so the census author saw this coming and
the only thing missing was somebody reading it on the way in.

**No mutation test was written for any of this, and none is needed**, which
is worth stating rather than quietly skipping: `main` at `801b7a0d` IS the
mutant. Both censuses were red on it and name the exact files, which is
stronger evidence than a mutation anybody could author here.

**The process failure is mine and it is about merge ORDER, not review.**
Each PR was judged against the tree it was written on, and ten of them
rewrote that tree underneath each other. A batch merge needs the last PR
re-checked against the tree the first nine produced; nothing in this repo
does that today, and "every check was green" is exactly what it looks like
when nothing does.
