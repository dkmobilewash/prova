### Nine defects in labour, prevailing wage and union fringe — all on signed forms (Diego)
`diego/labour-wage-fringe-defects-104`

Issue #104, severity MONEY-WRONG. Seven of the nine reproduced against
current `main` and are fixed here; two had already been fixed by earlier,
unrelated work and are recorded as audits with a regression test each so
the claim stays checkable rather than re-trusted.

**Fixed:**

- **A local whose hours are all unpriced printed "$0.00" owed**
  (`/union-compliance`). `isWhollyUnpriced` already guarded every craft
  row so none of them printed a false zero — that guard is itself
  documented as a fix for this exact defect, at the row level only. The
  local's own header total was still rendered unconditionally, so a
  wholly-unpriced local showed a confident $0.00 above a table of dashes.
  Same check, one level up: the header now reads "— not yet priced".
- **The fringe-rate lookup could return a different schedule on two page
  loads of the same date.** `FringeRateSchedule_no_overlapping_rates`
  (a Postgres exclusion constraint) permits a schedule to end the SAME
  day its replacement begins — verified directly against a real exclusion
  constraint, both the same-day and the app's own next-day convention
  insert cleanly. The lookup's inclusive-both-ends comparison matched
  BOTH schedules on that shared day, and `.find()` returned whichever the
  caller's array happened to list first. Fixed by making the tie
  deterministic (latest `effectiveFrom` wins) regardless of fetch order —
  not by switching to the database's literal exclusive-upper semantics,
  which would have silently turned every schedule using this app's own
  next-day convention into one unpriced day at each changeover. Judgment
  call, argued out in `lib/labor-cost.ts`'s own comment.
- **A wage schedule stopped pricing at midnight on its own last day**
  while the setup screen's own badge still called it "in force" for the
  whole day. The lookup compared full `Date` timestamps; `effectiveFrom`/
  `effectiveTo` are always UTC midnight but `laborRateDateFor(job, new
  Date())` passes a bare "now" carrying the real hour of day when a job
  has no start date. Fixed by comparing calendar days, not timestamps —
  same fix as the point above, same function.
- **`findEffectiveRuleSet` was documented, unit-tested five times over,
  and called from nowhere.** `reviewJobWeek` trusted a wage determination's
  `ruleSetId` FK directly — a snapshot pointed at whatever rule set is
  CURRENT. When a jurisdiction's overtime threshold changes, the company
  records a new dated `PrevailingWageRuleSet` and repoints the FK, and
  every review of a week from before that change silently started
  checking it against the new threshold. Now reads every rule set on
  record for the determination's jurisdiction and lets
  `findEffectiveRuleSet` pick the one actually in force that week.
- **`filingFrequency` was entered, stored and displayed, and read by
  nothing.** A monthly filer got roughly four "past the filing window"
  alerts a month, one per week. The alert now groups uncovered weeks into
  filing periods (weekly unchanged; monthly and semi-monthly by calendar
  month/half-month) and raises one alert per unfiled period. Biweekly is
  flagged as a judgment call in the code — nothing in this schema records
  which Monday an employer's own cycle anchors to.
- **The certified-payroll alert and the certified-payroll sheet described
  two different seven-day spans.** The alert grouped by
  `fieldReportWeeks`' Monday-start week; the actual filing
  (`lib/certified-payroll-week.ts`) has always run Sunday-to-Saturday by
  deliberate, documented choice. The alert now groups by the filing's own
  week instead of the other way around — moving the filing would silently
  reshape every week already on a signed sheet.
- **Apprentice OJT hours accrued past the indenture's own end, and across
  crafts.** The window had no upper bound at `completedOn`/`cancelledOn`
  and no craft filter, so a completed indenture kept accruing hours for as
  long as "today" kept moving, and a second enrollment for the same
  apprentice in a different craft pulled in hours that belonged to the
  first one. Both fixed together — capped at completion/cancellation,
  scoped to the enrollment's own craft when one is recorded.

**Audited, not fixed — already true on `main`:**

- **Fringe components rounded before summing.** The issue's own repro
  (four ~$24.14 components summing to a $96.57 total instead of the
  printed $96.56) does not reproduce: `#197` (2026-09-07, after this issue
  was filed) reworked the module to round every component before any
  total is computed at any level, and reconciliation is asserted by a
  dedicated helper. Added a regression test with the issue's exact
  numbers; mutation-tested by reverting the summing order and confirming
  it fails.
- **`FringeRateSchedule` had no exclusion constraint against overlapping
  rates.** It does — `FringeRateSchedule_no_overlapping_rates`, added
  2026-08-24, the same migration that introduced the model. Confirmed
  live against a real Postgres 16 database (`\d "FringeRateSchedule"`),
  and already covered by a dbtest (`unionCompliance.dbtest.ts`) that
  records a rate and asserts a second overlapping one is refused in
  words. No migration in this PR.

Every fix is unit- or dbtest-covered and mutation-tested by hand: revert,
confirm the issue's own scenario reproduces, restore, confirm green.
