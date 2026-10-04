import { Prisma, prisma } from "@prova/db";
import { isPortalAccessRevoked, CLIENT_VISIBLE_CHANGE_ORDER_STATUS } from "@/lib/access-tokens";

/**
 * EVERYTHING THE GC PORTAL IS ALLOWED TO READ, IN ONE PLACE.
 *
 * WHY THIS MODULE EXISTS RATHER THAN TWO QUERIES ON TWO PAGES. The portal
 * has no auth — `Contact.portalToken` in a URL IS the credential, and that
 * URL gets forwarded inside a GC's office. So every clause below is a
 * security boundary, and until now each one lived inline on the page that
 * happened to need it. `lib/job-media-query.ts` already made this argument
 * for the photo half and made it well: the boundary belongs in "the module
 * the page imports" so that widening it is a visible, deliberate edit
 * rather than a forgetful one. The contract half simply never got the same
 * treatment.
 *
 * It also makes the claims TESTABLE, which is the half that matters most.
 * A Server Component cannot be called from a test; a loader can. And every
 * claim this module makes is a claim about a `where` clause, which a pure
 * test structurally cannot see — so `portal-query.dbtest.ts` runs these
 * functions against a real Postgres.
 *
 * THREE THINGS FOUND WHILE WRITING IT, all live on the page before this:
 *
 *   1. NO JOB-STATUS FILTER AT ALL. `contact.jobs` came back whole, and
 *      the index renders `money(total)` beside every row — so a job still
 *      being PRICED for this GC sat on their portal at the sub's own
 *      running number. `enablePortalAccess` mints one token per CONTACT and
 *      never expires it, so a link opened for a live job in March is still
 *      open when a bid for the same GC is entered in September. ESTIMATE is
 *      also the one state where the number MOVES: `assertEditableDirectly`
 *      permits direct line-item edits only there.
 *
 *   2. COST-ONLY BUDGET LINES ON THE GC'S CONTRACT. jobs.prisma says what a
 *      null `unitPrice` is — "a cost-only budget line (general conditions,
 *      overhead, contingency) has no client-facing sale price" — and they
 *      were rendered anyway, description and all, with `"—"` in both money
 *      columns. That publishes how the company structures a bid, and `"—"`
 *      in a price column on a contract reads as FREE.
 *
 *   3. WHOLE ROWS FETCHED FOR ONE FIELD — and this one is LATENT, not live,
 *      which is a correction to how it was first written up. `company: true`
 *      for `name` alone pulled `intakeEmailToken`, which company.prisma
 *      calls "the unguessable half of this company's inbound intake
 *      address… The token IS the routing" and says to regenerate if it
 *      leaks. It was NOT disclosed: both portal pages are pure server
 *      components, nothing hands `company` or `contact` to a client
 *      component, and only `company.name` is ever read — so the token never
 *      reached the browser or the RSC payload. Saying it was "in the page's
 *      props" reads as "it is in the browser" and would send the next
 *      person hunting a payload it is not in.
 *
 *      Worth closing anyway, and the reason is the shape rather than the
 *      severity: the next person to add one client component taking
 *      `contact` or `company` wholesale turns it into a real disclosure
 *      with no visible change at the call site. A `select` is the cheap
 *      permanent answer, and it costs nothing to have made it already.
 *
 *   4. TWO FORMULAS FOR CONTRACT VALUE, agreeing by coercion. The index
 *      reduced `Number(item.quantity) * Number(item.unitPrice)` with no null
 *      check while `ContractSummary` tests for null explicitly. They matched
 *      only because `Number(null)` is 0 — a coercion standing in for a rule,
 *      in the one place a GC sees a total, and in the copy that did not
 *      document it. Both selects now exclude the rows, so neither total
 *      depends on the coercion, and the reduce says the rule out loud.
 *
 * THE SHAPE THAT PREVENTS THE NEXT ONE. The selects are module constants
 * and the exported types are DERIVED from them with `GetPayload`, so the
 * type and the query cannot drift apart: adding a field to the type without
 * adding it to the select is not expressible, and adding one to the select
 * is a visible line in a diff on a file named for the portal. That is the
 * same reasoning `PortalJobPhoto` uses — "three deliberate edits, not one
 * forgetful one".
 */

/** What the index needs, and not one field more. `lineItems` is here only
 * to total the contract; no description or price reaches that page. */
