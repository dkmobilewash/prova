import { prisma } from "@prova/db";
import { money } from "@/lib/money";
import { SEARCH_TYPE_LABELS, type RecordSearchArgs, type SearchProvider, type SearchRecordResult } from "./types";

/**
 * Every kind of record global search can find, one entry per Prisma model.
 *
 * WHAT DECIDES WHETHER A MODEL BELONGS HERE. Two things, both required:
 * it must be scoped to one company (directly by `companyId`, or through a
 * `job` relation whose `companyId` this file filters on explicitly — see
 * `changeOrderProvider`/`invoiceProvider`), and it must have a real gate to
 * derive from — a static list page in `ROUTE_CAPABILITY`, or an Ask tool in
 * `lib/ask/tools.ts` that already reads the same data. `types.ts`'s file
 * comment explains why capability is never a field on these objects.
 *
 * WHAT IS DELIBERATELY NOT HERE YET, and why — the full accounting is in
 * the PR, this is the shape of it:
 *   - `CrewMember` — carries the last four digits of an SSN
 *     (`legalFirstName`/`legalLastName`/the SSN fragment, all locked
 *     payroll-filing fields). "Crew" below searches `User` instead — name,
 *     email, role — the same data `/team` already shows to everyone and
 *     `team_roster`'s primary citation. Certification GAPS, the reason
 *     `team_roster` itself is gated `MANAGE_FIELD`, are not surfaced here
 *     at all, so this provider stays honestly at the open gate `/team`
 *     itself sits at.
 *   - Anything payroll (`TimeEntry`, `PayrollRegisterEntry`,
 *     `Wh347PayrollNumber`), any compliance/insurance document
 *     (`ComplianceDocument`, `CompanyLicense`, `CompanyInsurancePolicy`,
 *     `CompanyBond`), `WorkerCertification` — all plausible v2 additions,
 *     left out here for time rather than for a security reason, and each
 *     one needs its own capability decision before it ships, not a
 *     copy-paste of a neighbour's.
 *   - `SalesLead`/`SalesOpportunity` — gated by `isProvaOperator &&
 *     role === "OWNER"` in `assertSalesAccess`, which is NOT expressible
 *     as a `lib/permissions.ts` `Capability` (see that function's own
 *     comment). This file's whole design assumes a capability exists to
 *     derive; Prova's own internal CRM needs a second gate shape this
 *     feature does not have yet, so it is out rather than half-guarded.
 *   - `ContactPerson` (individual people at an account) — shown on
 *     `/contacts/[id]` only behind `MANAGE_ESTIMATING`, one level stricter
 *     than the `Contact` account itself. Left out rather than guessed at.
 *
 * Every provider's `search` is scoped to `companyId` FIRST in its `where`,
 * matching the convention every `*-query.ts` file in this codebase already
 * uses (see `lib/bid-pipeline-query.ts`).
 */

/**
 * Postgres `integer` — the type Prisma's `Int` maps to, and therefore the
 * only range an RFI, submittal, change-order or invoice `number` column can
 * hold.
 */
const PG_INT_MAX = 2_147_483_647;

/**
 * The record NUMBER this query is asking for, or null when it is not asking
 * for one.
 *
 * WHY THIS IS NOT `Number(digits)` INLINE, WHICH IS WHAT IT WAS. Four
 * providers each did `terms.find((t) => /^\d+$/.test(t))` and passed the
 * result straight to `Number()`. Paste a phone number into the search box
 * and that is a ten-digit term — 5551234567, comfortably past
 * `PG_INT_MAX` — handed to Prisma as an `Int` equality filter on a column
 * that cannot represent it.
 *
 * The guard is right whether or not that throws, and this is the part
 * worth reading: a value outside the column's range CANNOT EQUAL ANY ROW,
 * so the filter was never going to match. At best it is a branch of an
 * `OR` that costs a comparison and returns nothing; at worst it is an
 * error out of the query engine, and a global search that throws is the
 * one this app hangs on (see `lib/actions/search.ts` and
 * `SearchLauncher`). Dropping it loses nothing either way.
 *
 * Kept as a shared function rather than four copies because four copies is
 * exactly how three of them get fixed.
 */
