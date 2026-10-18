import type { PrismaClient } from "@prova/db";
import { createLetter, type LobAddress } from "./lob";
import { letterHtml, type LetterAddress, type LetterConfig } from "./template";

/**
 * Mails what the queue wrote. One Lob call per QUEUED row; SENT with Lob's
 * id and delivery estimate, or FAILED with the sentence Lob gave.
 *
 * Safe to press twice. A SENT row is never selected again, and the
 * `Idempotency-Key` on every call is the row's own id — so a call that
 * reached Lob but whose response was lost (timeout, redeploy) is answered
 * on retry with the ORIGINAL letter, not a second one. A FAILED row stays
 * failed; the person reads the error and decides, because retrying a
 * refused address a hundred times is money, not persistence.
 */

export type SendReport = { sent: number; failed: number };

export function lobAddress(a: LetterAddress): LobAddress {
  return { name: a.name, ...(a.company ? { company: a.company } : {}), address_line1: a.line1, address_city: a.city, address_state: a.state, address_zip: a.zip };
}

export async function sendQueuedLetters(deps: {
  prisma: PrismaClient;
  config: LetterConfig;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  limit?: number;
  now?: () => Date;
}): Promise<SendReport> {
  const { prisma, config } = deps;
  const now = deps.now ?? (() => new Date());
  const queued = await prisma.publicWorksLetter.findMany({
    where: { status: "QUEUED" },
    orderBy: { queuedAt: "asc" },
    take: deps.limit ?? 50,
    select: { id: true, body: true, toAddress: true, signalFact: true, firm: { select: { name: true, licence: true } } },
  });
  const report: SendReport = { sent: 0, failed: 0 };
  const from: LobAddress = { name: config.fromName, company: "C Stream, Inc.", address_line1: config.fromAddress.line1, address_city: config.fromAddress.city, address_state: config.fromAddress.state, address_zip: config.fromAddress.zip };
  for (const letter of queued) {
    const result = await createLetter(
      {
        to: lobAddress(letter.toAddress as LetterAddress),
        from,
        html: letterHtml(letter.body),
        description: `${letter.firm.name} (CSLB ${letter.firm.licence}) — ${letter.signalFact}`,
        idempotencyKey: letter.id,
      },
      { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl },
    );
    if (result.ok) {
      await prisma.publicWorksLetter.update({
        where: { id: letter.id },
        data: { status: "SENT", lobId: result.id, sentAt: now(), expectedDeliveryOn: result.expectedDeliveryOn ? new Date(`${result.expectedDeliveryOn}T00:00:00Z`) : null, error: null },
      });
      report.sent++;
    } else {
      await prisma.publicWorksLetter.update({ where: { id: letter.id }, data: { status: "FAILED", error: result.error } });
      report.failed++;
    }
  }
  return report;
}
