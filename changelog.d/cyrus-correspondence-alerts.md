### Nothing chased an unanswered RFI, and the machinery to do it was already built (Cyrus)
`cyrus/correspondence-alerts`

**What was wrong.** `AlertKind` had ten kinds and not one of them was
correspondence. So the 13:00 digest would email somebody about a bond
expiring in six weeks and say nothing at all about an RFI the GC had been
sitting on for nine days — the one piece of paper on this list that stops
a crew. `markRfiSent` stamped a date and a status and that was the end of
it: nothing read those dates back. The only thing anywhere in the app that
noticed was the money rail's "Proving" count, which is `rfi.count({ status:
"SENT" })` — a number with no calendar in it, that never leaves the browser,
and that says the same thing on day one as on day ninety.

**Why it was never caught.** Nothing was broken. Every date the chase needs
was already on the records — `Rfi.sentOn`/`dueBy`, `SubmittalRevision.dueBack`,
`DrawingRevision.receivedOn` — and every screen that renders them is correct.
The gap was between two features that each worked: the records knew, the
notifier could send, and no line of code connected them. That is this repo's
"written, documented, and never called" shape from the other end — not dead
code, but live code nobody wired to the thing that would have used it.

**What changed.** Three kinds through the EXISTING engine, and nothing else:
`RFI_UNANSWERED`, `SUBMITTAL_OVERDUE`, `DRAWING_REVISION_UNRECEIVED`. No
model, no column, no migration — alerts are derived on every render and these
are three more pure functions in `lib/alerts.ts` plus three more queries in
`lib/alerts-query.ts`. No sending was built: `noticesDue` consumes whatever
the alert list returns, so the digest picked all three up for free.

None of the three decides what state a record is in. `rfiLabels.isOpen`,
`submittalLabels.submittalState` and `drawingLabels.unreceivedRevisions`
already answer that for the pages and the money rail, and a second copy in
the alert engine is exactly how two screens end up describing one package
differently.

**DATED or STANDING, decided per branch and not per kind.** The existing
kinds split on whether a real deadline exists that somebody can still meet,
so these follow that rather than inventing a third rule:

- An RFI or a submittal WITH a recorded response date is DATED. That is a
  contract term; it climbs DUE_SOON → OVERDUE and the digest's rungs walk it
  up. Both horizons are 7, the floor `notification-milestones.ts` imposes —
  a horizon under `WEEK_RUNG_DAYS` makes the `week` rung cross before
  `approaching` ever does, so the earlier warning silently never sends.
  Giving the submittal a longer runway "because a review takes longer" was
  considered and dropped: nothing in this app records either period, so that
  number would be picked for feel and then read as derived.
- The same records WITHOUT one are STANDING, after a chase threshold
  (`RFI_CHASE_DAYS` / `SUBMITTAL_CHASE_DAYS`, 14). `dueBy` and `dueBack` are
  both optional, so without this branch the finding would still be live for
  most RFIs. Calling those OVERDUE would be this app asserting a contractual
  date nobody recorded, which is the one thing `backchargeAlerts` says it
  must never do.
- A drawing revision is always STANDING. `issuedOn` is the architect's
  title-block date, not a deadline: it has already passed by the time the gap
  is visible and nobody can meet it by acting sooner. What is true is a
  condition — paper governs this job that we do not hold — and that is
  `AlertSeverity`'s own definition of standing. One alert per SET, dated from
  the OLDEST gap so a month-old miss does not restart its wait the day a new
  bulletin is issued, and future-dated issues dropped because they are not
  gaps yet.

**Keys carry the fact, so dismissals lapse with no expiry logic.** `dueBy`
for a dated RFI, `sentOn` for a standing one, `r<n>:<date>` for a submittal —
the revision number is in there because a reviewer working to a standing
fortnight hands back the SAME `dueBack` on the next round, and on the date
alone one "Seen it" in August would silence September's resubmission. A
drawing set keys on `factDigest` of every outstanding label, the same
unbounded-set mechanism `apprenticeRatioAlerts` uses, so receiving one sheet
or being issued another lapses the dismissal by itself and the key still
fits `assertKeyShape`'s 200 characters on a set with thirty bulletins.

**Gating.** All three take `MANAGE_JOBS` — what `ROUTE_CAPABILITY` already
gives `/rfis`, `/submittals` and `/drawings`, and what `CAPABILITIES`
describes in as many words. That deliberately reaches a foreman: FIELD holds
`MANAGE_JOBS` precisely so a foreman gets an RFI when the drawings are wrong,
and a superseded sheet in the trailer is the person on site's problem first.
What a foreman must not be handed is money, and none of the three carries an
`amount` at all — correspondence has no dollar figure in this schema, so
there is nothing for `visibleToPrincipal` to strip. ACCOUNTING and
PAYROLL_COMPLIANCE hold no `MANAGE_JOBS` and get none of them.

**The evidence, which is the mutations rather than the green.** Fourteen were
run against the derivation, each applied to the source, tested, and reverted
with the restore verified; fourteen verdicts came back, so none was a dead
run counted as a pass. **All fourteen are now RED. Three were GREEN on the
first pass and each one was a test that could not fail:**

- replacing the standing RFI key's `sentOn` with a constant — every key test
  still passed because the two branches still differed from EACH OTHER, which
  is not the property that matters. Now pinned to the literal key.
- deleting the drawing engine's future-date filter — the existing case used a
  lone future revision, which the chase threshold dropped anyway, so the
  alert vanished for the wrong reason. Now tested on a set that is already
  raising, where the only question is whether the future sheet is counted.
- blanking one `ALERT_KIND_LABELS` value — `suggestions.test.ts` compares the
  two maps' KEYS and never their values, so `kindLabel` fell through to its
  `?? kind` and would have rendered `RFI_UNANSWERED` at the user with
  everything green. Now every kind must have a real label, with a size
  assertion in front of the loop so an empty map cannot pass it.

The other eleven went red first time: dropping the `isOpen` gate (3 tests),
dropping `dueBy` from the key (2), moving either chase threshold by a day,
dropping the horizon below the week rung (2), re-gating RFIs on
`MANAGE_BILLING` (2), chasing submittals in every state, dropping the
revision number from the submittal key, reading the first revision instead of
the latest (2), dating a drawing set from the newest gap instead of the
oldest, and making the drawing key a constant (2).

`pnpm --filter @prova/web test` 3221 passed / 187 files; `lint` 13 warnings,
all pre-existing and none in a changed file; `typecheck` and `build` clean.
