### Two whole bid packages looked broken, and the app knew why (Diego)
`diego/say-why-no-scale`

Four new plan sets arrived. **Two of them yield no scale on any sheet** — the
"Find the walls" button stays greyed out across the entire project, with no
offer, no explanation, and no hint of what to do.

## Why they decline

Their lettering is saved as **line work rather than characters**:

| | strokes | text items |
| --- | --- | --- |
| Alden Green House p11 | 117,456 | **0** |
| West Herr Jaguar p1 | 373,377 | **0** |
| West Herr Jaguar p12 | 173,087 | **0** |

No text layer means no dimension strings and no printed scale to read. It is the
limit CLAUDE.md already records for Colton, now met on two whole packages.

## The sheets are fine, and that is the point

Measured with a scale supplied by hand:

| sheet | walls found |
| --- | --- |
| West Herr p6 | **150** |
| West Herr p4 | **135** |
| West Herr p10 | **105** |
| Alden p7, p12 | 44 each |

The dimensions are still PRINTED — a person reads `24'-0"` perfectly well, it is
simply drawn as lines — so setting the scale the way everyone always has works,
and the wall finder then works too. **What is lost is the automatic scale, not
the takeoff.**

## The defect: the reason was stored and shown to nobody

`PlanSheetScaleReading.declineReason` has carried a sentence written for a person
since #655 — *"its lettering was saved as line work rather than characters, so
there is nothing here to read a scale from. Set it by hand."* — and nothing ever
rendered it. Same shape as the provenance bug in #664: written to the database,
reaching no one.

So the panel now says it, above the manual flow, **only when there is no prefill
to offer** — a sheet that produced a scale does not need to explain itself.

## Verification

- 5 tests on the derivation, including the two states that must not look alike:
  a sheet that **could not** be read says so, a sheet **not yet read** stays
  silent.
- **6 mutations, each red first time** — among them *the reason is never carried*
  (what shipped), *it is shown even when a scale WAS offered*, and *the prop is
  never passed down*, which is the wiring gap every one of these has had.
- One query, two derivations: the reason is already on the row that produces the
  prefill, so nothing is re-queried.
- Typecheck caught three fixtures missing the new field — the row type is
  required rather than optional for that reason.
- Four gates: **9,348 unit tests, 687 db tests**, typecheck, lint. No schema
  change — the column already existed.

## Click-list

1. Open a sheet from a set whose lettering is outlines — Alden Green House or
   West Herr Jaguar. *Expected: "C Stream couldn't read a scale here:" followed
   by the reason, where before there was nothing.*
2. Set the scale by hand: two clicks on a dimension you can read on the sheet,
   then type it. *Expected: it saves exactly as it always has.*
3. Press **Find the walls**. *Expected: it works — over a hundred runs on some of
   these sheets.*
4. Open a sheet that DID get a scale. *Expected: no message. It has nothing to
   apologise for.*
