### The import chain driven end to end in a browser for the first time

Every LINK in the listing importer was measured and the CHAIN never was. `parse.ts`
had its unit suite plus a 6,000-document generated corpus, `leadMatch.ts` an
exhaustive 6,561-pair sweep, `importSubListing` 54 tests against a real Postgres up
to the 60-row cap, and `SubListingImport.tsx` 74 checks in real Chromium — **with
the Server Action stubbed.** Nothing had ever driven browser → action → Postgres →
revalidated page. That is the 2026-09-21 shape this e2e suite exists for: four green
checks and 5,800 green unit tests while creating one invoice crashed every
authenticated page.

`specs/sales-crm.spec.ts` step 4 opened the import surface and submitted nothing, and
its comment gave the reason — the parser was "under active change in the other lane".
`seedDatabase.ts` said the same in the same words. **Both sentences were true when
written and had become the thing stopping anybody clicking the one path through the
feature.** Corrected in place rather than deleted, in both files, because "this is
unclicked for a good reason" is exactly the sentence that gets inherited.

Steps 8 and 9 now paste a real listing and import it, then paste the same document
again. Appended at the END rather than at step 4: importing creates leads, and steps
2, 3 and 7 count rows on `/sales`.

What each one is pinned on, since the list of what was already verified reads as
coverage:

- the three company names asserted ABSENT from `/sales` first;
- the submit button naming **three** of the four rows read, because the electrical
  sub is not one of Prova's trades — and that row asserted PRESENT on the review
  screen and ABSENT from the leads afterwards, so the exclusion discriminates rather
  than merely holding;
- the summary sentence, written from the action's own return value, so it cannot
  appear without a round trip;
- a claim read off the created lead carrying `(line 11 of the listing)` — a line
  number is not a string the screen could compose without having read that row;
- five signals PROPOSED and none confirmed, so an imported lead is as thin as a lead
  nobody researched;
- and on the second paste, `0 new leads` **and** `3 you already had` — mutually
  exclusive failures, so no single bug produces both halves — plus one row per name,
  which is the duplicate-lead defect this branch opened with, proved in a browser
  rather than only against Postgres.

Every literal lives in `e2e/lib/salesFixture.ts` and is re-derived from the app's own
`parseSubListing`, `shouldInclude` and `signalsForSub` by `salesFixture.test.ts` on
every push. So a parser change that moves a sentence fails in CI's three-minute job
naming the fixture, not twenty minutes later naming a missing string. Ten mutations
of those literals, ten killed, each naming exactly one case.

What that unit gate deliberately does NOT copy: the two summary sentences are composed
in the component, and re-spelling the template there would be a second copy of a
sentence that could pass while the component said something else. It gates the DIGITS
and says so; the wording is the browser's to prove.

`salesCoverage.test.ts` gains the case that would have caught the gap: some spec must
fill the listing textarea and wait on a Server Action. Its own docstring states what a
census cannot see — that the import worked.

Every name, licence and registration in the fixture is invented, on a `ZZ-E2E` tag:
imported leads are permanently undeletable by design, so a real firm pasted here would
be a real firm nobody can remove.
