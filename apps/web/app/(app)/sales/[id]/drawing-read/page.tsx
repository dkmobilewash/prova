import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";

import { DrawingSetReadSend } from "@/components/DrawingSetReadSend";
import { requireCompanyContext } from "@/lib/auth";
import { toIsoDate } from "@/lib/compliance-expiry";
import { deliveredReadFor, readCandidates } from "@/lib/drawing-set-read-query";
import { deliveryBody, deliverySubjectLine } from "@/lib/takeoff-delivery";

/**
 * TURNING A FINISHED DRAWING-SET READ INTO THE EMAIL WE SEND A PROSPECT.
 *
 * The other half of `/wall-takeoff`. A contractor sends us the set they are
 * bidding; we create a job on our OWN company, upload their PDF and run the
 * plan-ingest pipeline over it. This page is where the operator looks at what
 * came off it, next to what the contractor asked for, and mails it back.
 *
 * `lib/takeoff-delivery.ts` had 44 passing tests and nothing in the app called
 * it — CLAUDE.md's "written, documented, and never called", which it records
 * three live instances of in a single day, every one green because nothing
 * referenced the dead code. This page and `lib/drawing-set-read-query.ts` are
 * its call site.
 *
 * ── THE TEXT ON SCREEN IS THE TEXT THAT GETS SENT ──
 *
 * The subject and body below come from `deliverySubjectLine` and
 * `deliveryBody`, which is what `sendDrawingSetRead` calls too. Not a preview
 * of the mail: the mail. A screen that paraphrased it would be the second copy
 * CLAUDE.md records shipping a bid $1,732.50 under the screen that shared its
 * source, and the audience here is a stranger comparing our email to our own
 * page.
 *
 * It is on screen BEFORE the send rather than after because this is the first
 * thing a prospective customer ever receives from us, and the gaps section at
 * the top of that body ("pages 14 and 15 are scans") is the part the operator
 * may want to say something about in person first.
 *
 * ── THE GATE IS /sales's GATE, THE SAME TWO CHECKS IN THE SAME ORDER ──
 *
 * Tenant identity, then person identity. A non-operator company gets
 * `notFound()` — the same answer as a lead that does not exist — because this
 * feature does not exist for them and an authorization message would be a
 * stranger lie than silence; `assertSalesAccess` in `lib/actions/sales.ts`
 * argues that at length and this mirrors it. A member at the operator company
 * gets the real reason.
 *
 * Then the lead itself: read by its id and refused unless its `companyId`
 * matches. `deliveredReadFor` makes that check again on both ids it is given,
 * because an id in a URL is a claim and the action behind the button is
 * reachable without this page ever having rendered.
 *
 * ── WHY THE CHOSEN SET IS A SEARCH PARAM ──
 *
 * `?plan=` keeps the whole thing a server render: picking a set re-renders the
 * page with the real composed text in it, with no client state to disagree
 * with what the action will compose, and the URL is linkable — an operator can
 * send themselves the exact screen they were looking at. The plan id in it is
 * proved by `deliveredReadFor` and nothing else is read from the URL.
 */
