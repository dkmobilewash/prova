### The guard that would have caught two features nobody could find (Diego)
`diego/ai-surface-census`

Promised in both #579's and #580's changelogs, which said it would land once both
were merged. Both are merged, so here it is — an unkept promise in a merged
changelog is a claim with an expiry date, which is the thing this repo deletes.

**What it is for.** The 2026-10-01 estimating audit found `BID_RESEARCH` and
`LEAD_SEARCH` both at "2 of 4": a real prompt, a real per-company gate, real
metering, a real model route, and **no control on any page.** Each ran inside one
Ask command and nowhere else, so using a feature the contractor was paying for
meant knowing to phrase a sentence at the assistant.

Nothing was red. `aiFeatureGateCensus` was green, because both WERE gated.
`promptVersionCensus` was green. `FEATURE_MODEL` had an entry for each. Both
features were reachable, correctly gated, correctly metered, and unusable.

`aiSurfaceCensus.test.ts` now fails the build when an `AiFeature` has no control
a page renders. It is the sibling of `stageReachableCensus` and does not replace
it: `PLAN_INGESTION` would have PASSED this census on the day #551 shipped
broken, because its control existed and its gate was reachable — it was the stage
behind them that nothing started. Whether a feature has a control and whether its
work can run are two questions and need two guards.

**TWO ATTEMPTS AT THIS FILE PASSED THEIR OWN MUTATION, AND THAT IS WORTH MORE
THAN THE FILE.** Both are recorded in its header rather than quietly dropped,
because each is a way the next census here will be tempted to go wrong.

Attempt one derived both ends properly: walk imports from every file under `app/`
and `components/`, collect every `aiGate(_, "FEATURE")` reachable. The mutation
for it — unmounting `<ProjectLookup />` from /pipeline, which is exactly the world
before #579 — came back **GREEN**. `ProjectLookup.tsx` was itself a root, so a
component nobody renders counted as a control. That is this repo's oldest
recorded shape, "written, documented, and never called", sitting inside the guard
written to catch it.

Attempt two used only Next's own entry points as roots. **Still green**, for a
reason specific to this codebase: `lib/actions/index.ts` is an `export *` barrel
over every action module, so any page importing `@/lib/actions` transitively
reaches every gate in the app. The graph is effectively fully connected through
one file.

Cutting the barrel does not rescue it either, and that was measured rather than
assumed: **five of the seven existing controls** — `QuoteReader`,
`AddendumFindings`, `WipNarrativeButton`, `DraftLineItemsForm`,
`PlanIngestPanel` — import their action FROM the barrel. Cutting it reports five
features with real controls as having none. Over-approximating with the barrel,
under-approximating without it.

**So import reachability is the wrong instrument here, and saying so is the
finding.** The shape that works is the one `commands.coverage.test.ts` already
uses for "did somebody decide": an explicit entry per feature, with the feature
SET derived from `AI_FEATURES` so a new feature cannot arrive without one.
Absence is not a decision.

What is derived is the half that catches the next one. What is named is then
checked rather than trusted: the component must exist, and something must render
it. A map whose entries are never verified is a comment — and the first run
proved that immediately by rejecting `ComplianceDocuments.tsx`, a filename I had
guessed; the real control is `ComplianceUploadForm.tsx`.

**Mutation-proven in both directions this time**, each red naming the feature, the
file and the reason:

| mutation | result |
| --- | --- |
| `<ProjectLookup />` unmounted from /pipeline | RED — "BID_RESEARCH: ProjectLookup.tsx exists and NOTHING renders it" |
| `LEAD_SEARCH`'s entry deleted (type widened so tsc could not cover for it) | RED — "these AI features have no entry in CONTROLS: LEAD_SEARCH" |
| a named component that does not exist | RED — found on the first real run, as above |

The ask-only exemption is held to one member by assertion, and `ASK` is it. A
second one is an argument somebody has to make, not a line somebody adds — an
exemption list that grows is this census being repealed one reasonable case at a
time, which is the shape the docs-only rule was changed on purpose to avoid.

Checked: `typecheck`, `lint`, **8,487 unit tests over 537 files**, all green.
