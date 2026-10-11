import { prisma, type Prisma } from "@prova/db";
import type { AskStreamEvent } from "./answer";
import { boundTurns, type AskTurn } from "./turns";
import { TITLE_CHARS } from "./transcript";

/**
 * Conversations that outlive the tab: AskThread + AskMessage.
 *
 * SCOPE. A thread is ONE PERSON'S, inside one company — every read and every
 * write below names both `companyId` and `userId`, and a thread that is not
 * the caller's reads as "no such thread" (null), never as an error that would
 * confirm it exists. See the AskThread model comment for why a colleague
 * continuing it would be wrong rather than helpful.
 *
 * WHAT IS STORED. The person's words and the assistant's FINAL text, plus the
 * citations it read and the card id when it halted on one. Never a tool
 * result: memory carries the conversation and never the facts
 * (lib/ask/turns.ts), and a stored tool dump would be exactly the stale
 * figure that rule exists to keep out of a later answer.
 */

export type ThreadSummary = {
  id: string;
  title: string;
  lastMessageAt: Date;
  subjectType: string | null;
  subjectId: string | null;
};

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cites: unknown | null;
  proposalId: string | null;
  createdAt: Date;
};

export type LoadedThread = { id: string; title: string; messages: ThreadMessage[] };

export { TITLE_CHARS };

/** How much of a long thread is loaded. ponytail: the newest 100 messages —
 * the model only ever sees the last MAX_TURNS of them anyway; page older ones
 * in if somebody keeps one thread going for months. */
export const LOAD_MESSAGES = 100;

/** Stored content is bounded like everything else that reaches a prompt. */
const MAX_CONTENT_CHARS = 8_000;

const SUMMARY_SELECT = {
  id: true,
  title: true,
  lastMessageAt: true,
  subjectType: true,
  subjectId: true,
} as const;

/** The first question as a title: one line, at most 60 characters cut at a
 * word, first letter capitalised (the rest left alone — "Cedar Park" stays
 * a name), and no trailing punctuation, so a cut never ends on "…" or "?". */
export function titleFor(firstQuestion: string): string {
  let flat = firstQuestion.replace(/\s+/g, " ").trim();
  if (flat.length > TITLE_CHARS) {
    const cut = flat.slice(0, TITLE_CHARS);
    const space = cut.lastIndexOf(" ");
    flat = space > TITLE_CHARS / 2 ? cut.slice(0, space) : cut;
  }
  flat = flat.replace(/[\s\p{P}]+$/u, "");
  if (!flat) return "New conversation";
  return flat[0].toUpperCase() + flat.slice(1);
}

export async function listRecentThreads(
  companyId: string,
  userId: string,
  limit = 10,
): Promise<ThreadSummary[]> {
  return prisma.askThread.findMany({
    where: { companyId, userId },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: SUMMARY_SELECT,
  });
}

/**
 * The threads started on one record — a bid, a job.
 *
 * `userId` is REQUIRED, which the first draft of this contract left out. A
 * subject list without it would show one estimator's half-finished thinking
 * to everyone who opens the same bid, and the model comment on AskThread is
 * explicit that a thread is the person's own.
 */
export async function listThreadsForSubject(
  companyId: string,
  subjectType: string,
  subjectId: string,
  userId: string,
): Promise<ThreadSummary[]> {
  return prisma.askThread.findMany({
    where: { companyId, userId, subjectType, subjectId },
    orderBy: { lastMessageAt: "desc" },
    take: 20,
    select: SUMMARY_SELECT,
  });
}

