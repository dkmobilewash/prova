import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * add_punch_items against a fake Prisma: DIRECT, a whole list in one card,
 * every item on the preview, and the writes in one transaction.
 *
 * The cases that matter are the ones the old single-item command could not
 * have: a list of several, blank lines, a list over the cap, and an item
 * that is already open on the job. The `need`/`refuse` branches are asserted
 * before any read happens where that is the point — a command that reads the
 * job before noticing there are no items would ask its question a query
 * later than it has to.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    punchListItem: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { addPunchItemsCommand, MODEL_VALUE_CEILING } = await import("./punchLists");
const { canRunCommand, commandsFor, schemaInput, MAX_MODEL_VALUE } = await import("../commands");
const { MAX_PUNCH_ITEMS } = await import("@/lib/field/punch-list-items");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER" as const, jobFunction: null }, today: "2026-09-12" };
const maple = { id: "job-1", name: "Maple Street", status: "IN_PROGRESS", contact: { name: "Turner" } };

const THREE = "Ceiling grid out of level, east corridor\nMissing corner bead at column B3\nTouch-up paint, stair 2";

beforeEach(() => {
  fake.prisma.job.findMany.mockReset();
  fake.prisma.job.findFirst.mockReset();
  fake.prisma.punchListItem.findMany.mockReset();
  fake.prisma.punchListItem.create.mockReset();
  fake.prisma.$transaction.mockReset();
  fake.prisma.punchListItem.findMany.mockResolvedValue([]);
});

describe("add_punch_items", () => {
  it("is DIRECT over the lifted core, under MANAGE_FIELD", () => {
    expect(addPunchItemsCommand.mode).toBe("DIRECT");
    expect(typeof addPunchItemsCommand.execute).toBe("function");
    expect(addPunchItemsCommand.handoffHref).toBeUndefined();
    expect(addPunchItemsCommand.core).toBe("createPunchListItems");
    expect(addPunchItemsCommand.capability).toBe("MANAGE_FIELD");
  });

  it("tells the model it takes the whole list, not one item per card", () => {
    const { description } = addPunchItemsCommand;
    expect(description).toMatch(/one per line/i);
    expect(description).toMatch(/whole list/i);
    // The sentence that produced the bad answer is gone, in both spellings.
    expect(description).not.toMatch(/more than one item per card/i);
    expect(description).not.toMatch(/one at a time/i);
    expect(addPunchItemsCommand.input_schema.properties).toHaveProperty("items");
    expect(addPunchItemsCommand.input_schema.properties).not.toHaveProperty("description");
  });

  it("asks which job before it reads anything", async () => {
    const result = await addPunchItemsCommand.resolve(ctx, { items: THREE });
    expect(result.kind).toBe("need");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("asks for the items once the job is known", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    const result = await addPunchItemsCommand.resolve(ctx, { jobName: "Maple" });
    expect(result.kind).toBe("need");
    if (result.kind !== "need") throw new Error("unreachable");
    expect(result.missing).toMatch(/what needs fixing/);
    expect(fake.prisma.punchListItem.findMany).not.toHaveBeenCalled();
  });

  it("refuses with the page to go to when no job matches", async () => {
    fake.prisma.job.findMany.mockResolvedValue([]);
    const result = await addPunchItemsCommand.resolve(ctx, { jobName: "Nowhere", items: THREE });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.href).toBe("/dashboard");
  });

  it("previews EVERY item of a multi-item list and carries them all in the payload", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    const result = await addPunchItemsCommand.resolve(ctx, { jobName: "Maple", items: THREE });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      jobId: "job-1",
      jobName: "Maple Street",
      descriptions: [
        "Ceiling grid out of level, east corridor",
        "Missing corner bead at column B3",
        "Touch-up paint, stair 2",
      ],
    });
    expect(result.preview).toEqual([
      { label: "Job", value: "Maple Street" },
      { label: "Adding", value: "3 items" },
      { label: "Item 1", value: "Ceiling grid out of level, east corridor" },
      { label: "Item 2", value: "Missing corner bead at column B3" },
      { label: "Item 3", value: "Touch-up paint, stair 2" },
    ]);
    // AskProposalCard keys its rows on the label.
    expect(new Set(result.preview.map((line) => line.label)).size).toBe(result.preview.length);
    expect(result.warnings).toEqual([]);
  });

  it("handles one item as a list of one, so the single case needs no second command", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    const result = await addPunchItemsCommand.resolve(ctx, { jobName: "Maple", items: "Grid out of level" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.descriptions).toEqual(["Grid out of level"]);
    expect(result.preview[1]).toEqual({ label: "Adding", value: "1 item" });
  });

  it("drops blank lines and list bullets, and says how many blanks it ignored", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    const result = await addPunchItemsCommand.resolve(ctx, {
      jobName: "Maple",
      items: "- Grid out of level\n\n  \n2. Corner bead missing\n",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.descriptions).toEqual(["Grid out of level", "Corner bead missing"]);
    expect(result.warnings).toContain("3 blank lines were ignored.");
  });

  it("refuses a list over the cap rather than silently creating part of it", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    const tooMany = Array.from({ length: MAX_PUNCH_ITEMS + 1 }, (_, i) => `Item number ${i + 1}`).join("\n");
    const result = await addPunchItemsCommand.resolve(ctx, { jobName: "Maple", items: tooMany });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toContain(`${MAX_PUNCH_ITEMS + 1} items`);
    expect(result.reason).toContain(String(MAX_PUNCH_ITEMS));
    expect(result.href).toBe("/punch-lists");
    expect(fake.prisma.punchListItem.findMany).not.toHaveBeenCalled();
  });

  it("accepts exactly the cap", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    const atCap = Array.from({ length: MAX_PUNCH_ITEMS }, (_, i) => `Item number ${i + 1}`).join("\n");
    const result = await addPunchItemsCommand.resolve(ctx, { jobName: "Maple", items: atCap });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.descriptions).toHaveLength(MAX_PUNCH_ITEMS);
  });

  it("skips what is already open on that job, and what the list repeats, and says so", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    fake.prisma.punchListItem.findMany.mockResolvedValue([{ description: "ceiling grid   out of level, EAST corridor" }]);
    const result = await addPunchItemsCommand.resolve(ctx, {
      jobName: "Maple",
      items: `${THREE}\nTouch-up paint, stair 2`,
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.descriptions).toEqual([
      "Missing corner bead at column B3",
      "Touch-up paint, stair 2",
    ]);
    expect(result.warnings).toEqual([
      "Listed more than once, so added once: Touch-up paint, stair 2.",
      "Already open on this job, so not added again: Ceiling grid out of level, east corridor.",
    ]);
    // The open-items query is this job's open rows only.
    expect(fake.prisma.punchListItem.findMany).toHaveBeenCalledWith({
      where: { companyId: "co-1", jobId: "job-1", isDone: false },
      select: { description: true },
    });
  });

  it("refuses when every item is already open, rather than offering a card that creates nothing", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    fake.prisma.punchListItem.findMany.mockResolvedValue([{ description: "Grid out of level" }]);
    const result = await addPunchItemsCommand.resolve(ctx, { jobName: "Maple", items: "Grid out of level" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toMatch(/already open on Maple Street/);
  });

  it("pins its own copy of the model value ceiling to the registry's", () => {
    // The one number this file duplicates on purpose (a value import from
    // ../commands would be a cycle). If they ever disagree, the truncation
    // warning fires at the wrong length or not at all.
    expect(MODEL_VALUE_CEILING).toBe(MAX_MODEL_VALUE);
  });

  it("warns when the model's list arrived at the value limit, where a line may have been cut in half", async () => {
    fake.prisma.job.findMany.mockResolvedValue([maple]);
    const long = Array.from({ length: 15 }, (_, i) => `Item ${i + 1} ${"x".repeat(90)}`).join("\n");
    const items = schemaInput(addPunchItemsCommand, { items: long }, "model").items;
    expect(items).toHaveLength(MAX_MODEL_VALUE);
    const result = await addPunchItemsCommand.resolve(ctx, { jobName: "Maple", items });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.warnings[0]).toMatch(/cut short/);
  });
});

