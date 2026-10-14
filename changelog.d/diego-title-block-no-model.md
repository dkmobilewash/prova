### The sheet filter no longer needs a model to know what sheet it is on

`sheetSuitability.ts` decides whether a wall takeoff belongs on a page — it is
what keeps 13,767 invented feet off a mechanical plan. Its signature is

```
sheetSuitability(sheetNumber, title, pageType)
```

and it works off the first two alone; its own header says the third is the
weakest (*"an office that numbers its ceiling plans A-101 still writes REFLECTED
CEILING PLAN on them"*). But both of the inputs it actually uses came from
`titleBlock.ts`, the ingest stage that **pays a model** to read a title block. So
the sheet filter could not run until somebody had been billed.

`titleBlockText()` reads those two fields deterministically, free and offline.

### The rule, measured before it was written

**The sheet number is the largest piece of text in the bottom-right corner.**
Two cheaper rules were tried on real drawings first and both failed:

| rule | how it failed |
| --- | --- |
| pattern-match the page for `A-101` | West Herr's A-101 sheet carries `A1`, `A3`, `A5`, `A-301`, `A-302` as detail references across the drawing — **14 candidates on one page** |
| take the largest such match on the page | Naples prints room tags `A100`–`A108` at 12.5pt in the middle of the plan. The real number is **`M011A`**, which a `LETTER-DIGITS` pattern rejects outright for its trailing letter |

Inside the title block there is no competition. Measured on three offices with
three layouts and three numbering conventions:

| set | number | its height | next largest in that corner |
| --- | --- | --- | --- |
| West Herr | `A-101`, `A-604` | 38.7 | 25.8 (the job number) |
| Naples | `M011A`, `FP201A` | 88.0 | 24.9 (the sheet title) |
| Augusta | `A5.11`, `M1.12` | 50.5 | 25.0 (`PERMIT SET`) |

**And the obvious follow-on rule is false.** "The title is the second-largest
tier" fails on Augusta, whose sheet title is set at 19pt *below* a 25pt issue
stamp. So no tier is the title; what is safe is the whole corner's text, because
the suitability rules are unanchored substring tests and the corner holds the
sheet's own name. Handing them the **whole page** is not safe, and that is
measured too: a floor plan carrying "SEE REFLECTED CEILING PLAN" as a note
classifies as a ceiling plan, and across 218 pages the whole-page reading
disagreed with the sheet-number reading on **163 of them** — in the direction
that flatters coverage.

### What it was built to answer, and the answer

Of the 91 real pages that get no automatic scale, how many are sheets an
estimator would take a wall off? Crossed over 218 pages of four real bid sets:

- **42** declined pages classify as "floor plan" — but **27 of those are
  `(no number)`**, where the reader found nothing and `sheetSuitability` falls
  through to PLAN by design (*"missing evidence means PLAN — the caution has to
  be earned"*). That is a default, not a finding.
- Of the 15 that **do** carry a number, every one is a general, detail or
  schedule series: `G0.01`, `G1.14`, `A-001`–`A-004`, `A-603`, `A-604`, `A6.21`,
  `SE-7.01`.
- **Not one floor-plan-series sheet (`A-1xx`) declined.**

So the evidence points to automatic scale already covering the sheets that
matter, and the headline 49% being dominated by sheets nobody takes off.

**The bound, stated rather than buried: a sheet number was read on 149 of 218
pages (69%).** The 31% it misses is exactly why this is evidence and not proof,
and closing it is the next measurement rather than a conclusion to assume.

### Verified

Preflight's four gates green, 701 test files, no production schema touched. The
fixtures are the three real layouts rebuilt from measurements — sheet numbers and
generic sheet names only, never a customer's project text.

One test expectation was wrong and the code was right: Naples `M011A` reports
"demolition plan", not "mechanical plan", because the corner reads FIRST FLOOR
DEMOLITION PLAN … MECHANICAL and titles are checked before numbers. Both are true
of the sheet and the takeoff decision is identical, so the case now asserts
`likelyDuplicate` first and the label second.
