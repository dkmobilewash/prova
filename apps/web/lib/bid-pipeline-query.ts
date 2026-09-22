import { prisma } from "@prova/db";
import { rankGcs, summariseGc, type GcRecord, type PipelineBid } from "./bid-pipeline";

/**
 * Assembles the pipeline from real rows.
 *
 * Split from lib/bid-pipeline.ts for the reason every other feature here
 * is: the deciding is unit-testable with hand-written inputs, and THIS
 * half -- the part that turns database rows into those inputs -- is where
 * a Decimal, a null or a Date silently becomes the wrong thing. That step
 * had no test at all on the closeout page and it was the one place the
 * feature's headline claim lived.
 */

export interface PipelineRow {
  contactId: string;
  contactName: string;
  record: GcRecord;
}

export interface PipelineOverview {
  rows: PipelineRow[];
  /** Every live invitation across every GC, most urgent first. */
  live: LiveBid[];
}

export interface LiveBid {
  id: string;
  contactId: string;
  contactName: string;
  projectName: string;
  status: "INVITED" | "SUBMITTED";
  dueDate: string | null;
  bidAmount: number | null;
  overdue: boolean;
}

/** Prisma hands back a Date; the rest of the app works in UTC-midnight ISO
 * days. Converting here, once, keeps every comparison downstream a string
 * comparison and out of reach of a local-timezone shift. */
function isoDay(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

export async function loadBidPipeline(
  companyId: string,
  today: string,
): Promise<PipelineOverview> {
  const contacts = await prisma.contact.findMany({
    // THE FILTER BELONGS IN THE WHERE, NOT IN THE LOOP. This read used to
    // be `where: { companyId }` — every contact on the account, with every
    // bid invitation nested under it — and then threw away the ones with no
    // invitations in JavaScript, twenty lines down. A sub's contact book is
    // its vendors, suppliers, architects, inspectors and its GCs; only the
    // last group can ever reach this page, and the others were being read
    // out of Postgres and shipped across the pooler on every render. The
    // nested read is the more expensive half of that: Prisma resolves
    // `bidInvitations` as a second query keyed `WHERE "contactId" IN (…)`,
    // so a discarded contact widens that IN-list too.
    //
    // This matters per SAVE, not just per page load. A Server Action that
    // calls revalidatePath re-renders the whole route (CLAUDE.md, issue
    // #61: action flight is always a root render), so every pursuit added
    // or edited on /pipeline re-ran the entire contact-book scan to redraw
    // a section no pursuit write can change.
    where: { companyId, bidInvitations: { some: {} } },
    select: {
      id: true,
      name: true,
      bidInvitations: {
        select: {
          id: true,
          projectName: true,
          status: true,
          dueDate: true,
          bidAmount: true,
        },
      },
    },
  });

  const rows: PipelineRow[] = [];
  const live: LiveBid[] = [];

  for (const contact of contacts) {
    // A contact with no invitations is not a bidding relationship, and
    // listing every vendor and developer here would bury the GCs who
    // actually invite us. Belt and braces now that the where-clause says
    // the same thing — the same shape lib/moneyRail.ts keeps `isLive` for:
    // the database narrows, and the definition stays here in code where a
    // test can read it.
    if (contact.bidInvitations.length === 0) continue;

    const bids: PipelineBid[] = contact.bidInvitations.map((invitation) => ({
      status: invitation.status,
      bidAmount: invitation.bidAmount === null ? null : Number(invitation.bidAmount),
      dueDate: isoDay(invitation.dueDate),
    }));

    rows.push({
      contactId: contact.id,
      contactName: contact.name,
      record: summariseGc(bids, today),
    });

    for (const invitation of contact.bidInvitations) {
      if (invitation.status !== "INVITED" && invitation.status !== "SUBMITTED") continue;
      const dueDate = isoDay(invitation.dueDate);
      live.push({
        id: invitation.id,
        contactId: contact.id,
        contactName: contact.name,
        projectName: invitation.projectName,
        status: invitation.status,
        dueDate,
        bidAmount: invitation.bidAmount === null ? null : Number(invitation.bidAmount),
        overdue: dueDate !== null && dueDate < today,
      });
    }
  }

  return {
    rows: rankGcs(rows),
    // Soonest deadline first; a bid with no deadline sorts last rather
    // than being given one.
    live: live.sort((a, b) => {
      if (a.dueDate === b.dueDate) return a.projectName.localeCompare(b.projectName);
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }),
  };
}
