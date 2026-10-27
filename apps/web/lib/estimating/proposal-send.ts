import type { BidFormSections, ProposalPresentation } from "@/lib/estimating/proposal-presentation";

/**
 * SENDING THE PROPOSAL TO ONE GC, FROM C STREAM BID — the decisions, pure.
 *
 * The action is `sendBidProposal` in `lib/actions/messages.ts` (it shares the
 * one implementation of "write the record before the provider is reached" with
 * every other outbound send). The rows are read by
 * `lib/estimating/proposal-send-query.ts`. Everything here is a decision a test
 * can reach without a database.
 *
 * ── WHAT IS ACTUALLY SENT, SAID PLAINLY ──
 *
 * A plain-text email: the person's short cover note, then THE PROPOSAL ITSELF
 * AS TEXT — title, scope, the price in the presentation they chose, the GC's
 * alternates and unit prices, and every clause. NO PDF IS ATTACHED and NO LINK
 * is included, because neither exists to use:
 *
 *   - this app generates no PDF on the server. The proposal page is print-
 *     styled HTML saved through the browser (its own header says so), and the
 *     bid package is merged in the browser and stores nothing;
 *   - there is no public share link for a proposal. `/portal/[token]` is a
 *     client's view of CONTRACTED jobs, not of bids.
 *
 * The text is built from the SAME presentation the page prints
 * (`proposalPresentation`, `bidFormSections`, `groupProposalClauses`) — the
 * same numbers in a second format, never a second calculation. And it is built
 * BY THE SERVER at send time from the rows, never accepted from the form, so
 * the copy recorded on `OutboundMessage.body` is exactly what the GC received.
 * A PDF still goes through the bid package builder below it on the same page.
 */

/** The polymorphic link on `OutboundMessage`, shared with `submitBidPackage`
 *  so both kinds of send count as "this bid went out" (`lib/bid/guide/facts.ts`). */
export const BID_INVITATION_RELATED_TYPE = "BID_INVITATION";

/** "Proposal — Riverside Medical — Cyrus Drywall". The project first, because
 *  that is what a GC with forty bid-day emails sorts by. */
export function proposalSendSubject(projectName: string, companyName: string): string {
  return `Proposal — ${projectName} — ${companyName}`;
}

/** The editable cover note. Short on purpose: the terms are in the proposal
 *  under it, and a long letter is one somebody must re-read before every send. */
export function proposalCoverNote(input: { gcName: string; projectName: string; companyName: string }): string {
  return [
    `Hello ${input.gcName},`,
    "",
    `Our proposal for ${input.projectName} is below. Please confirm you've received it.`,
    "",
    "Thank you,",
    input.companyName,
  ].join("\n");
}

/** The line between the cover note and the document, so the record reads as two parts. */
export const PROPOSAL_DIVIDER = "────────────────────────────────────────";

export type ProposalDocument = {
  title: string;
  companyName: string;
  addressedTo: string;
  /** Already formatted for the reader, e.g. "10/27/2026". */
  dateLabel: string;
  location: string | null;
  scope: string | null;
  presentation: ProposalPresentation;
  bidForm: BidFormSections | null;
  clauseGroups: { heading: string; texts: string[] }[];
};

/**
 * The proposal as plain text, in the order the printed page reads.
 *
 * `format` is injected (it is `money` in the app) so this module carries no
 * formatter of its own and prints exactly what the page prints.
 */