export default async function DrawingSetReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ plan?: string }>;
}) {
  const { id } = await params;
  const { plan: planParam } = await searchParams;
  const { company, ...currentUser } = await requireCompanyContext();

  if (!company.isProvaOperator) {
    notFound();
  }

  if (currentUser.role !== "OWNER") {
    return (
      <PageShell width="reading">
        <h1 className="mb-2 text-xl font-semibold text-ink">Owner only</h1>
        <p className="text-sm text-ink-body">
          The sales CRM is restricted to the account owner, same as Team management and billing
          settings.
        </p>
      </PageShell>
    );
  }

  const lead = await prisma.salesLead.findUnique({
    where: { id },
    include: {
      activities: {
        where: { type: "NOTE" },
        // Oldest first: the intake note written by `/wall-takeoff` is the
        // first thing on the lead, and it is the one that says what they
        // asked for. Anything logged since is somebody's follow-up.
        orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
        take: 1,
        select: { id: true, summary: true, occurredOn: true },
      },
    },
  });

  if (!lead || lead.companyId !== company.id) {
    notFound();
  }

  const candidates = await readCandidates(company.id);
  // Taken as given and PROVED by `deliveredReadFor`, not validated against the
  // candidate list above — that list is capped at the newest 25, and a URL
  // somebody saved for an older set must still render rather than silently
  // showing them the picker again. Ownership is the only thing that decides
  // whether this id resolves.
  const chosenPlanId = planParam?.trim() || null;
  // Loaded through the same function the action uses, so the screen cannot
  // show a read the send would refuse to compose.
  const read = chosenPlanId ? await deliveredReadFor(lead.id, chosenPlanId, company.id) : null;
  // The pair, so the send control cannot be handed a plan id the read above
  // was not composed from. Narrowing two nullable values separately is how a
  // screen ends up offering to send one set's text under another set's id.
  const chosen = chosenPlanId !== null && read !== null ? { planId: chosenPlanId, read } : null;
  const intakeNote = lead.activities[0] ?? null;

  return (
    <PageShell width="reading">
      <h1 className="text-lg font-semibold text-ink">Send the drawing-set read</h1>
      <p className="mt-1 text-sm leading-relaxed text-ink-body">
        {lead.companyName}
        {lead.contactName ? ` — ${lead.contactName}` : ""}
        {lead.email ? ` — ${lead.email}` : " — no email address on file"}
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        <Link href={`/sales/${lead.id}`} className="text-link hover:text-link-hover">
          Back to the lead
        </Link>
      </p>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-ink">What they asked for</h2>
        {intakeNote ? (
          <div className="mt-2 rounded-lg border border-line-card bg-surface p-4">
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-body">
              {intakeNote.summary}
            </p>
            <p className="mt-3 text-xs text-ink-muted">Logged {toIsoDate(intakeNote.occurredOn)}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-ink-body">
            Nothing is written down on this lead. That means nobody recorded what they wanted, not
            that they wanted nothing — read the drawing set below before you send anything.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-ink">Which set did they send?</h2>
        {candidates.length === 0 ? (
          <div className="mt-2 rounded-lg border border-line-card bg-surface p-4">
            <p className="text-sm leading-relaxed text-ink-body">
              There is no drawing set on this company yet, so there is nothing to read back. The
              set has to arrive as a job before the pipeline can touch it: create a job for it
              here, open its Takeoff tab, upload their PDF, and run the ingest. Then this page will
              list it.
            </p>
            <p className="mt-3 text-sm">
              <Link href="/jobs/new" className="text-link hover:text-link-hover">
                Create the job for their set
              </Link>
            </p>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm leading-relaxed text-ink-body">
              The newest sets on our own company. A set showing 0 sheets has not been through the
              pipeline yet — there would be nothing in the email.
            </p>
            <ul className="mt-2 divide-y divide-line-row border-y border-line-row">
              {candidates.map((candidate) => {
                const chosen = candidate.planId === chosenPlanId;
                return (
                  <li key={candidate.planId} className="py-3">
                    <Link
                      href={`/sales/${lead.id}/drawing-read?plan=${candidate.planId}`}
                      className="flex min-h-[48px] flex-col justify-center"
                      aria-current={chosen ? "true" : undefined}
                    >
                      <span
                        className={
                          chosen
                            ? "text-sm font-semibold text-ink"
                            : "text-sm font-semibold text-link hover:text-link-hover"
                        }
                      >
                        {candidate.fileName ?? "Unnamed file"}
                        {chosen ? " — chosen" : ""}
                      </span>
                      <span className="mt-0.5 text-xs text-ink-muted">
                        {candidate.jobName} · uploaded {toIsoDate(candidate.uploadedAt)} ·{" "}
                        {candidate.sheetCount}{" "}
                        {candidate.sheetCount === 1 ? "sheet" : "sheets"} ·{" "}
                        {candidate.scheduleCount}{" "}
                        {candidate.scheduleCount === 1 ? "schedule sheet" : "schedule sheets"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* NO EMPTY `<pre>` ANYWHERE BELOW. With no set chosen there is no mail,
          and an empty monospace box reads as a render that failed rather than
          as a question that has not been answered yet. */}
      {chosen === null ? (
        candidates.length > 0 && (
          <p className="mt-8 text-sm leading-relaxed text-ink-body">
            Pick the set above and the email we would send appears here, word for word, with the
            control to send it.
          </p>
        )
      ) : (
        <section className="mt-8">
          <h2 className="text-base font-semibold text-ink">The email, word for word</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-body">
            This is the text itself, not a preview of it &mdash; the send composes it from the same
            two functions. Plain text, no attachment and no link, for the deliverability reasons
            written into <span className="font-mono text-xs">lib/takeoff-delivery.ts</span>.
          </p>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-label">
            Subject
          </p>
          <p className="mt-1 break-words font-mono text-sm text-ink">
            {deliverySubjectLine(chosen.read)}
          </p>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-label">Body</p>
          {/* `whitespace-pre-wrap` rather than a bare `<pre>`'s overflow: the
              body is space-padded columns, and a horizontal scrollbar is how
              half an index gets copied without the rows below the fold. */}
          <pre className="mt-1 select-all whitespace-pre-wrap break-words rounded-lg border border-line-card bg-surface p-4 font-mono text-xs leading-relaxed text-ink">
            {deliveryBody(chosen.read)}
          </pre>

          <div className="mt-5">
            <DrawingSetReadSend leadId={lead.id} planId={chosen.planId} />
          </div>
        </section>
      )}
    </PageShell>
  );
}
