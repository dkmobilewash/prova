/**
 * The four Clerk test identities this suite signs in as, and why there are
 * four rather than one.
 *
 * Sharing a single signed-in user across every spec was the first design
 * and it was rejected on paper: "each spec independent; no ordering
 * dependencies" (the task's own discipline rule) is not achievable against
 * one company, because "dashboard on a brand-new empty company" and
 * "create a job end to end" make opposite claims about the same
 * `Job` table. Four identities, four companies, each used by specs that
 * cannot invalidate each other's assumptions:
 *
 *   EMPTY      — never mutated by any spec. Every empty-state assertion
 *                 (dashboard, contacts, punch lists, field reports) reads
 *                 this one and only reads it.
 *   MAIN       — pre-seeded (see seedDatabase.ts) with one contact and one
 *                 job, directly through Prisma, never through the UI, so
 *                 specs that need an EXISTING job (job detail, schedule,
 *                 settings/import, ask panel, the tour, the failed-save
 *                 invariant) don't depend on any other spec having run
 *                 first. Nothing in this suite mutates MAIN's job/contact
 *                 rows — the one spec that submits a form against MAIN
 *                 (failed-save-keeps-input) submits one engineered to be
 *                 REFUSED, on purpose, so it writes nothing.
 *                 An ESTABLISHED account: its company is seeded already
 *                 past the onboarding questions, so its OWNER lands on
 *                 /dashboard, not /welcome (seedDatabase.ts,
 *                 ESTABLISHED_ACCOUNT_ASKED_AT). Every other company
 *                 here is brand new and meets that gate.
 *   JOB_CREATE — its own empty company, touched by exactly one spec
 *                 (jobs-new), which is the one spec allowed to create a
 *                 job through the UI. Kept off EMPTY so that spec's write
 *                 can never race the dashboard-empty spec's "zero jobs"
 *                 assumption, whichever order a parallel runner picks.
 *   FIELD      — not its own company. A second User row inside MAIN's
 *                 company, role MEMBER, jobFunction FIELD — the "a
 *                 field-function member sees no money figures on the
 *                 rail" invariant needs a viewer INSIDE a company that
 *                 has money to hide, not an empty one.
 *   JOURNEY    — its own empty company, touched by exactly one spec file
 *                 (specs/journey.spec.ts), which walks the whole pilot
 *                 path IN ORDER — sign in, first job, estimate, executed
 *                 subcontract, contracted, retainage, first invoice, every
 *                 tab, every nav destination. That file is serial by
 *                 design (step 7 needs steps 3-6 to have happened), so it
 *                 gets a company nothing else reads or writes.
 *   BAD_INPUTS — its own empty company, for specs/known-bad-inputs.spec.ts:
 *                 the inputs that took the product down on 2026-09-21
 *                 (`2,800`, `12,500`, `0.10`), each driven as its own
 *                 independent case against a job that file builds for
 *                 itself. Kept off JOURNEY so a refused or half-saved
 *                 input can never change what the journey sees.
 *
 * Every email carries Clerk's `+clerk_test` suffix, which is what makes
 * Clerk suppress delivery entirely — no real email is ever sent for these
 * accounts. See seedClerkUsers.ts for how each one is minted.
 */
/**
 * WHY THERE IS A USERNAME AND A PHONE HERE WHEN THE APP SIGNS IN BY EMAIL.
 *
 * The `striking-jaybird` DEVELOPMENT instance requires both as user
 * attributes, and `createUser` with an email alone is refused:
 *
 *     [form_data_missing] missing data
 *     ["username" "phone_number"] data doesn't match user requirements
 *     set for this instance
 *
 * That is an instance SETTING, not something the suite can assert its way
 * out of — and it is deliberately fixed here rather than by relaxing the
 * setting, because that instance is shared: it holds the original dev
 * users, and loosening a requirement on it to make a test pass changes
 * what every other dev sign-up is asked for. Sending the two fields costs
 * nothing and touches nobody.
 *
 * The phone numbers are Clerk's documented FICTIONAL test range — `+1
 * (XXX) 555-0100` through `555-0199` — which send no SMS and verify with
 * `424242`, the same bargain `+clerk_test` makes for email. They must be
 * distinct from each other: two users cannot share a phone on one
 * instance, and the collision would surface as this same opaque 422 on
 * whichever persona happened to be seeded second.
 *
 * `personas.test.ts` holds both invariants, since neither is visible at
 * the point where a new persona would be added.
 */
export const PERSONAS = {
  empty: { email: "e2e-empty+clerk_test@example.com", label: "EMPTY", username: "e2e_empty", phone: "+15555550101" },
  main: { email: "e2e-main+clerk_test@example.com", label: "MAIN", username: "e2e_main", phone: "+15555550102" },
  jobCreate: { email: "e2e-jobcreate+clerk_test@example.com", label: "JOB_CREATE", username: "e2e_jobcreate", phone: "+15555550103" },
  field: { email: "e2e-field+clerk_test@example.com", label: "FIELD", username: "e2e_field", phone: "+15555550104" },
  journey: { email: "e2e-journey+clerk_test@example.com", label: "JOURNEY", username: "e2e_journey", phone: "+15555550105" },
  badInputs: { email: "e2e-badinputs+clerk_test@example.com", label: "BAD_INPUTS", username: "e2e_badinputs", phone: "+15555550106" },
} as const;

export type PersonaKey = keyof typeof PERSONAS;
