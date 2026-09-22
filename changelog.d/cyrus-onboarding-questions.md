### Three onboarding questions decide what a company's nav shows (Cyrus)
`cyrus/onboarding-questions`

A six-person plaster outfit opening a sidebar carrying submittals,
retainage, WIP and certified payroll concludes "this is for bigger
companies than me" in about four seconds — the founder's own words, after
walking the product with his engineer. Nothing was broken; the product was
answering questions nobody asked.

Safe to cut now for one reason: global search (#386) and Ask's `app_help`
tool already reach and explain every feature regardless of what the rail
shows, so narrowing the VISIBLE surface never narrows the REACHABLE one.

**What ships.** Three questions, asked once right after signup (or on
first load for any pre-existing company, since every one of them also has
no answer on record): "Do you work under general contractors, or direct
for owners?", "Do you do public / prevailing-wage work?", and — worded
the way a contractor who has never heard "AIA G702" would still recognise
it — "Does the GC make you fill in a form every month before they will pay
you?". Skippable, and skipping is not a lesser path: it sets the same
"asked" stamp a real answer does, and per `hasNoScopeAnswers` in
`lib/businessScope.ts`, no answer at all means show everything, forever,
until someone opts in. Answers are stored on `Company`
(`contractingRelationship`, `doesPublicWork`, `filesMonthlyPayApps`,
`businessScopeAskedAt` — one migration, fully additive, no backfill) and
render as one inspectable line — "Set up for: subcontractor under GCs,
public works." — editable any time from Settings, never a black box.

**What it hides, and what it cannot touch.** `navGroupsFor` in
`components/navItems.tsx` now takes a second, independent filter
(`isHiddenByBusinessScope`) alongside the existing capability filter — two
predicates ANDed, never merged, because one is a security boundary and the
other is a display preference about one company's shape. Today that hides
exactly three routes: `/submittals` when the company never works under a
GC, and `/prevailing-wage` / `/union-compliance` when it does no public
work. Retainage, certified payroll and pay applications — the other three
things these answers are meant to eventually narrow — have no top-level
route to hide at all; they live inside the per-job tabs `#385` moved them
into, which is Diego's lane and untouched here. `ROUTE_CAPABILITY`,
`capabilitiesFor()` and `lib/authz.ts` are all untouched — a hidden route
still renders at its URL, still turns up in global search (which gates on
capability only), and Ask can still explain it.

**The check that matters most:** a company with every answer null sees
exactly what it would see with no `businessScope` argument at all —
proven for every job function, not just the owner, in
`components/navItems.test.ts`.

**Mutation-tested by hand, four requested and four caught, each breaking
the exact test named and nothing else** (restored after every run):
1. `navGroupsFor`'s `canReach(...) && !(scope && isHiddenByBusinessScope(...))`
   with the `!` dropped — 8 of `navItems.test.ts`'s tests went red,
   including ones that pass no `businessScope` at all.
2. The `/submittals` rule's `DIRECT_FOR_OWNERS` flipped to
   `UNDER_GENERAL_CONTRACTORS` — the 3 tests naming Submittals went red,
   nothing else.
3. `saveBusinessScope`'s `can(context, "MANAGE_COMPLIANCE")` line deleted —
   `lib/action-capability-guards.test.ts`'s auto-derived walk (225 cases)
   caught it by name, 2 red, the rest untouched.
4. The `/prevailing-wage` / `/union-compliance` rule loosened from
   `doesPublicWork === false` to `!== true` — added a fifth regression
   test first (an answered `contractingRelationship` and
   `filesMonthlyPayApps` with `doesPublicWork` still null must not hide
   either route, since `hasNoScopeAnswers` only short-circuits when EVERY
   field is null and cannot cover a partial answer), then confirmed the
   loosened rule turns exactly that one test red.

`skipBusinessScopeQuestions` and `clearBusinessScope`'s owner-only refusal,
and the `requiredBoolean`/`enumFromForm` form validation, are covered by
`lib/actions/businessScope.dbtest.ts` against a real Postgres rather than
mutation-tested here — this session had no scratch database to run it
against (CLAUDE.md: cannot claim the dbtest suite passes without running
it), so that file is written and left for the next session or CI to
execute.