export function recordNumberTerm(terms: readonly string[]): number | null {
  const digits = terms.find((term) => /^\d+$/.test(term));
  if (digits === undefined) return null;
  const value = Number(digits);
  // `< 1` also covers "0" and, via the safe-integer check, a digit string
  // long enough to lose precision on the way through a double.
  if (!Number.isSafeInteger(value) || value < 1 || value > PG_INT_MAX) return null;
  return value;
}

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

// ------------------------------------------------------------------ job --

const jobProvider: SearchProvider = {
  type: "job",
  label: SEARCH_TYPE_LABELS.job,
  gate: "route",
  // /jobs/[id] is a dynamic route with no ROUTE_CAPABILITY entry of its
  // own — the job page withholds money section by section instead of
  // being gated whole. The job LIST lives on /dashboard, which is open.
  // Matching that: this provider shows name/status/GC only, the same
  // no-capability slice job_overview shows before any money section.
  route: "/dashboard",
  async search({ companyId, query, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const jobs = await prisma.job.findMany({
      where: {
        companyId,
        OR: [{ name: { contains: query, mode: "insensitive" } }, { contact: { name: { contains: query, mode: "insensitive" } } }],
      },
      select: { id: true, name: true, status: true, contact: { select: { name: true } } },
      take: limit,
      orderBy: { name: "asc" },
    });
    return jobs.map((job) => ({
      kind: "record",
      type: "job",
      id: job.id,
      title: job.name,
      subtitle: `${titleCase(job.status)} — ${job.contact.name}`,
      href: `/jobs/${job.id}`,
    }));
  },
};

// -------------------------------------------------------------- contact --

const contactProvider: SearchProvider = {
  type: "contact",
  label: SEARCH_TYPE_LABELS.contact,
  gate: "route",
  route: "/contacts",
  async search({ companyId, query, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const contacts = await prisma.contact.findMany({
      where: {
        companyId,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
          { phone: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, accountType: true, status: true },
      take: limit,
      orderBy: { name: "asc" },
    });
    return contacts.map((contact) => ({
      kind: "record",
      type: "contact",
      id: contact.id,
      title: contact.name,
      subtitle: [contact.accountType ? titleCase(contact.accountType) : null, titleCase(contact.status)]
        .filter(Boolean)
        .join(" — "),
      href: `/contacts/${contact.id}`,
    }));
  },
};

// ----------------------------------------------------------------- crew --

const crewProvider: SearchProvider = {
  type: "crew",
  label: SEARCH_TYPE_LABELS.crew,
  gate: "route",
  // /team is open — "a roster of who works here is not a tier", the same
  // reasoning team_roster's own comment records for its primary citation.
  // This provider surfaces exactly that slice (name, email) and nothing
  // team_roster's MANAGE_FIELD gate protects (certification gaps), so it
  // is honest to leave it at the page's own open gate.
  route: "/team",
  async search({ companyId, query, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const users = await prisma.user.findMany({
      where: {
        companyId,
        OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }],
      },
      select: { id: true, name: true, email: true, jobFunction: true },
      take: limit,
      orderBy: { email: "asc" },
    });
    return users.map((user) => ({
      kind: "record",
      type: "crew",
      id: user.id,
      title: user.name?.trim() || user.email,
      subtitle: [user.jobFunction ? titleCase(user.jobFunction) : null, user.email].filter(Boolean).join(" — "),
      href: "/team",
    }));
  },
};

// --------------------------------------------------------------- vendor --

const vendorProvider: SearchProvider = {
  type: "vendor",
  label: SEARCH_TYPE_LABELS.vendor,
  gate: "route",
  route: "/vendors",
  async search({ companyId, query, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const vendors = await prisma.vendor.findMany({
      where: {
        companyId,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { contactName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, tradeScope: true },
      take: limit,
      orderBy: { name: "asc" },
    });
    return vendors.map((vendor) => ({
      kind: "record",
      type: "vendor",
      id: vendor.id,
      title: vendor.name,
      subtitle: vendor.tradeScope ? titleCase(vendor.tradeScope) : null,
      href: "/vendors",
    }));
  },
};

// ------------------------------------------------------------------ rfi --

const rfiProvider: SearchProvider = {
  type: "rfi",
  label: SEARCH_TYPE_LABELS.rfi,
  gate: "route",
  route: "/rfis",
  async search({ companyId, query, terms, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const numberMatch = recordNumberTerm(terms);
    const rfis = await prisma.rfi.findMany({
      where: {
        companyId,
        OR: [
          { subject: { contains: query, mode: "insensitive" } },
          { question: { contains: query, mode: "insensitive" } },
          ...(numberMatch !== null ? [{ number: numberMatch }] : []),
        ],
      },
      select: { id: true, number: true, subject: true, status: true, job: { select: { name: true } } },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });
    return rfis.map((rfi) => ({
      kind: "record",
      type: "rfi",
      id: rfi.id,
      title: `RFI #${rfi.number} — ${rfi.subject}`,
      subtitle: `${rfi.job.name} — ${titleCase(rfi.status)}`,
      href: "/rfis",
    }));
  },
};

// ------------------------------------------------------------ submittal --

const submittalProvider: SearchProvider = {
  type: "submittal",
  label: SEARCH_TYPE_LABELS.submittal,
  gate: "route",
  route: "/submittals",
  async search({ companyId, query, terms, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const numberMatch = recordNumberTerm(terms);
    const submittals = await prisma.submittal.findMany({
      where: {
        companyId,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          ...(numberMatch !== null ? [{ number: numberMatch }] : []),
        ],
      },
      select: { id: true, number: true, title: true, job: { select: { name: true } } },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });
    return submittals.map((submittal) => ({
      kind: "record",
      type: "submittal",
      id: submittal.id,
      title: `Submittal #${submittal.number} — ${submittal.title}`,
      // Status is derived from the latest revision (see operations.prisma's
      // own comment on SubmittalRevision) and this provider does not
      // recompute that derivation a second time — the result links straight
      // to the page that already gets it right.
      subtitle: submittal.job.name,
      href: "/submittals",
    }));
  },
};

// ----------------------------------------------------------- punch list --

const punchListProvider: SearchProvider = {
  type: "punchListItem",
  label: SEARCH_TYPE_LABELS.punchListItem,
  gate: "route",
  route: "/punch-lists",
  async search({ companyId, query, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const items = await prisma.punchListItem.findMany({
      where: {
        companyId,
        OR: [{ description: { contains: query, mode: "insensitive" } }, { area: { contains: query, mode: "insensitive" } }],
      },
      select: { id: true, description: true, status: true, area: true, job: { select: { name: true } } },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
    return items.map((item) => ({
      kind: "record",
      type: "punchListItem",
      id: item.id,
      title: item.description,
      subtitle: [item.job.name, item.area, titleCase(item.status)].filter(Boolean).join(" — "),
      href: "/punch-lists",
    }));
  },
};

// -------------------------------------------------------------- drawing --

const drawingProvider: SearchProvider = {
  type: "drawing",
  label: SEARCH_TYPE_LABELS.drawing,
  gate: "route",
  route: "/drawings",
  async search({ companyId, query, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const sets = await prisma.drawingSet.findMany({
      where: {
        companyId,
        OR: [{ name: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }],
      },
      select: { id: true, name: true, job: { select: { name: true } } },
      take: limit,
      orderBy: { updatedAt: "desc" },
    });
    return sets.map((set) => ({
      kind: "record",
      type: "drawing",
      id: set.id,
      title: set.name,
      subtitle: set.job.name,
      href: "/drawings",
    }));
  },
};

// ---------------------------------------------------------- change order --

const changeOrderProvider: SearchProvider = {
  type: "changeOrder",
  label: SEARCH_TYPE_LABELS.changeOrder,
  gate: "tool",
  // ChangeOrder has no static list page of its own — it lives inside the
  // job page's Change orders section. change_order_status is the Ask tool
  // that reads that exact section, already reviewed at VIEW_JOB_COSTS.
  toolName: "change_order_status",
  async search({ companyId, query, terms, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const numberMatch = recordNumberTerm(terms);
    const changeOrders = await prisma.changeOrder.findMany({
      // ChangeOrder has no companyId column of its own — scoped through the
      // job it belongs to, same as invoiceProvider below.
      where: {
        job: { companyId },
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          ...(numberMatch !== null ? [{ number: numberMatch }] : []),
        ],
      },
      select: { id: true, number: true, title: true, status: true, jobId: true, job: { select: { name: true } } },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
    // A change order has no page of its own — the job page is the only
    // place one can be opened, so that is the href, not a route this
    // provider invents.
    return changeOrders.map((co) => ({
      kind: "record",
      type: "changeOrder",
      id: co.id,
      title: `CO #${co.number} — ${co.title}`,
      // No dollar value: that figure is computed against JobLineItem the
      // way lib/wip.ts does it, and re-deriving it inside a search result
      // risks a second, drifting copy of that math. The link goes to the
      // job page, which already gets it right.
      subtitle: `${co.job.name} — ${titleCase(co.status)}`,
      href: `/jobs/${co.jobId}`,
    }));
  },
};

// -------------------------------------------------------------- invoice --

const invoiceProvider: SearchProvider = {
  type: "invoice",
  label: SEARCH_TYPE_LABELS.invoice,
  gate: "tool",
  // Same shape as changeOrderProvider: no static list page, so this
  // borrows pay_application_status's already-reviewed MANAGE_BILLING gate
  // — the tool that reads this exact Invoice data.
  toolName: "pay_application_status",
  async search({ companyId, query, terms, limit }: RecordSearchArgs): Promise<SearchRecordResult[]> {
    const numberMatch = recordNumberTerm(terms);
    const invoices = await prisma.invoice.findMany({
      where: {
        job: { companyId },
        OR: [
          { description: { contains: query, mode: "insensitive" } },
          ...(numberMatch !== null ? [{ number: numberMatch }] : []),
        ],
      },
      select: { id: true, number: true, amount: true, status: true, jobId: true, job: { select: { name: true } } },
      take: limit,
      orderBy: { issuedAt: "desc" },
    });
    // Money shown ONLY here, never on jobProvider — this provider's whole
    // gate is MANAGE_BILLING, so unlike a job's status/GC (open to
    // everyone) an amount is only ever handed to someone already cleared
    // to see every other dollar figure in the app.
    return invoices.map((invoice) => ({
      kind: "record",
      type: "invoice",
      id: invoice.id,
      title: `Invoice #${invoice.number} — ${money(Number(invoice.amount))}`,
      subtitle: `${invoice.job.name} — ${titleCase(invoice.status)}`,
      href: `/jobs/${invoice.jobId}`,
    }));
  },
};

/**
 * The registry. `searchProviderCensus.test.ts` asserts this array's length
 * against an independent `grep -c` of this file, and asserts every `type`
 * is unique — the "written and never registered" trap CLAUDE.md's Traps
 * section names twice already.
 */
export const SEARCH_PROVIDERS: SearchProvider[] = [
  jobProvider,
  contactProvider,
  crewProvider,
  vendorProvider,
  rfiProvider,
  submittalProvider,
  punchListProvider,
  drawingProvider,
  changeOrderProvider,
  invoiceProvider,
];
