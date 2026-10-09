import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { formatCalendarDate } from "@/lib/render-date";
import { tradeScopeLabel } from "@/lib/trade-scopes";
import { regretLetter } from "@/lib/regret-letter";
import { declineLabel } from "@/lib/bid-decline";
import type { DeclineReason } from "@/lib/bid-decline";

/**
 * ── THE REGRET LETTER ──
 *
 * A sub who ignores an invitation to bid gets dropped from the GC's list. One
 * who declines politely stays on it. That is the whole business case, and the
 * estimating workflow names it: *"send a polite Regret / Decline to Bid letter
 * to the GC to maintain relationship status"*.
 *
 * Print-styled HTML and the browser's own Save as PDF — the same mechanism the
 * proposal and the G702/G703 use, and no new dependency.
 *
 * ── EVERY SENTENCE IS DECIDED IN `lib/regret-letter.ts` ──
 *
 * This page renders and queries; it composes nothing. The wording of a document
 * sent to a customer is a decision, and a decision written inline in JSX is one
 * no test can reach — the reason `errorBandText` and `evidenceOrder` are pure.
 * In particular, WHICH decline reasons may be told to the GC is six lines of
 * judgement with a test each, and it does not live here.
 *
 * ── NOTHING IS STORED ──
 *
 * No `regretSentOn`, no column, no migration. The letter is derived from the
 * invitation on every read, exactly as the proposal is derived from the job.
 * Recording that it was sent would be useful and is a separate decision: the
 * app does not record sending the proposal either, and one document quietly
 * growing a sent-state while its sibling has none is the kind of split this
 * repo pays for later.
 */
export default async function RegretLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;
  const { id } = await params;

  const bid = await prisma.bidInvitation.findFirst({
    where: { id, companyId: company.id },
    include: { contact: { include: { people: { orderBy: { createdAt: "asc" }, take: 1 } } } },
  });
  if (!bid) notFound();

  const letter = regretLetter({
    fromCompany: company.name,
    toCompany: bid.contact.name,
    // THE FIRST NAMED PERSON AT THAT GC, or nobody. A letter addressed to a
    // person reads as written by one; `regretLetter` falls back to the
    // estimating team rather than inventing a name.
    toPerson: bid.contact.people[0]?.name ?? null,
    projectName: bid.projectName,
    dueDate: bid.dueDate ? formatCalendarDate(bid.dueDate) : null,
    tradeScope: tradeScopeLabel(bid.tradeScope),
    reason: (bid.declineReason as DeclineReason | null) ?? null,
  });

  return (
    // A document, so "reading" — and `print:p-0` so the printed page runs to
    // the browser's own margins, the way the proposal does.
    <PageShell width="reading" className="print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/bids" className="text-sm text-link hover:underline">
          ← Back to bids
        </Link>
        <PrintButton />
      </div>

      {/* ── FOR THE SENDER, NEVER PRINTED ──
          The status is not DECLINED, so this letter is about a bid somebody is
          still working. Shown rather than refused: a sub may well write the
          letter before changing the status, and refusing would send them to
          change a record in order to print a draft. */}
      {bid.status !== "DECLINED" && (
        <p className="mb-6 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink print:hidden">
          This bid is still marked <strong>{bid.status.toLowerCase()}</strong>. The letter below is ready
          either way — set the status to Declined when the decision is final, so it shows up in
          &ldquo;Work turned down&rdquo; on the bids page.
        </p>
      )}

      {/* ── THE OMISSION, SAID WHERE THE GC CANNOT SEE IT ──
          `proposal/page.tsx` sets this rule for a different document: a note on
          the PRINTED page would be telling a customer something that is none of
          their business. Six of the nine decline reasons never reach a letter
          addressed to the GC, and an omission nobody is told about reads as a
          bug — so it is said here, print:hidden. */}
      {letter.senderNote !== null && (
        <div className="mb-6 rounded-md border border-line-card p-3 print:hidden" data-regret="sender-note">
          <p className="text-sm text-ink-body">{letter.senderNote}</p>
          {bid.declineReason !== null && (
            <p className="mt-1 text-xs text-ink-muted">
              Recorded internally as: {declineLabel(bid.declineReason as DeclineReason)}
              {bid.declineNote ? ` — ${bid.declineNote}` : ""}
            </p>
          )}
        </div>
      )}

      {/* THE LETTER ITSELF. Everything below prints. */}
      <article className="flex flex-col gap-4 text-sm leading-relaxed text-ink-body" data-regret="letter">
        <header className="flex flex-col gap-1">
          <p className="font-semibold text-ink">{company.name}</p>
          <p className="text-ink-muted">{formatCalendarDate(new Date())}</p>
        </header>

        <div className="flex flex-col">
          <p>{bid.contact.name}</p>
          {bid.contact.address && <p className="whitespace-pre-line text-ink-muted">{bid.contact.address}</p>}
        </div>

        <p>{letter.greeting}</p>
        {letter.paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
        <p>{letter.signOff}</p>

        <footer className="mt-6 flex flex-col gap-1">
          <p className="text-ink-muted">Sincerely,</p>
          {/* A NAME IS NOT PRINTED, and that is deliberate: the app does not
              know which person is sending this, and a letter signed by the
              wrong estimator is worse than one signed by hand. The space is
              where a signature goes. */}
          <p className="mt-8 border-t border-line-card pt-1 text-ink-muted">{company.name}</p>
        </footer>
      </article>
    </PageShell>
  );
}
