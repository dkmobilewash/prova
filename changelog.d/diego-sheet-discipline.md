### A third of the walls it reported were on the wrong sheet (Diego)

`diego/sheet-discipline`

Scored against a 60-page answer key with measured totals — the first time any
number this feature produces could be checked rather than compared to another
number it produced:

| | |
| --- | --- |
| recall on the floor plans (22 pages) | **72.6%** — 30,690 of 42,281 true feet |
| pages that should have found nothing (21) | **10 invented 13,767 ft** |
| pages that should have refused a scale (17) | 5 offered one anyway |

**A third of everything reported was not a wall**, and every phantom page was a
mechanical plan, a reflected ceiling plan or an elevation:

| sheet | invented |
| --- | --- |
| M-101 mechanical ×4 | 6,466 ft |
| A-111 reflected ceiling ×4 | 5,875 ft |
| A-201 elevations ×2 | 1,426 ft |

**The finder was not wrong about the lines.** An M-101 carries the architectural
walls repeated in grey under the ductwork, and an A-111 does the same under the
ceiling grid. Those are real walls — and the same walls the A-101 already
carries, so counting them bids the job twice. No amount of better geometry fixes
that, because nothing in the wall finder knew what kind of drawing it was
looking at.

**The answer was already in the database.** `PlanSheetProposal.proposedPageType`
has held COVER / PLAN / ELEVATION / SECTION / DETAIL / SCHEDULE since the ingest
was built, and its schema comment says why it exists: *"'which pages are the
schedules?' is the question the takeoff side needs answered"*. The takeoff side
never asked. It asks now.

Found walls on such a sheet now arrive with the reason, named: *"M-101 is a
mechanical plan. What was found here is probably the architectural walls
repeated in grey under the ductwork — and where it is real wall, it is the same
wall the architectural plan already carries. Adding it would bid those walls
twice."*

**A caution and not a refusal**, deliberately. A wall can genuinely be measured
on a section, and a sheet number read by a model can be wrong — disabling the
tool would remove a capability on a guess and leave a reader unable to tell "no
walls here" from "the app decided for me". Nothing is blocked; the sentence
arrives at the moment somebody is deciding whether to accept.

The title is read before the sheet number, which matters more than it sounds:
every one of these sheets says PLAN. A REFLECTED CEILING PLAN and a MECHANICAL
PLAN are both plans, and matching the generic word first would clear the entire
set. An office that numbers its ceiling plans in the A-series still writes
REFLECTED CEILING PLAN on them, so the title overrules the number.

Missing evidence means plan. A sheet nobody has numbered, with no title and a
proposal older than the prompt that added `pageType`, has given no reason to
doubt it — and a warning nobody can act on is noise.

What this does NOT do is improve recall. 72.6% is unchanged; this is entirely
about the other third. The caution was also first given `bg-surface-input`,
which resolves to nothing (issue #573) — `colorTokenCensus` pins that token's 39
sites and failed the build on the 40th, so it now uses the defined
`tag-amber`/`tag-amber-ink` pair that is actually a caution.
