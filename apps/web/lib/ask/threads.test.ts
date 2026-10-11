import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskStreamEvent } from "./answer";

/**
 * Conversation memory, against an in-memory stand-in for prisma that HONOURS
 * the where clauses it is given — so the isolation tests below prove the
 * queries name the company and the person, not merely that a mock returned
 * what it was told to.
 */

type Thread = {
  id: string;
  companyId: string;
  userId: string | null;
  title: string;
  subjectType: string | null;
  subjectId: string | null;
  lastMessageAt: Date;
};
type Message = {
  id: string;
  threadId: string;
  role: string;
  content: string;
  cites: unknown;
  proposalId: string | null;
  createdAt: Date;
};

const db = { threads: [] as Thread[], messages: [] as Message[], seq: 0 };

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

const fake = {
  askThread: {
    findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
      db.threads
        .filter((t) => matches(t, where))
        .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
        .slice(0, take)
        .map(({ id, title, lastMessageAt, subjectType, subjectId }) => ({ id, title, lastMessageAt, subjectType, subjectId })),
    ),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const t = db.threads.find((row) => matches(row, where));
      if (!t) return null;
      const messages = db.messages
        .filter((m) => m.threadId === t.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { id: t.id, title: t.title, messages };
    }),
    create: vi.fn(async ({ data }: { data: Omit<Thread, "id" | "lastMessageAt"> }) => {
      const row = { ...data, id: `t${++db.seq}`, lastMessageAt: new Date() };
      db.threads.push(row);
      return { id: row.id, title: row.title };
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: { lastMessageAt: Date; messages: { create: Omit<Message, "id" | "threadId"> } } }) => {
        const t = db.threads.find((row) => row.id === where.id);
        if (!t) throw new Error("Record to update not found.");
        t.lastMessageAt = data.lastMessageAt;
        const created = data.messages.create;
        db.messages.push({ ...created, cites: created.cites ?? null, id: `m${++db.seq}`, threadId: t.id });
      },
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: { title: string } }) => {
      const hits = db.threads.filter((t) => matches(t, where));
      for (const t of hits) t.title = data.title;
      return { count: hits.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const hits = db.threads.filter((t) => matches(t, where));
      db.threads = db.threads.filter((t) => !hits.includes(t));
      db.messages = db.messages.filter((m) => !hits.some((t) => t.id === m.threadId));
      return { count: hits.length };
    }),
  },
};

vi.mock("@prova/db", () => ({ prisma: fake }));

let session = { companyId: "co-a", id: "user-a" };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const threads = await import("./threads");
const actions = await import("@/lib/actions/askThreads");

beforeEach(() => {
  db.threads = [];
  db.messages = [];
  db.seq = 0;
  session = { companyId: "co-a", id: "user-a" };
});

describe("titleFor", () => {
  it("trims, capitalises the first letter only, and drops trailing punctuation", () => {
    expect(threads.titleFor("  which invoices are overdue on Cedar Park?  ")).toBe(
      "Which invoices are overdue on Cedar Park",
    );
  });

  it("cuts a long question at a word, at most 60 characters, with no ellipsis", () => {
    const title = threads.titleFor(
      "draft an estimate for the second floor corridor framing and drywall at the Brackett school job, level 4",
    );
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toBe("Draft an estimate for the second floor corridor framing and");
  });

  it("never returns an empty title", () => {
    expect(threads.titleFor("   ?!  ")).toBe("New conversation");
  });
});

