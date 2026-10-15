"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { keyMode } from "@/lib/letters/lob";
import { queueLettersForTier1 } from "@/lib/letters/queue";
import { sendQueuedLetters } from "@/lib/letters/send";
import { configFromEnv, letterFor } from "@/lib/letters/template";
import { factFor } from "@/lib/public-works/signals";
import { viewerAsOf } from "@/lib/viewerToday";

/**
 * The buttons on /sales/public-works' Letters strip. Same gate as the page
 * and as runPublicWorksSyncNow: the operating company's owner, nobody else.
 * Each returns a sentence rather than throwing, because production redacts
 * a thrown message and a refused letter needs to say why.
 */
export type LettersActionResult = { ok: true; summary: string } | { ok: false; error: string };

const REFUSAL = "Only C Stream's own owner account can work the letter queue.";

async function operatorOwner(): Promise<boolean> {
  const { company, ...user } = await requireCompanyContext();
  return company.isProvaOperator && user.role === "OWNER";
}

export async function queueTier1Letters(): Promise<LettersActionResult> {
  if (!(await operatorOwner())) return { ok: false, error: REFUSAL };
  try {
    const report = await queueLettersForTier1({ prisma, config: configFromEnv(), today: await viewerAsOf() });
    revalidatePath("/sales/public-works");
    const skipped = Object.entries(report.skipped).map(([why, n]) => `${n} ${why}`);
    return { ok: true, summary: `${report.queued} queued${skipped.length ? ` (${skipped.join("; ")})` : ""}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Queueing failed." };
  }
}

export async function sendQueuedLettersNow(): Promise<LettersActionResult> {
  if (!(await operatorOwner())) return { ok: false, error: REFUSAL };
  const apiKey = process.env.LOB_API_KEY;
  try {
    const report = await sendQueuedLetters({ prisma, config: configFromEnv(), apiKey });
    revalidatePath("/sales/public-works");
    const mode = keyMode(apiKey) === "live" ? "mailed" : "sent to Lob's TEST key — rendered, not mailed";
    return { ok: true, summary: `${report.sent} ${mode}, ${report.failed} failed.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sending failed." };
  }
}

/** The letter as it WOULD read for this firm today — rendered fresh, not the
 * stored body, so the person can read the template before queueing. */
export async function previewLetter(licence: string): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  if (!(await operatorOwner())) return { ok: false, error: REFUSAL };
  const firm = await prisma.publicWorksFirm.findUnique({
    where: { licence },
    select: {
      licence: true, name: true, mailingAddress: true, city: true, zip: true, owners: true,
      signals: { select: { kind: true, project: true, awardingBody: true, primeContractor: true, occurredOn: true } },
    },
  });
  if (!firm) return { ok: false, error: "No such firm." };
  const rendered = letterFor(firm, factFor(firm.signals), configFromEnv());
  return rendered.ok ? { ok: true, body: rendered.body } : rendered;
}