export function proposalEmailText(document: ProposalDocument, format: (dollars: number) => string): string {
  const out: string[] = [];
  const section = (heading: string) => {
    out.push("", heading.toUpperCase());
  };

  out.push(`PROPOSAL — ${document.title}`);
  out.push(`${document.companyName} to ${document.addressedTo} · ${document.dateLabel}`);
  if (document.location) out.push(document.location);

  if (document.scope?.trim()) {
    section("Scope of work");
    out.push(document.scope.trim());
  }

  const presentation = document.presentation;
  section(presentation.mode === "itemized" ? "Schedule of values" : "Price");
  if (presentation.mode === "itemized") {
    for (const row of presentation.rows) {
      const qty = `${row.quantity}${row.unit ? ` ${row.unit}` : ""}`;
      const unit = row.unitPrice != null ? format(row.unitPrice) : "—";
      const total = row.total != null ? format(row.total) : "—";
      out.push(`${row.description} — ${qty} @ ${unit} = ${total}`);
    }
    if (presentation.adjustmentCents !== null) {
      out.push(`Price adjustment: ${presentation.adjustmentCents < 0 ? "−" : ""}${format(Math.abs(presentation.adjustmentCents) / 100)}`);
    }
    out.push(`Total bid: ${format(presentation.total)}`);
  } else {
    for (const row of presentation.rows) {
      const label = presentation.mode === "lump" ? "Lump sum for the work described in this proposal" : row.label;
      out.push(`${label}: ${format(row.amountCents / 100)}`);
    }
    if (presentation.mode === "scope") out.push(`Total bid: ${format(presentation.total)}`);
  }

  if (document.bidForm && document.bidForm.alternates.length > 0) {
    section("Alternates");
    for (const row of document.bidForm.alternates) {
      out.push(`${row.label}${row.description ? ` — ${row.description}` : ""}: ${row.price}`);
    }
  }
  if (document.bidForm && document.bidForm.unitPrices.length > 0) {
    section("Unit prices");
    for (const row of document.bidForm.unitPrices) {
      out.push(`${row.label}${row.description ? ` — ${row.description}` : ""}: ${row.price}`);
    }
  }

  for (const group of document.clauseGroups) {
    if (group.texts.length === 0) continue;
    section(group.heading);
    for (const text of group.texts) out.push(`- ${text}`);
  }

  return out.join("\n");
}

/** The whole body that goes out and is recorded: the note, a divider, the document. */
export function proposalEmailBody(coverNote: string, documentText: string): string {
  return `${coverNote.trim()}\n\n${PROPOSAL_DIVIDER}\n\n${documentText}`;
}

/**
 * ── A PREVIEW MUST NEVER EMAIL A REAL GC ──
 *
 * Null ONLY on Vercel's production environment. Everything else refuses with a
 * sentence: a preview (which runs on the demo database, whose contacts may
 * carry real-looking addresses), a development deployment, a laptop, CI.
 *
 * WHY THIS LIVES HERE AND NOT IN `sendEmail`: the existing pipeline has no such
 * guard — `packages/integrations/src/email.ts` sends wherever `RESEND_API_KEY`
 * and `OUTBOUND_EMAIL_FROM` are set — and changing what every RFI, digest and
 * help request does on a preview is a different decision from this feature.
 * So this send refuses on its own terms and the gap is reported, not widened.
 *
 * NO ESCAPE HATCH, deliberately — the same call `vitest.db.setup.mts` makes for
 * the scratch-database guard. A variable that lets a preview send is a variable
 * somebody sets once to test and forgets.
 */
export function deploymentSendRefusal(env: Record<string, string | undefined>): string | null {
  if (env.VERCEL_ENV === "production") return null;
  const where = env.VERCEL_ENV === "preview" ? "a preview" : env.VERCEL_ENV ? `the ${env.VERCEL_ENV} deployment` : "this copy of the app";
  return `Proposals are only emailed from the live app. This is ${where}, so nothing is sent from here — a test copy must never reach a real GC.`;
}

export type SendableInvitationStatus = "INVITED" | "SUBMITTED" | "WON" | "LOST" | "DECLINED";

const CLOSED_WORDS: Record<"WON" | "LOST" | "DECLINED", string> = {
  WON: "won",
  LOST: "lost",
  DECLINED: "declined",
};

/**
 * Why this proposal cannot be sent to this GC right now, or null when it can.
 * One sentence, in the order a person would fix them — the deployment and the
 * install's sending first (nothing on this screen fixes those), then the bid.
 */
export function proposalSendBlocker(input: {
  deploymentProblem: string | null;
  setupProblem: string | null;
  status: SendableInvitationStatus;
  lineCount: number;
  totalCents: number;
  recipientProblem: string | null;
}): string | null {
  if (input.deploymentProblem) return input.deploymentProblem;
  if (input.setupProblem) return input.setupProblem;
  if (input.status === "WON" || input.status === "LOST" || input.status === "DECLINED") {
    return `This bid is marked ${CLOSED_WORDS[input.status]}, so there is no proposal to send for it.`;
  }
  if (input.lineCount === 0 || input.totalCents <= 0) {
    return "There's no price on this proposal yet. Price it on the estimate, then send it.";
  }
  if (input.recipientProblem) return input.recipientProblem;
  return null;
}

/**
 * The price the person was looking at, as the form carried it, against the
 * price the server works out now. A different figure means the estimate moved
 * after the page loaded, and the email must not carry a number nobody read.
 * Whole cents, compared exactly; anything unreadable is a mismatch.
 */
export function priceStillMatches(shown: string, nowCents: number): boolean {
  if (!/^-?\d+$/.test(shown.trim())) return false;
  return Number(shown.trim()) === nowCents;
}
