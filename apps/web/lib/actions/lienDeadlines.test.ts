import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "./shared";

/**
 * The lien-deadline writes. Three rules this file pins, each the one a
 * plausible shortcut would break:
 *
 *   1. NO DATE IS EVER SUPPLIED BY THE APP. An empty deadline is refused,
 *      never defaulted — a deadline the app filled in is a deadline the app
 *      computed.
 *   2. A SERVED ROW IS THE RECORD. It is not re-served over, not edited, and
 *      not deleted; only the owner can take the served date back off.
 *   3. Everything is scoped to the caller's company IN THE WHERE — the fake
 *      below honours the where clause, so an action that forgot the scope
 *      would reach the other tenant's row and these tests would see it.
 *
 * Refusals are RETURNED, not thrown: production redacts a thrown Server
 * Action message, so `refusal()` fails loudly on a throw.
 */

type Row = Record<string, unknown> & { id: string };

let jobs: Row[] = [];
let deadlines: Row[] = [];

/** `where` as these actions write it: plain equality, `null`, and
 * `{ not: null }`. Anything else fails loudly rather than matching. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = row[key] ?? null;
    if (value === null) return actual === null;
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("not" in value && (value as { not: unknown }).not === null) return actual !== null;
      throw new Error(`fake: unsupported where on ${key}: ${JSON.stringify(value)}`);
    }
    return actual === value;
  });
}

const fakePrisma = {
  job: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      jobs.find((job) => matches(job, where)) ?? null,
  },
  lienDeadline: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `ld_${deadlines.length + 1}`, servedOn: null, ...data } as Row;
      deadlines.push(row);
      return row;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      deadlines.find((row) => matches(row, where)) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = deadlines.find((r) => r.id === where.id) as Row;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = deadlines.filter((row) => matches(row, where));
      for (const row of hit) Object.assign(row, data);
      return { count: hit.length };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = deadlines.length;
      deadlines = deadlines.filter((row) => !matches(row, where));
      return { count: before - deadlines.length };
    },
  },
};

const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-18" }));
vi.mock("@prova/db", () => ({ Prisma: {}, prisma: fakePrisma }));

const {
  createLienDeadline,
  updateLienDeadline,
  markLienDeadlineServed,
  clearLienDeadlineServed,
  deleteLienDeadline,
} = await import("./lienDeadlines");

async function refusal(pending: Promise<ActionResult>): Promise<string> {
  let result: ActionResult;
  try {
    result = await pending;
  } catch (err) {
    throw new Error(`THREW instead of returning: "${err instanceof Error ? err.message : String(err)}"`);
  }
  if (result.ok) throw new Error("the action SUCCEEDED — expected it to refuse");
  return result.error;
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeEach(() => {
  context.role = "OWNER";
  jobs = [
    { id: "job_1", companyId: "co_1", name: "Riverside" },
    { id: "job_other", companyId: "co_2", name: "Theirs" },
  ];
  deadlines = [
    { id: "open", companyId: "co_1", jobId: "job_1", kind: "PRELIMINARY_NOTICE", dueOn: d("2026-09-25"), servedOn: null },
    { id: "served", companyId: "co_1", jobId: "job_1", kind: "MECHANICS_LIEN", dueOn: d("2026-09-01"), servedOn: d("2026-08-30") },
    { id: "theirs", companyId: "co_2", jobId: "job_other", kind: "BOND_CLAIM", dueOn: d("2026-09-20"), servedOn: null },
  ];
});

describe("createLienDeadline", () => {
  it("stores the deadline exactly as entered, at UTC midnight", async () => {
    const result = await createLienDeadline(
      form({ jobId: "job_1", kind: "STOP_PAYMENT_NOTICE", dueOn: "2026-10-02", recipient: "Lender" }),
    );
    expect(result).toEqual({ ok: true });
    const created = deadlines.at(-1) as Row;
    expect((created.dueOn as Date).toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(created.servedOn).toBeNull();
    expect(created.companyId).toBe("co_1");
  });

  it("REFUSES a missing deadline rather than supplying one", async () => {
    const before = deadlines.length;
    expect(await refusal(createLienDeadline(form({ jobId: "job_1", kind: "PRELIMINARY_NOTICE", dueOn: "" })))).toBe(
      "The deadline is required",
    );
    expect(deadlines.length).toBe(before);
  });

  it("refuses another company's job in the same words as a typo", async () => {
    expect(
      await refusal(createLienDeadline(form({ jobId: "job_other", kind: "PRELIMINARY_NOTICE", dueOn: "2026-10-02" }))),
    ).toBe("That job is not on your account.");
  });

  it("requires a name for an OTHER deadline", async () => {
    expect(await refusal(createLienDeadline(form({ jobId: "job_1", kind: "OTHER", dueOn: "2026-10-02" })))).toBe(
      "Say what this deadline is for.",
    );
  });
});

describe("markLienDeadlineServed", () => {
  it("records the ENTERED served date, including one after the deadline", async () => {
    expect(await markLienDeadlineServed("open", form({ servedOn: "2026-09-18" }))).toEqual({ ok: true });
    const row = deadlines.find((r) => r.id === "open") as Row;
    expect((row.servedOn as Date).toISOString().slice(0, 10)).toBe("2026-09-18");
  });

  it("refuses a date more than a day in the future — a typo would show an unserved notice as served", async () => {
    expect(await refusal(markLienDeadlineServed("open", form({ servedOn: "2026-09-25" })))).toContain("in the future");
    expect((deadlines.find((r) => r.id === "open") as Row).servedOn).toBeNull();
  });

  it("allows tomorrow, for a person west of UTC whose day is behind the server's", async () => {
    expect(await markLienDeadlineServed("open", form({ servedOn: "2026-09-19" }))).toEqual({ ok: true });
  });

  it("never overwrites the date on a row that is already served", async () => {
    await refusal(markLienDeadlineServed("served", form({ servedOn: "2026-09-10" })));
    expect(((deadlines.find((r) => r.id === "served") as Row).servedOn as Date).toISOString().slice(0, 10)).toBe(
      "2026-08-30",
    );
  });

  it("cannot reach another company's row", async () => {
    await refusal(markLienDeadlineServed("theirs", form({ servedOn: "2026-09-18" })));
    expect((deadlines.find((r) => r.id === "theirs") as Row).servedOn).toBeNull();
  });
});

describe("updateLienDeadline", () => {
  it("corrects an unserved deadline", async () => {
    expect(await updateLienDeadline("open", form({ dueOn: "2026-09-30" }))).toEqual({ ok: true });
    expect(((deadlines.find((r) => r.id === "open") as Row).dueOn as Date).toISOString().slice(0, 10)).toBe(
      "2026-09-30",
    );
  });

  it("refuses to edit a served one — it is the record of what went out", async () => {
    expect(await refusal(updateLienDeadline("served", form({ dueOn: "2026-09-30" })))).toContain("has been served");
  });
});

describe("deleteLienDeadline and clearLienDeadlineServed", () => {
  it("lets the owner remove an unserved deadline", async () => {
    expect(await deleteLienDeadline("open")).toEqual({ ok: true });
    expect(deadlines.some((r) => r.id === "open")).toBe(false);
  });

  it("never deletes a served one", async () => {
    await refusal(deleteLienDeadline("served"));
    expect(deadlines.some((r) => r.id === "served")).toBe(true);
  });

  it("refuses a non-owner, in a sentence rather than a throw", async () => {
    context.role = "MEMBER";
    expect(await refusal(deleteLienDeadline("open"))).toBe("Only the account owner can remove a lien deadline.");
    expect(await refusal(clearLienDeadlineServed("served"))).toBe(
      "Only the account owner can take a served date back off.",
    );
    expect(deadlines.some((r) => r.id === "open")).toBe(true);
  });

  it("lets the owner take a mistaken served date back off", async () => {
    expect(await clearLienDeadlineServed("served")).toEqual({ ok: true });
    expect((deadlines.find((r) => r.id === "served") as Row).servedOn).toBeNull();
  });

  it("cannot delete another company's row", async () => {
    await refusal(deleteLienDeadline("theirs"));
    expect(deadlines.some((r) => r.id === "theirs")).toBe(true);
  });
});

/**
 * The two cross-company WRITES that nothing guarded.
 *
 * Found by independent review after this branch reported every mutation
 * caught: deleting `companyId` from updateLienDeadline's lookup, or from
 * clearLienDeadlineServed's update, passed all 3,830 tests in the repo. The
 * code was right; the regression would have been invisible. Mark-served and
 * delete were already pinned against the "theirs" row above — these two were
 * the ones the author's list did not reach.
 *
 * Both are writes, which is why they matter more than a read leak would: one
 * lets a company rewrite another company's deadline date, the other lets it
 * mark another company's SERVED notice as unserved — erasing the record that
 * a legal notice went out.
 */
describe("no write reaches another company's deadline", () => {
  it("updateLienDeadline cannot edit another company's row", async () => {
    await refusal(updateLienDeadline("theirs", form({ dueOn: "2027-01-01", recipient: "someone" })));
    const theirs = deadlines.find((r) => r.id === "theirs") as Row;
    expect(theirs.dueOn).toEqual(d("2026-09-20"));
    expect(theirs.recipient).toBeUndefined();
  });

  it("clearLienDeadlineServed cannot un-serve another company's notice", async () => {
    deadlines.push({
      id: "theirs-served",
      companyId: "co_2",
      jobId: "job_other",
      kind: "PRELIMINARY_NOTICE",
      dueOn: d("2026-09-10"),
      servedOn: d("2026-09-08"),
    });
    await refusal(clearLienDeadlineServed("theirs-served"));
    expect((deadlines.find((r) => r.id === "theirs-served") as Row).servedOn).toEqual(d("2026-09-08"));
  });
});
