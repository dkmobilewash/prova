### A measured quantity now says which pricing package it is in (Diego)
`diego/takeoff-packages`

A GC's bid form asks for a base number, then alternates it may or may not take.
The estimator measures all of it off the same sheets, and there was nowhere to
say which was which — `TakeoffMeasurement` carried one free-text `label`, so
forty traced runs for an alternate and four hundred for the base were one
undifferentiated list. **Posting them put every foot into the number sent to the
GC.**

A base bid carrying an alternate's quantities is high by exactly that alternate,
which loses the job with nothing on screen to say why.

#### NULL is the base, and that default is the whole safety argument

`TakeoffMeasurement.packageLabel` is nullable with no default and no backfill, so
every measurement traced before the column existed stays in the number — and
that is *correct* rather than merely preserved, because those quantities always
were the base bid.

The opposite default would bid **low**, and the two errors are not symmetric: a
high bid is lost work, a low bid is work won at a loss and then built. An
estimator who never thinks about this field gets the recoverable error.

Nullable-with-no-default is also what makes NULL mean something. `DEFAULT ''`
would make "nobody has thought about this" and "somebody decided this is base"
indistinguishable, and this app's rule is that those are different facts.

#### Posting refuses a mixed selection

Nearly every check in this product names a problem and lets the estimator
proceed — `bid-responsiveness.ts` says so of itself and `indirect-costs.ts`
refuses to nag. This one **refuses**, and the difference is what happens after
the press: a mixed post produces line items that are individually correct and
collectively a base bid with an alternate folded into it, and nothing on a
posted line says which package it came from, so it cannot be undone by looking.

A refusal costs one press. It is also cheap to satisfy, which is what makes it
fair: the packages are visible on every row beside the selection, and posting
twice is the correct action. The message names the packages rather than counting
them — "spans 2 packages" sends somebody hunting, naming them says what to do.

#### What this deliberately does NOT do

**It is not joined to `BidLine`.** That model already handles a bid's alternates
properly — signed amounts, three-state `accepted`, kept out of the base total —
and pointing at one is the obvious move. It cannot be done yet, for a structural
reason rather than a decision: `BidLine` hangs off `BidInvitation`, a
`TakeoffPlan` hangs off a `Job`, and the only link between them is
`BidInvitation.wonJobId`, which exists **after** the bid is won. Measuring
happens before, so while an estimator is tracing an alternate the job has no
reachable bid at all.

So the label is text, and **the estimate side is not keyed by package** — a
posted line names its package as a `[Add Alternate 1]` prefix on the
description, findable and movable by a person. Said plainly rather than
half-built. Joining the two wants the invitation reachable from the job before
award, which is its own piece of work.

Labels are matched exactly as typed, trimmed only of surrounding whitespace.
`bid-levelling.ts` made the same call for the same reason: a typo showing as two
headings gets fixed in a second, and two scopes silently merged into one is a
wrong number nobody can see.

#### Checks

- **Six mutations, every one red** — the first being the one that matters:
  stopping an untagged measurement from counting as base, which sends the bid
  low. Also an empty base group hidden rather than shown, a mixed selection let
  through, a noise prefix on every base line, and two whitespace-handling
  changes.
- The empty base group is asserted to still render: *"the base bid has no
  quantities on this sheet"* is a fact worth seeing, and an absent heading says
  nothing.
- 18 unit tests on the rules; 1,645 across takeoff and components.
- **The new input uses `bg-surface`, not `bg-surface-input` like its neighbour**
  — not a style choice. `surface-input` resolves to nothing on this near-black
  canvas (issue #573) and `colorTokenCensus.test.ts` pins the family at exactly
  39 uses so it fails when it GROWS. A fortieth would have redded CI.
- Preflight green. **One migration, additive — `ALTER TABLE … ADD COLUMN`,
  nullable, no backfill.**

#### Click-list

1. Open a calibrated sheet, trace a run, and leave **Pricing package** blank.
   Save. The row must show **no** package chip — blank is the base bid.
2. Trace a second run and type `Add Alternate 1`. Save. That row must show a
   blue `Add Alternate 1` chip.
3. Select **both** rows and press the button that adds them to the estimate. It
   must **refuse**, naming "Base bid" and "Add Alternate 1".
4. Select only the alternate and add it. Its estimate lines must read
   `[Add Alternate 1] …`.
5. Select only the base row and add it. Its lines must carry **no** prefix.

#### Clicked through on production, and what it found

Steps 1–5 all behaved, including the one that matters: selecting a base run and
an alternate together and pressing add returned, verbatim —

> This selection spans 2 pricing packages — Add Alternate 1, Base bid. Posting
> them together would put the alternates' quantities into the base bid, which
> sends it out high by exactly that much. Add one package at a time.

Posting the alternate alone produced four lines all prefixed
`[Add Alternate 1] `; posting the base alone produced four with no prefix.

**Three things the click-through found that are NOT this change**, recorded
because each cost somebody a question:

- **`tag-blue` is yellow.** `tailwind.config.ts` defines `"tag-blue": "#facc15"`
  — the brand yellow — with `tag-blue-ink` a dark brown. So the package chip
  renders yellow, as do the **39 other uses of that token across ten files**.
  The token is MISNAMED rather than broken: the pair is legible and
  `theme-contrast.test.ts` passes it, because that census checks a ground/ink
  pair's contrast and has no opinion on whether a name matches a hue. Left as
  it is here — one chip should not quietly diverge from thirty-nine others —
  and worth its own rename.
- **A deleted wall-schedule line comes back on reload.** Removing the posted
  lines and reloading restored one. That is `refreshWallSchedule` doing its job:
  a `WallRun` owns its lines and re-syncs them, so a line cannot be deleted
  while its run exists. Correct, and it reads as a bug.
- **A measurement still says "already on the estimate" after its lines are
  deleted.** `postedAt` records that it WAS posted and nothing clears it. Also
  defensible, also confusing.
