### /sales had no browser coverage and could not have any (Diego)
`diego/e2e-operator-persona`

Raised by Cyrus in `#prova-build` on 2026-10-04: *"`/sales` and `/sales/[id]`
have never been loaded by any browser test. The cause is structural rather than
an oversight: no test persona is seeded `isProvaOperator`, so the nav walk can't
reach them even in principle."* He was right, and the structural half is why
this needed a persona rather than a spec.

**THE SUITE WAS ALREADY GREEN ABOUT THOSE PAGES, which is the part worth
reading.** The signed-in nav walk did reach `/sales`. Both pages are gated on
two things deliberately kept out of `lib/permissions.ts` — the company must be
Prova's own operator (`Company.isProvaOperator`) and the viewer must be its
OWNER — and a company failing that gate gets a page reading *"Nothing here for
this account."* That is a 200. It renders cleanly. `expectHealthy` passes it,
correctly, because nothing crashed. So for weeks the suite reported a healthy
walk over a page that had declined to show itself, next to a money spine proved
click by click on every commit.

No persona could have passed that gate either. Every company in this suite
except MAIN is auto-created on first sign-in by `requireCompanyContext`, which
leaves the flag false, and **nothing in the product sets it** — correctly, since
it is a fact about who runs Prova rather than a setting a customer edits. So
Prisma is the only way in, and that is what the seed now does.

**OPERATOR** is the thirteenth persona and the only one whose company is the
operator. It gets its own for the ordinary reason and one more: that flag
changes what the application *shows* rather than what data it holds — it also
reveals `/internal/usage` and an extra integrations panel — so pointing it at
MAIN would change what unrelated specs see on the nav rail and in settings, and
read as a broken feature rather than as a neighbour's flag.

`sales-operator.spec.ts` is four cases, and the fourth is the one that makes
the other three mean anything: a **non-operator is refused**. Without it,
"the pipeline renders" proves nothing — a gate that had quietly failed open
would pass every assertion above, and an internal page failing open is worse
than one nobody tested. The first case asserts the NEGATIVE as well, for the
same reason: a refusal page is a healthy 200, so "it loaded" is not evidence
the gate was passed; only the absence of "Not part of your access" is.

**Two existing guards objected and both were right.** `seedDatabase.test.ts`
held that the seed touches MAIN and nobody else, and that exactly one company
repair runs. Both are now true of two companies rather than one, stated by NAME
instead of by count, so a third appearing still fails. The "seeds no other
persona" case keeps its original protection with one more name in it — every
persona absent from that list still gets its company from the app's own
first-sign-in path, gate and all, which is what the empty-state and onboarding
specs depend on.

**And the fixture had a flaw the new persona exposed.** The mock's `user.upsert`
returned `companyId: "company-main"` for every caller. Invisible while MAIN was
the only seeded company; the moment OPERATOR arrived, its repair was asserted
against MAIN's id and the two were indistinguishable. A fixture that answers one
value for every caller cannot tell two callers apart, which is the whole
question here. It follows the persona now.

Mutation-proved: seeding the operator with `isProvaOperator: false` reds the
new seed case with `expected false to be true`.

**What is NOT proved here, and only CI can prove it.** The new persona is minted
by `clerk.users.createUser` against the `striking-jaybird` DEVELOPMENT instance
in global setup, which has refused a new persona before with a bare
`422 [form_data_missing]` naming `username` and `phone_number`. Both are
supplied and `personas.test.ts` pins that all three identifiers are unique — but
the suite cannot run in an agent container, so **the `e2e` job on this PR is the
first thing that will actually mint this user and load `/sales` in a browser.**
If that job dies in setup rather than in a case, that is where to look.

`typecheck`, `lint`, 569 files / 8,860 unit tests.
