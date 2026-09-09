"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { viewerToday } from "@/lib/viewerToday";
import { refusalFor } from "@/lib/ask/access";
import {
  canRunCommand,
  commandNamed,
  isCommandName,
  type Link,
  type PreviewLine,
  type ResolvedPayload,
} from "@/lib/ask/commands";
import type { ProposalView } from "@/lib/ask/answer";
import { actionOk, type ActionResult, type ActionResultWith } from "./shared";

/**
 * The tap.
 *
 * Ask streams over a route handler, but the WRITE is a Server Action, on
 * purpose. A route-handler fetch carries no flight data, so a write made
 * there leaves the page beneath the box stale until a reload — the exact
 * #61 symptom. A Server Action that calls revalidatePath re-renders the
 * page on its own (CLAUDE.md traces why), so the list under the panel
 * shows the new job with no router.refresh() and no reload.
 *
 * What this does, in order, and why the order is the safety:
 *   1. finds the row for THIS company and THIS person — a proposal is
 *      confirmable only by whoever asked for it;
 *   2. refuses anything already settled, expired, or withdrawn;
 *   3. checks the capability again (the list the model saw was filtered;
 *      this is the boundary);
 *   4. CLAIMS the row with an updateMany guarded on `claimedAt IS NULL` —
 *      the NotificationDispatch pattern. Two taps, two tabs, or a retried
 *      POST produce one write and one "already done";
 *   5. executes with the SERVER-HELD payload. Nothing the browser sent
 *      beyond the id is read.
 */
export async function confirmAskProposal(
  proposalId: string,
): Promise<ActionResultWith<{ message: string; created?: Link }>> {
  const context = await requireCompanyContext();
  const principal = { role: context.role, jobFunction: context.jobFunction };
  const companyId = context.company.id;
  const now = new Date();

  const row = await prisma.askProposal.findFirst({
    where: { id: proposalId, companyId },
  });
  // One sentence for "no such row" and "somebody else's row": a card id is
  // a 192-bit token, and confirming another person's proposal is the one
  // thing this must never do, so it is not worth distinguishing.
  if (!row || row.createdByUserId !== context.id) {
    return fail("That card isn't one you can confirm. Ask again.");
  }
  if (row.outcome === "OK") return fail("Already done.");
  if (row.outcome === "CANCELLED") return fail("That one was cancelled. Ask again if you still want it.");
  if (row.outcome === "REFUSED") {
    return fail(row.outcomeNote ? `That one can't be done: ${row.outcomeNote}` : "That one can't be done.");
  }
  if (row.outcome === "FAILED") return fail("That one failed earlier. Ask again.");
  if (row.expiresAt < now) {
    return fail("That card has expired. Ask again and confirm within half an hour.");
  }
  if (!isCommandName(row.command)) {
    return fail("That command no longer exists. Ask again.");
  }

  const command = commandNamed(row.command);
  if (!canRunCommand(principal, command)) {
    await stamp(row.id, { outcome: "REFUSED", outcomeNote: refusalFor(command.capability) });
    return fail(refusalFor(command.capability));
  }

  const claimed = await prisma.askProposal.updateMany({
    where: { id: row.id, claimedAt: null },
    data: { claimedAt: now },
  });
  if (claimed.count === 0) {
    return fail("Already done. That card was confirmed a moment ago.");
  }

  const ctx = { companyId, userId: context.id, principal, today: await viewerToday() };

  let executed: Awaited<ReturnType<typeof command.execute>>;
  try {
    executed = await command.execute(ctx, row.resolved as ResolvedPayload);
  } catch (err) {
    // A throw here is a bug, not an expected refusal: the cores return
    // their sentences. Record it and say so without inventing a sentence
    // about what was or was not saved.
    console.error(`[ask] ${command.name} threw during execute`, err);
    await stamp(row.id, { outcome: "FAILED", outcomeNote: "threw during execute" });
    return fail(`${command.button} did not complete. Check the page before trying again.`);
  }

  if (!executed.ok) {
    await stamp(row.id, { outcome: "FAILED", outcomeNote: executed.error.slice(0, 1000) });
    return fail(executed.error);
  }

  await stamp(row.id, {
    outcome: "OK",
    targetType: executed.created?.targetType ?? null,
    targetId: executed.created?.targetId ?? null,
  });

  // The dashboard's ESTIMATE list, the contacts page (a GC may have been
  // added), the jobs list, and the created record's own page.
  revalidatePath("/dashboard");
  revalidatePath("/contacts");
  revalidatePath("/jobs");
  if (executed.created) revalidatePath(executed.created.href);

  return {
    ok: true,
    value: {
      message: executed.message,
      created: executed.created ? { label: executed.created.label, href: executed.created.href } : undefined,
    },
  };
}

/** Withdraws a card. Idempotent and quiet: a card that is already settled
 * stays as it is, and a card that is not yours reads as nothing to do. */
export async function cancelAskProposal(proposalId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  await prisma.askProposal.updateMany({
    where: {
      id: proposalId,
      companyId: context.company.id,
      createdByUserId: context.id,
      claimedAt: null,
      outcome: null,
    },
    data: { outcome: "CANCELLED" },
  });
  return actionOk;
}

/**
 * Reattaches a card after a phone browser has been backgrounded or the
 * tab reloaded. Returns only a card that is still the asking person's own,
 * unsettled, unclaimed and unexpired; everything else is a quiet failure
 * the panel answers by forgetting the id. What comes back is what the row
 * holds: the preview lines the person already saw. Warnings were shown
 * once and are not stored, so a reattached card carries none.
 */
export async function loadAskProposal(
  proposalId: string,
): Promise<ActionResultWith<{ question: string; proposal: ProposalView }>> {
  const context = await requireCompanyContext();
  const row = await prisma.askProposal.findFirst({
    where: { id: proposalId, companyId: context.company.id },
  });
  if (!row || row.createdByUserId !== context.id) return fail("That card isn't one you can reopen.");
  if (row.outcome || row.claimedAt) return fail("That card is already settled.");
  if (row.expiresAt < new Date()) return fail("That card has expired. Ask again.");
  if (!isCommandName(row.command)) return fail("That command no longer exists. Ask again.");
  const command = commandNamed(row.command);
  return {
    ok: true,
    value: {
      question: row.question,
      proposal: {
        proposalId: row.id,
        command: command.name,
        title: command.title,
        button: command.button,
        mode: command.mode,
        preview: Array.isArray(row.preview) ? (row.preview as PreviewLine[]) : [],
        warnings: [],
        alsoRequested: [],
        expiresAt: row.expiresAt.toISOString(),
      },
    },
  };
}

async function stamp(
  id: string,
  data: { outcome: "OK" | "REFUSED" | "FAILED"; outcomeNote?: string; targetType?: string | null; targetId?: string | null },
) {
  await prisma.askProposal.update({ where: { id }, data });
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
