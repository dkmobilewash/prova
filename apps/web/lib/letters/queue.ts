import type { PrismaClient } from "@prova/db";
import { factFor, tierFor, type Signal } from "@/lib/public-works/signals";
import { letterFor, TEMPLATE_KEY, type LetterConfig, type LetterFirm } from "./template";

/**
 * Which firms get a letter: tier 1 (in market THIS week, derived from the
 * signals as the page derives it), a complete CSLB mailing address, and no
 * letter on record that opened with the same fact. Nothing here is stored
 * about eligibility — the row that comes out of it is the record.
 *
 * Pure, so the test can hand it firms and watch what it picks.
 */

export type QueueCandidate = LetterFirm & {
  signals: Signal[];
  letters: Array<{ signalFact: string }>;
};

export type QueueDecision = { firm: QueueCandidate; fact: string; body: string; toAddress: unknown } | { firm: QueueCandidate; skipped: string };

export function decideLetters(firms: QueueCandidate[], config: LetterConfig, today: Date): QueueDecision[] {
  return firms.map((firm) => {
    if (tierFor(firm.signals, today) !== 1) return { firm, skipped: "not in market this week" };
    const fact = factFor(firm.signals);
    if (firm.letters.some((l) => l.signalFact === fact)) return { firm, skipped: "already written to about this filing" };
    const rendered = letterFor(firm, fact, config);
    if (!rendered.ok) return { firm, skipped: rendered.error };
    return { firm, fact, body: rendered.body, toAddress: rendered.toAddress };
  });
}

export type QueueReport = { queued: number; skipped: Record<string, number> };

export async function queueLettersForTier1(deps: { prisma: PrismaClient; config: LetterConfig; today: Date; limit?: number }): Promise<QueueReport> {
  const { prisma, config, today } = deps;
  const limit = deps.limit ?? 200;
  // Only firms with any signal can be tier 1, so the query already drops
  // the ~6,000 silent ones rather than fetching them to reject.
  const firms = await prisma.publicWorksFirm.findMany({
    where: { signals: { some: {} } },
    select: {
      licence: true, name: true, mailingAddress: true, city: true, zip: true, owners: true,
      signals: { select: { kind: true, project: true, awardingBody: true, primeContractor: true, occurredOn: true } },
      letters: { select: { signalFact: true } },
    },
  });
  const report: QueueReport = { queued: 0, skipped: {} };
  for (const d of decideLetters(firms, config, today)) {
    if ("skipped" in d) {
      report.skipped[d.skipped] = (report.skipped[d.skipped] ?? 0) + 1;
      continue;
    }
    if (report.queued >= limit) {
      report.skipped["over this run's limit"] = (report.skipped["over this run's limit"] ?? 0) + 1;
      continue;
    }
    await prisma.publicWorksLetter.create({
      data: { licence: d.firm.licence, signalFact: d.fact, templateKey: TEMPLATE_KEY, body: d.body, toAddress: d.toAddress as object },
    });
    report.queued++;
  }
  return report;
}
