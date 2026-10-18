"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { loadThread, TITLE_CHARS, type LoadedThread } from "@/lib/ask/threads";
import { actionFail, actionOk, type ActionResult, type ActionResultWith } from "./shared";

/**
 * The person's own conversations with the assistant: open, rename, delete.
 *
 * Every one is scoped by the SESSION's company AND person, and a thread that
 * is not theirs gets the same sentence as one that does not exist — so
 * nothing here confirms another person's thread is there. Results, never
 * throws: production redacts a thrown action message.
 *
 * Delete is a real delete, unlike sent correspondence. A thread is somebody's
 * scratch thinking, not evidence, and the person asked for it gone.
 */

const NOT_YOURS = "That conversation isn't one you can open.";

export async function loadAskThread(threadId: string): Promise<ActionResultWith<LoadedThread>> {
  const context = await requireCompanyContext();
  if (typeof threadId !== "string" || !threadId) return { ok: false, error: NOT_YOURS };
  const thread = await loadThread(threadId, context.companyId, context.id);
  return thread ? { ok: true, value: thread } : { ok: false, error: NOT_YOURS };
}

export async function renameThread(threadId: string, title: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const clean = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  if (!clean) return actionFail("Give the conversation a name.");
  if (clean.length > TITLE_CHARS) return actionFail(`Keep the name to ${TITLE_CHARS} characters or fewer.`);
  const { count } = await prisma.askThread.updateMany({
    where: { id: threadId, companyId: context.companyId, userId: context.id },
    data: { title: clean },
  });
  if (count === 0) return actionFail(NOT_YOURS);
  revalidatePath("/ask");
  revalidatePath("/ai");
  return actionOk;
}

export async function deleteThread(threadId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  // Messages go with it (AskMessage cascades from AskThread).
  const { count } = await prisma.askThread.deleteMany({
    where: { id: threadId, companyId: context.companyId, userId: context.id },
  });
  if (count === 0) return actionFail(NOT_YOURS);
  revalidatePath("/ask");
  revalidatePath("/ai");
  return actionOk;
}