export async function loadThread(
  threadId: string,
  companyId: string,
  userId: string,
): Promise<LoadedThread | null> {
  const row = await prisma.askThread.findFirst({
    where: { id: threadId, companyId, userId },
    select: {
      id: true,
      title: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: LOAD_MESSAGES,
        select: { id: true, role: true, content: true, cites: true, proposalId: true, createdAt: true },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    messages: row.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .reverse()
      .map((m) => ({ ...m, role: m.role as "user" | "assistant", cites: m.cites ?? null })),
  };
}

export async function createThread(
  companyId: string,
  userId: string,
  firstQuestion: string,
  subject?: { type: string; id: string },
): Promise<{ id: string; title: string }> {
  return prisma.askThread.create({
    data: {
      companyId,
      userId,
      title: titleFor(firstQuestion),
      subjectType: subject?.type ?? null,
      subjectId: subject?.id ?? null,
    },
    select: { id: true, title: true },
  });
}

/** One write: the message and the thread's lastMessageAt together, so the
 * Recent list cannot disagree with what is in the thread. Callers have
 * already scoped `threadId` to the session's company and person. */
export async function appendMessage(
  threadId: string,
  msg: { role: "user" | "assistant"; content: string; cites?: unknown; proposalId?: string | null },
): Promise<void> {
  const now = new Date();
  await prisma.askThread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: now,
      messages: {
        create: {
          role: msg.role,
          content: msg.content.slice(0, MAX_CONTENT_CHARS),
          ...(msg.cites !== undefined && msg.cites !== null ? { cites: msg.cites as Prisma.InputJsonValue } : {}),
          proposalId: msg.proposalId ?? null,
          createdAt: now,
        },
      },
    },
  });
}

/**
 * Stored messages as the wire-format turns api/ask already accepts.
 *
 * Only COMPLETE exchanges: a question whose answer never arrived (an error,
 * a closed tab) is dropped with its missing reply, so the model is never
 * handed two user turns in a row. Then boundTurns, the same bound a browser's
 * turns get — six turns, 2,000 characters each.
 */
export function priorTurnsFrom(messages: readonly { role: string; content: string }[]): AskTurn[] {
  const pairs: AskTurn[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const q = messages[i];
    const a = messages[i + 1];
    if (q.role === "user" && a.role === "assistant") {
      pairs.push({ role: "user", content: q.content }, { role: "assistant", content: a.content });
      i++;
    }
  }
  return boundTurns(pairs);
}

/**
 * The answer stream, with the thread written alongside it.
 *
 * Emits `{ type: "thread" }` first so the browser learns the id before any
 * model time is spent, then passes every event through untouched. The
 * assistant's turn is recorded when the stream reaches its end state —
 * `done` (the final text and its citations), `proposal` (the card's title
 * and id) or `clarify` (the question it asked back). An `error` or an abort
 * records nothing, and priorTurnsFrom drops the orphaned question.
 *
 * Text is accumulated the way AskPanel shows it: what streams before
 * `answering` is the model thinking out loud and is discarded, unless no tool
 * ran at all — then it IS the answer (a refusal, a clarifying sentence).
 *
 * A failed write is swallowed: memory failing must not cost the person the
 * answer they are waiting for.
 */
export async function* persistStream(
  events: AsyncIterable<AskStreamEvent>,
  thread: { id: string; title: string },
): AsyncGenerator<AskStreamEvent | { type: "thread"; threadId: string; title: string }> {
  yield { type: "thread", threadId: thread.id, title: thread.title };

  let provisional = true;
  let progress = "";
  let answer = "";
  const save = async (content: string, extra: { cites?: unknown; proposalId?: string } = {}) => {
    if (!content.trim()) return;
    try {
      await appendMessage(thread.id, { role: "assistant", content: content.trim(), ...extra });
    } catch {
      // See above: the answer still reaches the screen.
    }
  };

  for await (const event of events) {
    switch (event.type) {
      case "answering":
        provisional = false;
        progress = "";
        break;
      case "reset":
        answer = "";
        progress = "";
        break;
      case "text":
        if (provisional) progress += event.delta;
        else answer += event.delta;
        break;
      case "done":
        await save(provisional ? progress : answer, event.citations.length ? { cites: event.citations } : {});
        break;
      case "proposal":
        await save(event.proposal.title, { proposalId: event.proposal.proposalId });
        break;
      case "clarify":
        await save(event.clarify.question);
        break;
    }
    yield event;
  }
}
