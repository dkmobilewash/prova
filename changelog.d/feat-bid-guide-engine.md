### C Stream Bid now has an engine that decides the one thing a job needs from you (Cyrus)
`feat/bid-guide-engine`

The redesigned Bid shows every job as a five-step rail and ONE card. This is the part that
decides what the card says, with no screen attached yet. `buildJobGuide(facts, now)` is a pure
function: facts in, the five steps and the single ask out, every sentence assembled from the
facts so it cannot state a figure the facts do not hold and works with AI switched off.
`loadJobGuideFacts` and `loadOpenJobGuideFacts` read the facts company-scoped (null for another
company's job; a fixed handful of queries however many jobs the home list holds).

The ask is the earliest missing step: no drawings, floor-plan sheets with no scale, walls not
measured, walls not in the estimate, a wall type with no price, other unpriced lines, a recap that
was never applied, then the proposal, which becomes "send it" inside 48 hours of the deadline.

**What the schema cannot say, and the guide does not pretend to.** Nothing records that a proposal
was generated or opened: it is a print-styled page and the bid package is merged in the browser and
stores nothing. The only "sent" there is, is `BidInvitation.status` going to SUBMITTED (WON and
LOST are past it; DECLINED sent nothing). So a priced bid is always "proposal ready" until an
invitation says SUBMITTED. A sheet's scale counts only when a person has calibrated it, not when
the app pre-filled one, and only floor-plan sheets (the newest title-block reading says PLAN) are
asked about, so a finished bid is not nagged over cover sheets.

**Checks.** 52 unit tests (one fixture per ask, the priority order, the rail, the deadline window,
every href under `/bid`, every figure in every sentence traced to the facts) and 12 against a real
Postgres 16. Three priority rules were mutated and each turned a test red.
