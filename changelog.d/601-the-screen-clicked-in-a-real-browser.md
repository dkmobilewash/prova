### The screen changes clicked in a real browser, including the part no test here can see (Cyrus)

**DOCS-ONLY, under the audit exception** (working agreement rule 1): it records what an
investigation established, so nobody re-runs it.
`cyrus/sales-signals`

`components/SubListingImport.tsx` is the one file tonight's work changed that **this
container cannot typecheck** — `react` and `@/lib/actions` do not resolve, so its `tsc`
output is all cascade and a real error could hide in it. The screen suite cannot help
either: it runs in happy-dom, which does no layout.

So the component was bundled and driven in real Chromium over `file://`, by the recipe
CLAUDE.md records. **66 of 66 checks passed at 1280 and 375**, with the three controls that
stop the run being about nothing: the real Tailwind applied (`body` background is the canvas
token), a `__reactFiber$` key found across many elements, and **zero rows asserted before
any text is typed**.

What it proves, from the page rather than from a mock:

| | |
| --- | --- |
| Valley row's dropdown | `["", "lead_samelicence", "lead_existing_valley"]` |
| Summit row's dropdown | `["", "lead_contradict"]` |

The first row's licence match is offered **above** its name match, labelled *"(same licence
number)"* — the capability that did not exist last night. The lead whose licence
*contradicts* that row is absent from it, and the amber note renders with both numbers:
*"…is already a lead with licence 650118; this row prints 884201. Different registrants."*
Pasting 61 rows prints *"That is 61 subcontractors at once"* and **disables submit**, which
re-enables when the paste goes back under the cap.

**The second row is the point of the table, and the first version of this check did not
have it.** It asserted the contradicting lead was absent from EVERY dropdown, and failed —
correctly. That lead holds `650118`, and clean-five's Summit Acoustics row prints
`C-2 650118`, so it is a *legitimate* licence match there while contradicting the Valley
row. The harness was wrong, not the code: "what else already handles the input I chose",
arriving in an instrument instead of a mutation. Both halves are asserted now, because an
exclusion only means something if it discriminates.

**Three harness failures in this one run, and every one crashed rather than lying** — which
is the only reason they were cheap. New checks placed after the submit found no textarea,
because a successful submit calls `reset()` and collapses the panel. Then check 10 tried to
click the submit button the 61-row check had just proved disabled. Then the global-absence
assertion above. **Fifth, sixth and seventh time tonight that a failing control was an
instruction to fix the harness rather than a result to read.**

Not committed as a test: `esbuild` is not a declared dependency of `apps/web` and
`pnpm install` cannot add one here (the `xlsx` tarball 403), so this would be an instrument
nobody can install. The durable version is Diego's call because it adds a route — mount the
component at a dev-only public route outside `(app)` and the existing `e2e-public` job, which
is real Chromium in CI and needs no credentials, clicks it on every PR.
