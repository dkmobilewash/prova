import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { BidPackageBuilder, type SubmitTarget } from "@/components/BidPackageBuilder";
import { recipientFor } from "@/lib/estimating/bid-submission";
import { emailSetupProblem } from "@prova/integrations";
import { JobProposalClauseBuilder, JobProposalClauseRow } from "@/components/ProposalClauses";
import { money } from "@/lib/money";
import { formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import { groupProposalClauses, PROPOSAL_CLAUSE_HEADINGS } from "@/lib/proposal-clauses";
import { ProposalDrafts, type ProposalDraftView } from "@/components/ProposalDrafts";
import { loadProposalFacts } from "@/lib/estimating/proposal-facts-query";
import { bidTotalOf, recapLines, recapStateFor } from "@/lib/estimating/recap-state";
import { proposalPriceState, proposalPriceWarning } from "@/lib/estimating/proposal-recap-currency";
import { bidMargin, underCostWarning } from "@/lib/estimating/bid-margin";
import {
  bidFormSections,
  parseProposalMode,
  PROPOSAL_MODE_LABELS,
  PROPOSAL_MODES,
  proposalPresentation,
  type ProposalLineInput,
} from "@/lib/estimating/proposal-presentation";
import { surfaceHrefs, type Surface } from "@/lib/bid/surfaceHrefs";
import { adjustmentLabel, gcPrice } from "@/lib/estimating/gc-price";

/**
 * A job's bid proposal — the scope + price + exclusions document a sub sends
 * a GC. The schedule of values is the job's live line items; the clauses are
 * snapshots pulled from the company library or typed for this job.
 *
 * Print-styled HTML plus the browser's own Save as PDF, the same shape as the
 * G702/G703 page: this monorepo has no PDF library and this did not add one.
 * The builder and every Remove control are `print:hidden`, so what prints is
 * the document only.
 *
 * MANAGE_ESTIMATING, the gate /catalog and /bids use: a proposal is a bid,
 * and its clause actions assert the same capability themselves.
 */
export default async function JobProposalPage({
  params,
  searchParams,
  surface = "crm",
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string | string[]; invitation?: string | string[] }>;
  /** Which product renders this page; C Stream Bid passes "bid" (`lib/bid/surfaceHrefs.ts`). */
  surface?: Surface;
}) {
  const { id } = await params;
  // HOW THE PRICE IS PRESENTED. Not stored: a new proposal is a LUMP SUM, and
  // the choice rides on `?mode=` so the screen and the printed page are one
  // URL. See `lib/estimating/proposal-presentation.ts` for what each mode may
  // print — the lump and scope rows have no unit-price field at all.
  const query = await searchParams;
  const mode = parseProposalMode(query.mode);
  // `?invitation=<id>` opens this proposal FOR ONE GC: addressed to the name
  // that GC wrote on its invitation and priced at that GC's price. Absent, the
  // page is exactly what it was before invitations carried a price.
  const invitationParam = Array.isArray(query.invitation) ? query.invitation[0] : query.invitation;
  const invitationId = invitationParam?.trim() ? invitationParam.trim() : null;
  const hrefs = surfaceHrefs(surface, id);
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" homeHref={hrefs.home} homeLabel={hrefs.homeLabel} />;
  const { company } = context;

  const job = await prisma.job.findFirst({
    where: { id, companyId: company.id },
    include: {
      contact: { select: { name: true } },
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        include: { wallTypeComponent: { select: { wallType: { select: { code: true, name: true } } } } },
      },
      proposalClauses: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, kind: true, text: true },
      },
    },
  });
  if (!job) notFound();

  // WHAT THE LETTER IS SILENT ABOUT, and the drafts already raised for it.
  // Both are needed: the facts give the count on the button, and the drafts are
  // what the panel shows. A fact with a draft in any status is already excluded
  // by `loadProposalFacts`, so these two never double-count.
  const [gaps, draftRows] = await Promise.all([
    loadProposalFacts(job.id, company.id),
    prisma.proposalClauseDraft.findMany({
      where: { jobId: job.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, text: true, factKind: true, factRef: true, citation: true, status: true },
    }),
  ]);
  // Whether each accepted clause is already in the standard set, so the offer
  // is not made for one that is. Read by text and kind, which is what
  // `saveClauseToLibrary` compares — a library clause carries no link back to
  // the draft it came from, deliberately: it is a snapshot, like the job clause.
  const libraryTexts = new Set(
    (await prisma.proposalClause.findMany({ where: { companyId: company.id }, select: { kind: true, text: true } })).map(
      (clause) => `${clause.kind}:${clause.text}`,
    ),
  );
  const drafts: ProposalDraftView[] = draftRows.map((draft) => ({
    id: draft.id,
    kind: draft.kind,
    text: draft.text,
    factKind: draft.factKind,
    factRef: draft.factRef,
    citation: draft.citation,
    status: draft.status,
    inLibrary: libraryTexts.has(`${draft.kind}:${draft.text}`),
  }));

  const library = await prisma.proposalClause.findMany({
    where: { companyId: company.id },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, text: true },
  });

  // THE RECAP, READ HERE FOR THE FIRST TIME — and the reason is the whole of
  // `lib/estimating/proposal-recap-currency.ts`. This page is the document a
  // GC acts on, its total is the line prices added up, and until 2026-10-02 it
  // read `JobBidRecap` nowhere at all: a bid with markup, overhead, profit,
  // bond and contingency configured printed none of them unless somebody had
  // pressed "Apply to line prices" on the estimate tab first, with nothing
  // saying so.
  //
  // It is read to WARN and never to re-price. The schedule of values below is
  // a table a GC adds up, so substituting a different grand total under it
  // would produce a document that does not reconcile with itself — which is
  // worse than the defect. `applyBidRecap` is what moves the prices, and it
  // keeps them adding up.
  const recapRow = await prisma.jobBidRecap.findFirst({
    where: { jobId: job.id, companyId: company.id },
  });

  // A null unit price is a cost-only line (general conditions, overhead):
  // it prints with no price and counts $0 toward the bid total, the same
  // rule the contract value uses everywhere else. The total itself is
  // `bidTotalOf` inside `proposalPresentation` — one sum for every mode.
  const proposalLines: ProposalLineInput[] = job.lineItems.map((item) => ({
    id: item.id,
    description: item.description,
    unit: item.unit,
    quantity: Number(item.quantity),
    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
    wallType: item.wallTypeComponent?.wallType ?? null,
    tradeScope: item.tradeScope,
  }));
  // THE ESTIMATE'S OWN TOTAL, which the recap warnings below compare against —
  // they ask whether the recap's rates reached these LINE prices, and a GC's
  // adjustment is not a line price. The figure the document prints is
  // `presentation`, built once the invitation (if any) is loaded.
  const bidTotal = proposalPresentation(proposalLines, mode).total;
  const groups = groupProposalClauses(job.proposalClauses);
  const timeZone = await viewerTimeZone();

  // `addedTotal` is what the rates WOULD add, recomputed here from the job's
  // current lines rather than read off a column — the recap stores percentages
  // and never money, because "a stored total is wrong the moment a line
  // changes" (`bid-recap.prisma`).
  // The same two conversions the estimate tab makes, deliberately identical —
  // `budgetedUnitCost` and not `currentEstimatedUnitCost` (#512: the recap marks
  // up COST, and the latter is the PM's live re-forecast), and the cost category
  // narrowed rather than trusted.
  //
  // NOTE: the JOB's own recap row only, never `CompanyBidDefaults`. The estimate
  // tab falls back to the defaults because it is a FORM pre-filling an unsaved
  // row; this is a document asking "did the rates reach these prices", and
  // company defaults a person has never opened on this job have not.
  // ASSEMBLED BY `recapStateFor`, which the job page's "needs you" list also
  // calls. It was forty lines here; two copies of a money judgement would
  // disagree the day either was edited, and the disagreement would show up as a
  // job page saying the markup is fine over a proposal printing un-marked-up
  // prices. The two nuances this page documented — `budgetedUnitCost` rather
  // than the PM's re-forecast (#512), and the job's own recap row rather than
  // `CompanyBidDefaults` — moved with it and are stated there.
  const recapState = proposalPriceState(recapStateFor(recapRow, job.lineItems), bidTotal);
  const priceWarning = proposalPriceWarning(recapState);

  // DOES THIS BID COVER ITS OWN COST? The same conversion as above, over the
  // same lines — `budgetedUnitCost`, never `currentEstimatedUnitCost`. Nothing
  // new is queried: the page already reads every live line's cost to compute
  // `addedTotal`, and it has never RENDERED one, which is the point of the
  // print:hidden box below.
  // `recapLines` is the same conversion the recap above uses, which is the
  // point: the margin and the markup must read one set of numbers.
  const marginWarning = underCostWarning(bidMargin(recapLines(job.lineItems)), money);

  /**
   * WHAT THIS JOB'S BID CAN BE SENT TO, when one is linked to it.
   *
   * `BidInvitation` is company-scoped and carries no `jobId`; only a bid that
   * was WON points back at a job, through `wonJobId`. So most jobs have no bid
   * here, the send controls do not appear, and the package still builds and
   * downloads — which is what this whole control was until sending existed.
   *
   * EVERY REASON IT CANNOT BE SENT IS WORKED OUT HERE AND SHOWN, rather than
   * discovered on the press. "No email on file" and "sending is not set up"
   * are both fixed somewhere else entirely, and a person who reads them before
   * they have built a package can go and fix them.
   */
  const linkedBid = await prisma.bidInvitation.findFirst({
    where: invitationId
      ? {
          id: invitationId,
          companyId: company.id,
          // Only an invitation priced by THIS estimate: on the project whose
          // estimate this is, or the bid linked to this job. Any other id is a
          // stale link, and a proposal addressed to the wrong GC is worse than
          // none.
          OR: [{ bidProject: { estimateJobId: job.id } }, { wonJobId: job.id }],
        }
      : { wonJobId: job.id, companyId: company.id },
    include: {
      contact: { include: { people: true } },
      // The GC's bid form: alternates and unit prices, typed on the bid.
      lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  const bidForm = linkedBid
    ? bidFormSections(
        linkedBid.lines.map((bidLine) => ({
          kind: bidLine.kind,
          label: bidLine.label,
          description: bidLine.description,
          amount: bidLine.amount != null ? Number(bidLine.amount) : null,
          unit: bidLine.unit,
          unitPrice: bidLine.unitPrice != null ? Number(bidLine.unitPrice) : null,
        })),
        money,
      )
    : null;

  // ── OPENED FOR ONE GC ──
  //
  // A link for an invitation this estimate does not price is a stale or wrong
  // link, and falling back to the generic letter would hand a GC a document
  // that looks addressed to them and is not. Refuse with a 404 instead.
  if (invitationId && !linkedBid) notFound();
  const forInvitation = invitationId ? linkedBid : null;
  const gc = forInvitation
    ? gcPrice(bidTotalOf(proposalLines), {
        amount: forInvitation.priceAdjustAmount != null ? Number(forInvitation.priceAdjustAmount) : null,
        percent: forInvitation.priceAdjustPercent != null ? Number(forInvitation.priceAdjustPercent) : null,
      })
    : null;
  // The price the page prints. A GC whose stored adjustment no longer makes
  // sense (the estimate shrank under a fixed deduct) gets no document at all,
  // only the sentence saying so, rather than a price nobody chose.
  const presentation = proposalPresentation(proposalLines, mode, gc?.ok ? gc.priceCents : undefined);
  const gcAdjustmentWords = forInvitation
    ? adjustmentLabel(
        {
          amount: forInvitation.priceAdjustAmount != null ? Number(forInvitation.priceAdjustAmount) : null,
          percent: forInvitation.priceAdjustPercent != null ? Number(forInvitation.priceAdjustPercent) : null,
        },
        money,
      )
    : null;
  // The other GCs on this estimate, for the switcher above the document.
  const projectInvitations = await prisma.bidInvitation.findMany({
    where: { companyId: company.id, bidProject: { estimateJobId: job.id } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, projectName: true, contact: { select: { name: true } } },
  });
  const proposalHref = (nextMode: string, nextInvitation: string | null) =>
    `${hrefs.proposal}?mode=${nextMode}${nextInvitation ? `&invitation=${encodeURIComponent(nextInvitation)}` : ""}`;
  const addressedTo = forInvitation ? forInvitation.contact.name : job.contact.name;
  const proposalTitle = forInvitation ? forInvitation.projectName : job.name;
  if (gc && !gc.ok) {
    return (
      <PageShell width="reading" className="print:p-0">
        <div className="mb-6 print:hidden">
          <Link href={hrefs.estimate} className="text-sm text-link hover:underline">
            ← Back to the estimate
          </Link>
        </div>
        <p className="rounded-md bg-tag-rose px-3 py-2 text-sm text-tag-rose-ink" data-proposal="gc-price-problem">
          The proposal for {addressedTo} can&apos;t be printed: {gc.error} Fix the adjustment on that GC&apos;s bid and
          open the proposal again.
        </p>
      </PageShell>
    );
  }

  let submitTarget: SubmitTarget | undefined;
  if (linkedBid) {
    const choice = recipientFor({
      contactName: linkedBid.contact.name,
      contactEmail: linkedBid.contact.email,
      people: linkedBid.contact.people.map((person) => ({ name: person.name, email: person.email })),
    });

    // Not dismissed, newest first — the same rows `/ai` shows, read here
    // rather than re-derived. The agent advises; this only displays.
    const findings = await prisma.agentFinding.findMany({
      where: { companyId: company.id, bidInvitationId: linkedBid.id, dismissedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, fixHref: true },
    });

    submitTarget = {
      bidInvitationId: linkedBid.id,
      companyId: company.id,
      companyName: company.name,
      gcName: linkedBid.contact.name,
      addresses: choice.ok ? [choice.recipient, ...choice.alternatives] : [],
      // The setup problem outranks the address one: an install that cannot
      // send at all is not a contact record somebody should go and edit.
      problem: emailSetupProblem() ?? (choice.ok ? null : choice.problem),
      findings: findings.map((finding) => ({
        id: finding.id,
        title: finding.title,
        // A finding's fix link is built in the agents' lib and names a CRM
        // screen; a product that is not the CRM draws the finding without it.
        href: surface === "crm" ? finding.fixHref : null,
      })),
    };
  }

  return (
    // A document, so "reading" — and `print:p-0` so the printed page runs to
    // the browser's own margins, the way the G702/G703 does.
    <PageShell width="reading" className="print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={hrefs.estimate} className="text-sm text-link hover:underline">
          ← Back to the estimate
        </Link>
        <PrintButton />
      </div>

      {/* PRINT:HIDDEN, ADDRESSED TO THE SENDER AND NEVER TO THE GC. The
          document itself stays exactly as it was — this is a sentence to the
          person about to press Print, in the same place and the same style as
          the recap panel's own two warnings about lines with no cost. A note on
          the PRINTED page would be telling a customer our prices may be wrong,
          which is a different and much worse sentence. */}
      {priceWarning && (
        <p className="mb-6 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink print:hidden">
          {priceWarning}
        </p>
      )}

      {/* PRINT:HIDDEN FOR THE SAME REASON AND MORE SO. This page deliberately
          shows the GC no cost figure at all — the schedule of values prints
          prices and nothing else. A margin on the printed page would hand a
          customer our cost base, which is worse than the sentence above it.
          Rose rather than amber: the warnings above are fields somebody forgot
          to fill in, and this one is a bid that does not cover the work. */}
      {marginWarning && (
        <p className="mb-6 rounded-md bg-tag-rose px-3 py-2 text-sm text-tag-rose-ink print:hidden">
          {marginWarning}
        </p>
      )}

      {/* PRINT:HIDDEN — which GC this copy is for, and how its price differs
          from the estimate. The reason is the sender's own note and never
          prints: a GC must not read why it is paying more than another. */}
      {projectInvitations.length > 1 && (
        <nav aria-label="Proposal for" className="mb-4 flex flex-wrap items-center gap-2 print:hidden" data-proposal="gc-switcher">
          <span className="text-xs text-ink-muted">Proposal for</span>
          {[{ id: null as string | null, label: "No GC chosen" }, ...projectInvitations.map((row) => ({ id: row.id as string | null, label: row.contact.name }))].map(
            (option) => (
              <Link
                key={option.id ?? "none"}
                href={proposalHref(mode, option.id)}
                aria-current={option.id === invitationId ? "page" : undefined}
                className={
                  option.id === invitationId
                    ? "rounded-md bg-surface px-3 py-2 text-sm font-semibold text-ink ring-1 ring-line-card"
                    : "rounded-md px-3 py-2 text-sm text-link hover:underline"
                }
              >
                {option.label}
              </Link>
            ),
          )}
        </nav>
      )}
      {forInvitation && gc?.ok && (
        <p className="mb-6 rounded-md bg-surface px-3 py-2 text-sm text-ink-body ring-1 ring-line-card print:hidden" data-proposal="gc-price-note">
          Priced for {forInvitation.contact.name}: estimate {money(gc.estimateCents / 100)}
          {gc.kind === "none" ? (
            <> with no adjustment.</>
          ) : (
            <>
              , adjusted {gcAdjustmentWords} ({gc.adjustmentCents < 0 ? "−" : "+"}
              {money(Math.abs(gc.adjustmentCents) / 100)}
              {forInvitation.priceAdjustReason ? <> — {forInvitation.priceAdjustReason}</> : null}) ={" "}
              <span className="font-semibold text-ink">{money(gc.priceCents / 100)}</span>.
            </>
          )}{" "}
          The reason does not print.
        </p>
      )}

      <h1 className="text-xl font-semibold text-ink">Proposal — {proposalTitle}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {company.name} to {addressedTo} · {formatInstant(new Date(), timeZone, "numeric")}
      </p>
      {job.projectLocation && <p className="text-sm text-ink-muted">{job.projectLocation}</p>}

      {job.scope && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">Scope of work</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-body">{job.scope}</p>
        </section>
      )}

      {/* PRINT:HIDDEN — the sender's choice of how the price reads. Lump sum is
          the default and shows the GC one number; By scope shows a subtotal per
          wall type; Itemized is the schedule of values with unit prices. */}
      <nav aria-label="Price presentation" className="mt-6 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-xs text-ink-muted">Show the price as</span>
        {PROPOSAL_MODES.map((option) => (
          <Link
            key={option}
            href={proposalHref(option, invitationId)}
            aria-current={option === mode ? "page" : undefined}
            className={
              option === mode
                ? "rounded-md bg-surface px-3 py-2 text-sm font-semibold text-ink ring-1 ring-line-card"
                : "rounded-md px-3 py-2 text-sm text-link hover:underline"
            }
          >
            {PROPOSAL_MODE_LABELS[option]}
          </Link>
        ))}
      </nav>
      {mode === "itemized" && (
        <p className="mt-2 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink print:hidden">
          Itemized prints your unit prices for every line to the GC. Most subs send a lump sum or a price by scope.
        </p>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">
          {presentation.mode === "itemized" ? "Schedule of values" : "Price"}
        </h2>
        {proposalLines.length === 0 ? (
          <p className="mt-1 text-sm text-ink-body print:hidden">
            This job has no line items yet.{" "}
            <Link href={hrefs.estimate} className="text-link hover:underline">
              Price it on the estimate page
            </Link>{" "}
            and the price fills in here.
          </p>
        ) : presentation.mode === "itemized" ? (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-line-row text-left text-xs text-ink-muted">
                <th className="py-1 pr-2 font-medium">Description</th>
                <th className="px-2 py-1 text-right font-medium">Qty</th>
                <th className="px-2 py-1 font-medium">Unit</th>
                <th className="px-2 py-1 text-right font-medium">Unit price</th>
                <th className="py-1 pl-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {presentation.rows.map((row) => (
                <tr key={row.id} className="border-b border-line-row">
                  <td className="py-1 pr-2 text-ink">{row.description}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink">{row.quantity}</td>
                  <td className="px-2 py-1 text-ink">{row.unit ?? ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink">{row.unitPrice != null ? money(row.unitPrice) : "—"}</td>
                  <td className="py-1 pl-2 text-right tabular-nums text-ink">{row.total != null ? money(row.total) : "—"}</td>
                </tr>
              ))}
              {presentation.adjustmentCents !== null && (
                <tr className="border-b border-line-row" data-proposal="gc-adjustment-row">
                  <td colSpan={4} className="py-1 pr-2 text-right text-ink">
                    Price adjustment
                  </td>
                  <td className="py-1 pl-2 text-right tabular-nums text-ink">
                    {presentation.adjustmentCents < 0 ? "−" : ""}
                    {money(Math.abs(presentation.adjustmentCents) / 100)}
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={4} className="py-2 pr-2 text-right font-medium text-ink">
                  Total bid
                </td>
                <td className="py-2 pl-2 text-right font-semibold tabular-nums text-ink">{money(presentation.total)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              {presentation.rows.map((row) => (
                <tr key={row.key} className="border-b border-line-row">
                  <td className="py-1 pr-2 text-ink">
                    {presentation.mode === "lump" ? "Lump sum for the work described in this proposal" : row.label}
                  </td>
                  <td className="py-1 pl-2 text-right tabular-nums text-ink">{money(row.amountCents / 100)}</td>
                </tr>
              ))}
              {presentation.mode === "scope" && (
                <tr>
                  <td className="py-2 pr-2 text-right font-medium text-ink">Total bid</td>
                  <td className="py-2 pl-2 text-right font-semibold tabular-nums text-ink">{money(presentation.total)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {/* THE GC'S OWN BID-FORM LINES, in their own section and only when the
          job is linked to the bid that holds them. A blank prints as "No bid" —
          never $0 and never filled from the estimate — and the sender is told
          above the document, where the GC cannot see it. */}
      {bidForm === null && (
        <p className="mt-6 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink print:hidden">
          This job is not linked to a bid, so the bid form&apos;s alternates and unit prices cannot print here. Link it
          from the bid, and anything entered there appears on this page.
        </p>
      )}
      {bidForm && bidForm.blankCount > 0 && (
        <p className="mt-6 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink print:hidden">
          {bidForm.blankCount} alternate or unit price on the bid form has no figure and prints as &ldquo;No bid&rdquo;.
          Enter it on the bid before you send.
        </p>
      )}
      {bidForm && bidForm.alternates.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">Alternates</h2>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {bidForm.alternates.map((row) => (
                <tr key={row.label} className="border-b border-line-row">
                  <td className="py-1 pr-2 text-ink">
                    {row.label}
                    {row.description ? <span className="text-ink-body"> — {row.description}</span> : null}
                  </td>
                  <td className="py-1 pl-2 text-right tabular-nums text-ink">{row.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {bidForm && bidForm.unitPrices.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">Unit prices</h2>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {bidForm.unitPrices.map((row) => (
                <tr key={row.label} className="border-b border-line-row">
                  <td className="py-1 pr-2 text-ink">
                    {row.label}
                    {row.description ? <span className="text-ink-body"> — {row.description}</span> : null}
                  </td>
                  <td className="py-1 pl-2 text-right tabular-nums text-ink">{row.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.kind} className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-label">
            {PROPOSAL_CLAUSE_HEADINGS[group.kind]}
          </h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-body">
            {group.clauses.map((clause) => (
              <JobProposalClauseRow key={clause.id} jobId={job.id} clauseId={clause.id}>
                {clause.text}
              </JobProposalClauseRow>
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-8 rounded-lg border border-line-card bg-surface p-4 print:hidden">
        <h2 className="mb-1 text-sm font-semibold text-ink-label">Add a clause</h2>
        <p className="mb-3 text-xs text-ink-muted">
          What is in your number, what is not, what it assumes, and what the GC can add. A clause added
          here is a copy — editing your library later does not change this proposal.
        </p>
        <JobProposalClauseBuilder jobId={job.id} library={library} libraryHref={hrefs.clauseLibrary} />

      {/* BELOW the clause builder, and `print:hidden` on the section itself:
          this is a working surface, not part of the document a GC receives. */}
      <ProposalDrafts
        jobId={job.id}
        drafts={drafts}
        gapCount={gaps.length}
        canOfferLibrary={context.role === "OWNER"}
      />
      </section>

      {/* LAST ON THE PAGE, because it is the last thing done to a bid: the
          proposal has to exist and be printed before there is a package to
          assemble. `print:hidden` on the section itself — it is a working
          surface, not part of the document the GC receives. */}
      <BidPackageBuilder projectName={job.name} submit={submitTarget} messageLogHref={hrefs.messageLog} />
    </PageShell>
  );
}
