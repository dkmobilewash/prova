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
 *   ESTIMATING — its own empty company, for specs/estimating-spine.spec.ts:
 *                 the estimating desk Diego built between 22 and 24 Sep and
 *                 nobody had clicked — wall types and a job's wall schedule,
 *                 the bid recap, an estimate template applied, the labor
 *                 production rate, the proposal document and the conceptual
 *                 $/SF calculator. Serial, like the journey, because every
 *                 one of those screens needs an ESTIMATE-stage job with
 *                 lines on it, and building one per case would spend five
 *                 minutes proving the wizard works six more times.
 *   TAKEOFF    — its own empty company, for specs/takeoff-plan.spec.ts: the
 *                 on-screen plan takeoff and the currency banner. Kept off
 *                 ESTIMATING because posting a measured quantity ADDS
 *                 estimate lines, and the template and recap cases count
 *                 the lines on their job.
 *   BID_DESK   — its own empty company, for specs/bid-desk.spec.ts: the four
 *                 things /bids grew in three days — alternates/unit
 *                 prices/allowances, levelling two quotes, bid-form
 *                 compliance, and a won bid linked to its job. One company,
 *                 one GC, one bid, because every one of those panels hangs
 *                 off a bid invitation row.
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
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY EACH ONE ALSO CARRIES A USERNAME AND A PHONE NUMBER
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Because the DEVELOPMENT instance will not create a user without them, and
 * finding that out cost two CI runs on 2026-09-25. Adding the three estimating
 * personas was the first time `clerk.users.createUser` had been reached in
 * weeks — the six above it already exist on the instance and are found by the
 * read in seedClerkUsers.ts — and it answered:
 *
 *     HTTP 422  [form_data_missing]
 *     ["phone_number" "username"] data doesn't match user requirements set
 *     for this instance
 *
 * So the suite could not GROW at all, and nothing said so until somebody tried.
 * Both are supplied rather than guessing which of the two the instance means:
 * an unnecessary one is ignored, a missing one is another red run.
 *
 * THE PHONE NUMBERS ARE CLERK'S OWN RESERVED TEST RANGE (+1 555 555 01xx),
 * which is the documented block for test-mode accounts — the same reasoning as
 * `+clerk_test` on the emails. None of them can reach a person's handset, and
 * no verification code is ever sent anywhere real.
 *
 * All three identifiers must be UNIQUE across this table, which is pinned by
 * personas.test.ts rather than left to whoever adds the next row: Clerk rejects
 * a duplicate username or phone, and the failure would arrive as another bare
 * 422 in global setup.
 *
 * The six personas that already exist never use these values — `createUser` is
 * not called for them — so they are declared for consistency and for the day
 * one of them has to be recreated on a fresh instance.
 */
export const PERSONAS = {
  empty: {
    email: "e2e-empty+clerk_test@example.com",
    label: "EMPTY",
    username: "e2e_empty",
    phone: "+15555550110",
  },
  main: {
    email: "e2e-main+clerk_test@example.com",
    label: "MAIN",
    username: "e2e_main",
    phone: "+15555550111",
  },
  jobCreate: {
    email: "e2e-jobcreate+clerk_test@example.com",
    label: "JOB_CREATE",
    username: "e2e_jobcreate",
    phone: "+15555550112",
  },
  field: {
    email: "e2e-field+clerk_test@example.com",
    label: "FIELD",
    username: "e2e_field",
    phone: "+15555550113",
  },
  journey: {
    email: "e2e-journey+clerk_test@example.com",
    label: "JOURNEY",
    username: "e2e_journey",
    phone: "+15555550114",
  },
  badInputs: {
    email: "e2e-badinputs+clerk_test@example.com",
    label: "BAD_INPUTS",
    username: "e2e_badinputs",
    phone: "+15555550115",
  },
  estimating: {
    email: "e2e-estimating+clerk_test@example.com",
    label: "ESTIMATING",
    username: "e2e_estimating",
    phone: "+15555550116",
  },
  takeoff: {
    email: "e2e-takeoff+clerk_test@example.com",
    label: "TAKEOFF",
    username: "e2e_takeoff",
    phone: "+15555550117",
  },
  bidDesk: {
    email: "e2e-biddesk+clerk_test@example.com",
    label: "BID_DESK",
    username: "e2e_biddesk",
    phone: "+15555550118",
  },
} as const;

export type PersonaKey = keyof typeof PERSONAS;
