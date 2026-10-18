### Fix round 3: crew picker, phone near misses, one word for a bill, backcharge deadlines on Home, a bid's Contract step, moving a scheduled day (Cyrus)
`cyrus/fix-round3`

Six small things a walkthrough found, each with a test that fails without
its fix (mutation-checked).

- **/schedule "Put someone on".** "Who (pick one or more)" and the saved-crew
  picker's "Crew (ticks its people)" sat stacked with no gap and read as one
  heading. The picker is now one inline line, "Fill from a saved crew",
  with its own spacing between the legend and the people list.
- **Near misses from the phone.** The web form could file a near miss (on
  the log, no OSHA case number); the phone could not — its chips stopped at
  First aid only, and the incidents API route refused `NEAR_MISS` as "not a
  valid value" and bumped the case counter unconditionally. The route now
  accepts it and burns no case number (the DB's CHECK already requires
  `caseNumber IS NULL` exactly for near misses); the phone has a NEAR MISS
  chip at the same 48pt target as the others.
- **Receivables say "Pay app" where Home does.** The rows and drawer said
  "Invoice 3" under a Money card saying "Pay app". The provider takes
  `filesMonthlyPayApps` and every label reads `billingNoun`. Labels only.
- **Backcharges on "Needs you today".** A backcharge we have not answered,
  past its objection deadline (red) or within 14 days of it (amber), now
  shows on Home, billing-gated like its alert, linking to its own row
  (`/backcharges#<id>`; the row carries the id). The deadline is
  `daysToRespond` from `lib/backcharges.ts`, called, not re-derived.
- **A bid's Contract step** opens the Overview at its Contract signature
  section instead of plain Overview. `isCurrentLink` now ignores a
  `#fragment`, so the nav still knows the Overview belongs to Contract; the
  rail-parity test compares paths without the fragment, with a comment why.
- **Moving a scheduled day** is one inline "Move" on the two-week list
  (date and/or job), one `moveCrewDay` ActionResult action: company scope
  re-checked on the row and the target job, the same person already on
  that job that day refused in words, another job the same day saved and
  reported as double-booked — same rules as the add path. Excluded from Ask
  like `unscheduleCrewDay`.