const PORTAL_CONTACT_SELECT = {
  id: true,
  name: true,
  status: true,
  portalRevokedAt: true,
  company: { select: { name: true } },
  jobs: {
    /* WORK THIS GC HAS NOT AWARDED DOES NOT APPEAR ON THEIR PAGE — see (1)
       in the header.

       `not: "ESTIMATE"` rather than a rule of its own, because the way OUT
       of ESTIMATE is already the guarded transition: `markJobContracted`
       refuses without line items AND evidence of an executed contract
       (`lib/contract-execution.ts`). So "not an estimate" already means
       "this GC signed something, or we hold their executed subcontract" —
       the same evidence the rest of the client-facing surface leans on,
       rather than a second definition of the same idea that could drift
       from it. */
    where: { status: { not: "ESTIMATE" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      lineItems: {
        /* THE SAME `unitPrice: { not: null }` AS THE JOB PAGE, so the total
           on this list and the total on the contract are built from one
           population rather than two that happen to agree.

           They did agree, by coincidence rather than by decision: the index
           reduced with `Number(item.quantity) * Number(item.unitPrice)` and
           no null check, and `Number(null)` is 0. That is a coercion doing
           the work of a rule, in the one place a GC sees a total, and it is
           the copy that did NOT document the rule. Excluding the rows here
           means neither total depends on the coercion at all. */
        where: { isDeleted: false, unitPrice: { not: null } },
        select: { quantity: true, unitPrice: true },
      },
    },
  },
} satisfies Prisma.ContactSelect;

/** One job, as a GC may see it. */
const PORTAL_JOB_SELECT = {
  id: true,
  name: true,
  status: true,
  scope: true,
  companyId: true,
  contactId: true,
  company: { select: { name: true } },
  contact: { select: { name: true } },
  lineItems: {
    /* `unitPrice: { not: null }` is finding (2). The contract total cannot
       move: `ContractSummary` sums `item.unitPrice != null ? … : 0`, so
       these lines already contributed zero. This removes rows, never money.

       Printing them on the sub's OWN proposal stays as it is, and is right:
       a proposal is chosen and sent. This page renders whenever somebody
       opens a link. */
    where: { isDeleted: false, unitPrice: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      description: true,
      quantity: true,
      unit: true,
      unitPrice: true,
      originChangeOrder: { select: { number: true } },
    },
  },
  changeOrders: {
    /* Issue #106 finding 1, unchanged: APPROVED only. DRAFT is the sub's
       unsent internal note, SUBMITTED a pending ask, REJECTED and VOID
       things that did not happen — and VOID/REJECTED numbers would expose
       gaps in the sequence with no context for why.

       What IS new: `edits` is no longer fetched. Nothing rendered it, and
       `ChangeOrderLineItemEdit` holds field/oldValue/newValue — the
       before-and-after pricing of every approved change. The status filter
       kept the unsent asks out while the edit log carried the pricing
       history of the ones that landed. */
    where: { status: CLIENT_VISIBLE_CHANGE_ORDER_STATUS },
    orderBy: { number: "asc" },
    select: { id: true, number: true, title: true, description: true },
  },
  signatureRequests: {
    /* Issue #106 finding 2: never hand the GC a "Review and sign" link to
       a request that will 404 the moment they click it. */
    where: {
      status: "PENDING",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { token: true },
  },
  invoices: {
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      description: true,
      amount: true,
      retainageWithheld: true,
      /* Amount alone, and no order: the only use is a `reduce` to a paid
         total. The default row carried method, note, feeAmount and
         feeSource for every payment. */
      payments: { select: { amount: true } },
    },
  },
} satisfies Prisma.JobSelect;

export type PortalContact = Prisma.ContactGetPayload<{ select: typeof PORTAL_CONTACT_SELECT }>;
export type PortalJob = Prisma.JobGetPayload<{ select: typeof PORTAL_JOB_SELECT }>;

/**
 * The holder of this token, or null.
 *
 * NULL COVERS THREE DIFFERENT THINGS ON PURPOSE — no such token, a revoked
 * one, and a contact the sub has set INACTIVE. `lib/access-tokens.ts` makes
 * the argument: distinguishing them "would tell whoever is holding a dead
 * link something about its history that they have no business learning".
 * Callers 404 on null, so the portal's negative space stays uniform.
 */
export async function loadPortalContact(token: string): Promise<PortalContact | null> {
  const contact = await prisma.contact.findUnique({
    where: { portalToken: token },
    select: PORTAL_CONTACT_SELECT,
  });
  if (!contact || isPortalAccessRevoked(contact)) return null;
  return contact;
}

/**
 * One job belonging to this contact, or null.
 *
 * `contactId` IS IN THE `where`, not checked after the fetch. The page used
 * to read the job and then compare `job.contactId !== contact.id`, which is
 * correct and one moved line from not being: a row that is not this
 * contact's now never leaves the database at all, so there is nothing in
 * memory for a later edit to render by accident. Same answer, smaller
 * window.
 */
export async function loadPortalJob(contactId: string, jobId: string): Promise<PortalJob | null> {
  return prisma.job.findFirst({
    /* THE SAME `not: "ESTIMATE"` AS THE LIST, AND IT IS NOT BELT-AND-BRACES.
       Filtering only the index removes the LINK and leaves the PAGE — and
       until this change estimates WERE listed, so a GC who opened their
       portal last week has the URL of a bid in progress sitting in their
       browser history, and it would have kept resolving to a full contract
       summary with every line and price on it. A job id is a cuid and not
       guessable; a visited URL needs no guessing.

       Nothing legitimate is lost. Signing happens at `/esign/<token>`, not
       here, so a GC never needs this page for a job that is still an
       estimate; and no proposal-sharing flow routes through the portal
       (checked: nothing under lib/actions/proposals.ts or the proposal
       components mentions portalToken). */
    where: { id: jobId, contactId, status: { not: "ESTIMATE" } },
    select: PORTAL_JOB_SELECT,
  });
}