describe("add_punch_items writes", () => {
  /** The core runs inside prisma.$transaction; the fake hands it a tx whose
   * create returns a row, so "one transaction, N rows" is asserted rather
   * than assumed. */
  function transactionWrites(ids: string[]) {
    let next = 0;
    const tx = {
      punchListItem: {
        create: vi.fn(async ({ data }: { data: { description: string } }) => ({
          id: ids[next++],
          description: data.description,
        })),
      },
    };
    fake.prisma.$transaction.mockImplementation(async (run: (t: typeof tx) => unknown) => run(tx));
    return tx;
  }

  it("creates every item in ONE transaction and reports the count", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1" });
    const tx = transactionWrites(["p-1", "p-2", "p-3"]);
    const executed = await addPunchItemsCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Maple Street",
      descriptions: ["Grid out of level", "Corner bead", "Touch-up paint"],
    });
    expect(fake.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.punchListItem.create).toHaveBeenCalledTimes(3);
    expect(tx.punchListItem.create.mock.calls[0][0].data).toEqual({
      companyId: "co-1",
      jobId: "job-1",
      description: "Grid out of level",
      raisedByUserId: "u-1",
    });
    expect(executed.ok).toBe(true);
    if (!executed.ok) throw new Error("unreachable");
    expect(executed.message).toBe("Added 3 items to the punch list on Maple Street.");
    expect(executed.created).toEqual({
      label: "Punch list, Maple Street",
      href: "/punch-lists",
      targetType: "PunchListItem",
      targetId: "p-1",
    });
  });

  it("refuses a job that is not this company's, and writes nothing", async () => {
    fake.prisma.job.findFirst.mockResolvedValue(null);
    transactionWrites([]);
    const executed = await addPunchItemsCommand.execute(ctx, {
      jobId: "someone-elses",
      jobName: "Theirs",
      descriptions: ["Grid out of level"],
    });
    expect(executed).toEqual({ ok: false, error: "Job not found" });
    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a payload with no items rather than reporting an empty success", async () => {
    const executed = await addPunchItemsCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Maple Street",
      descriptions: [],
    });
    expect(executed.ok).toBe(false);
    expect(fake.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("who may add punch items", () => {
  it("is offered to a field member and an owner, and withheld from anyone without MANAGE_FIELD", () => {
    expect(canRunCommand({ role: "MEMBER", jobFunction: "FIELD" }, addPunchItemsCommand)).toBe(true);
    expect(canRunCommand({ role: "OWNER", jobFunction: null }, addPunchItemsCommand)).toBe(true);
    for (const jobFunction of ["ESTIMATOR", "ACCOUNTING"] as const) {
      const principal = { role: "MEMBER" as const, jobFunction };
      expect(canRunCommand(principal, addPunchItemsCommand), jobFunction).toBe(false);
      expect(commandsFor(principal).map((command) => command.name), jobFunction).not.toContain("add_punch_items");
    }
  });

  it("no longer registers the retired single-item command", () => {
    expect(commandsFor({ role: "OWNER", jobFunction: null }).map((command) => command.name)).not.toContain(
      "add_punch_item",
    );
  });
});