describe("priorTurnsFrom", () => {
  it("keeps complete exchanges and drops a question that was never answered", () => {
    const turns = threads.priorTurnsFrom([
      { role: "user", content: "what is overdue" },
      { role: "assistant", content: "Two invoices." },
      { role: "user", content: "this one failed" },
      { role: "user", content: "and Cedar Park?" },
      { role: "assistant", content: "One." },
    ]);
    expect(turns).toEqual([
      { role: "user", content: "what is overdue" },
      { role: "assistant", content: "Two invoices." },
      { role: "user", content: "and Cedar Park?" },
      { role: "assistant", content: "One." },
    ]);
  });

  it("is bounded like a browser's turns (boundTurns: six)", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i}` }));
    const turns = threads.priorTurnsFrom(many);
    expect(turns).toHaveLength(6);
    expect(turns[0]).toEqual({ role: "user", content: "t14" });
  });
});

describe("a thread is one person's", () => {
  it("round-trips: create, append, load in order, and lastMessageAt moves", async () => {
    const t = await threads.createThread("co-a", "user-a", "what is overdue?", { type: "bid", id: "bid1" });
    expect(t.title).toBe("What is overdue");
    const before = db.threads[0].lastMessageAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await threads.appendMessage(t.id, { role: "user", content: "what is overdue?" });
    await new Promise((r) => setTimeout(r, 5));
    await threads.appendMessage(t.id, { role: "assistant", content: "Two.", cites: [{ label: "Invoices", href: "/invoices" }] });
    expect(db.threads[0].lastMessageAt.getTime()).toBeGreaterThan(before);

    const loaded = await threads.loadThread(t.id, "co-a", "user-a");
    expect(loaded?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(loaded?.messages[1].cites).toEqual([{ label: "Invoices", href: "/invoices" }]);
    expect(await threads.listThreadsForSubject("co-a", "bid", "bid1", "user-a")).toHaveLength(1);
  });

  it("never reaches another person's or another company's thread — on any read or write", async () => {
    const mine = await threads.createThread("co-a", "user-a", "mine");
    await threads.createThread("co-a", "user-b", "a colleague's");
    await threads.createThread("co-b", "user-a", "same user id, other company");

    expect(await threads.loadThread(mine.id, "co-a", "user-b")).toBeNull();
    expect(await threads.loadThread(mine.id, "co-b", "user-a")).toBeNull();
    expect((await threads.listRecentThreads("co-a", "user-a")).map((t) => t.title)).toEqual(["Mine"]);
    expect(await threads.listThreadsForSubject("co-a", "bid", "x", "user-b")).toEqual([]);

    session = { companyId: "co-a", id: "user-b" };
    expect(await actions.loadAskThread(mine.id)).toEqual({ ok: false, error: "That conversation isn't one you can open." });
    expect((await actions.renameThread(mine.id, "stolen")).ok).toBe(false);
    expect((await actions.deleteThread(mine.id)).ok).toBe(false);
    expect(db.threads.find((t) => t.id === mine.id)?.title).toBe("Mine");

    session = { companyId: "co-a", id: "user-a" };
    expect(await actions.renameThread(mine.id, "  Overdue   check ")).toEqual({ ok: true });
    expect(db.threads.find((t) => t.id === mine.id)?.title).toBe("Overdue check");
    expect(await actions.deleteThread(mine.id)).toEqual({ ok: true });
    expect(db.threads.some((t) => t.id === mine.id)).toBe(false);
  });

  it("refuses an empty or over-long name with a sentence, not a throw", async () => {
    const mine = await threads.createThread("co-a", "user-a", "mine");
    expect(await actions.renameThread(mine.id, "   ")).toEqual({ ok: false, error: "Give the conversation a name." });
    expect((await actions.renameThread(mine.id, "x".repeat(61))).ok).toBe(false);
  });
});

describe("entriesFromThread", () => {
  it("pairs each question with its reply, keeps an unanswered one, and drops an off-site citation", async () => {
    const { entriesFromThread } = await import("./transcript");
    const at = new Date("2026-10-01T15:00:00Z");
    const entries = entriesFromThread([
      { role: "user", content: "what is overdue", cites: null, createdAt: at },
      {
        role: "assistant",
        content: "Two.",
        cites: [
          { label: "Invoices", href: "/invoices" },
          { label: "Evil", href: "https://evil.example" },
        ],
        createdAt: at,
      },
      { role: "user", content: "and now?", cites: null, createdAt: at },
    ]);
    expect(entries).toEqual([
      { question: "what is overdue", answer: "Two.", citations: [{ label: "Invoices", href: "/invoices" }], askedAt: at.getTime() },
      { question: "and now?", answer: "", citations: [], askedAt: at.getTime() },
    ]);
  });
});

async function* events(list: AskStreamEvent[]) {
  for (const event of list) yield event;
}

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe("persistStream", () => {
  it("announces the thread first and stores the final answer, not the thinking-out-loud", async () => {
    const t = await threads.createThread("co-a", "user-a", "q");
    const out = await drain(
      threads.persistStream(
        events([
          { type: "text", delta: "I'll pull the invoices. " },
          { type: "tools", names: [], label: "Reading invoices" },
          { type: "answering" },
          { type: "text", delta: "Two are " },
          { type: "text", delta: "overdue." },
          { type: "done", citations: [{ label: "Invoices", href: "/invoices" }], links: [], toolsUsed: [] },
        ]),
        t,
      ),
    );
    expect(out[0]).toEqual({ type: "thread", threadId: t.id, title: "Q" });
    expect(out).toHaveLength(7);
    expect(db.messages).toHaveLength(1);
    expect(db.messages[0]).toMatchObject({
      role: "assistant",
      content: "Two are overdue.",
      cites: [{ label: "Invoices", href: "/invoices" }],
    });
  });

  it("keeps a no-tool answer (a refusal) and records the card id when it halts on a card", async () => {
    const t = await threads.createThread("co-a", "user-a", "q");
    await drain(
      threads.persistStream(
        events([
          { type: "text", delta: "I can't change payroll." },
          { type: "done", citations: [], links: [], toolsUsed: [] },
        ]),
        t,
      ),
    );
    await drain(
      threads.persistStream(
        events([
          {
            type: "proposal",
            proposal: { proposalId: "p1", title: "Raise an RFI" } as Extract<AskStreamEvent, { type: "proposal" }>["proposal"],
          },
        ]),
        t,
      ),
    );
    expect(db.messages.map((m) => [m.content, m.proposalId, m.cites])).toEqual([
      ["I can't change payroll.", null, null],
      ["Raise an RFI", "p1", null],
    ]);
  });

  it("stores nothing for an error, and a failed write never costs the answer", async () => {
    const t = await threads.createThread("co-a", "user-a", "q");
    await drain(threads.persistStream(events([{ type: "error", error: "Down." }]), t));
    expect(db.messages).toHaveLength(0);

    const gone = { id: "missing", title: "x" };
    const out = await drain(
      threads.persistStream(
        events([{ type: "answering" }, { type: "text", delta: "Hi" }, { type: "done", citations: [], links: [], toolsUsed: [] }]),
        gone,
      ),
    );
    expect(out.at(-1)).toMatchObject({ type: "done" });
  });
});
