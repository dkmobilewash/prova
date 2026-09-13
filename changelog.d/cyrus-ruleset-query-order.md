### The rule-set lookup #244 finally called was carrying #244's own bug (Cyrus)
`cyrus/ruleset-query-order`

#244 fixed two defects in `findEffectiveFringeRateSchedule` (issue #104
findings 3 and 8) and, separately, gave `findEffectiveRuleSet` its first
ever call site (finding 5) — a function that had been documented and
unit-tested five times over while nothing called it. The second fix
re-introduced the first one's bug in the other file, because
`findEffectiveRuleSet` itself was never touched.

**A prevailing-wage review could classify one signed week's overtime
differently on two page loads.** `PrevailingWageRuleSet_no_overlapping_rules`
(migration 20260902021139) excludes on `tsrange(effectiveFrom,
COALESCE(effectiveTo, 'infinity'))`, and tsrange's default bounds are
`[inclusive, exclusive)` — so a rule set ending on 1 June and one starting
on 1 June are ADJACENT to Postgres, not overlapping, and both insert
cleanly. `findEffectiveRuleSet` compared inclusively at BOTH ends, so both
matched 1 June, and it was a bare `.find()`: whichever row the caller's
array happened to list first won. The caller read those rows with
`findMany` and no `orderBy`, and Postgres guarantees no order without one.
Two rule sets that disagree about the daily overtime threshold therefore
produced two different classifications of the same entered hours, with
nothing on the page to say which had been used. The migration's own comment
had already named this cost — "the rules that applied that week" would
depend on row order — for the overlap case the constraint does catch.

Fixed the way #244 fixed the fringe equivalent, and in BOTH places rather
than one: latest `effectiveFrom` among the rule sets that match wins, and
the query orders by the same comparator. Determinism lives in the pure
function, so it cannot be lost by the next call site forgetting an
`orderBy` — which is the shape of this whole finding.

**What #244's fix did NOT do, and this one does: break the tie.** Its
`reduce` uses a strict `>`, so two matches sharing an `effectiveFrom` fall
straight back to array order — the bug it was fixing, one case narrower.
That case is reachable here rather than theoretical:
`createPrevailingWageRuleSet` rejects only an end date STRICTLY BEFORE the
start, so a one-day rule set with `effectiveTo == effectiveFrom` is
accepted, its tsrange is the EMPTY `[x, x)`, and an empty range overlaps
nothing — so the exclusion constraint cannot refuse it alongside a real
rule set beginning that same day. `id` breaks the tie, because the primary
key is the only total order available. Which id wins is arbitrary as a
judgment and the code says so: an id cannot know which rule set a payroll
clerk meant, and stability is the only property claimed for it.

**The check.** `prevailing-wage.test.ts` asserts the same two rule sets in
BOTH array orders give the SAME answer — one pair adjacent on the shared
day, one trio with two back-to-back changeovers in four orderings, and one
identical-`effectiveFrom` pair. All three failed against `main` before the
fix (`expected 'rs_ending' to be 'rs_starting'`), and the tie test alone
fails again if the `id` comparison is replaced by #244's strict `>`
(`expected 'rs_aaa' to be 'rs_zzz'`) — mutation-tested both ways round.

Two things this does NOT cover, said plainly. The `orderBy` added to the
query is belt and braces and has no test: proving a Prisma `orderBy` needs a
live database, and the answer no longer depends on it. And
`findEffectiveFringeRateSchedule` in `lib/labor-cost.ts` still has the
strict-`>` tie, in Diego's lane and left there deliberately — same one-day
schedule reaches it through `FringeRateSchedule`'s identical exclusion
constraint, so it wants an issue rather than a drive-by edit from this
branch.
