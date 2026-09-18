import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * add_bid_pursuit and set_pursuit_stage against a where-honouring fake and
 * faked actions.
 *
 * Pinned, because each is what a person would be hurt by if it drifted:
 *   - RESOLVE NEVER WRITES. The actions are spies and every write method on
 *     the fake throws; a resolve that reached either goes red. Only execute —
 *     which only the person's tap reaches — calls the action.
 *   - Tenant scope: the other company has a pursuit with the SAME project
 *     name, and the fake honours `companyId`, so a lookup that lost it finds
 *     two (a chip row) or the wrong one.
 *   - The stage is the person's word or nothing: an unknown word is a chip
 *     row of all five, never a pick; add defaults to Watching.
 */

type Where = Record<string, unknown>;
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, want]) => {
    const have = row[key];
    if (want !== null && typeof want === "object" && !(want instanceof Date)) {
      const op = want as { contains?: string; equals?: string; not?: unknown };
      if (op.contains !== undefined) return String(have ?? "").toLowerCase().includes(op.contains.toLowerCase());
      if (op.equals !== undefined) return String(have ?? "").toLowerCase() === op.equals.toLowerCase();
      if ("not" in op) return have !== op.not;
      return false;
    }
    return have === want;
  });
}

type Pursuit = { id: string; companyId: string; projectName: string; stage: string; bidInvitationId: string | null };
let PURSUITS: Pursuit[] = [];

const fake = vi.hoisted(() => ({
  createBidPursuit: vi.fn(),
  setBidPursuitStage: vi.fn(),
  write: vi.fn(() => {
    throw new Error("resolve wrote to the database");
  }),
}));

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    bidPursuit: {
      findFirst: async ({ where }: { where: Where }) => PURSUITS.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }: { where: Where }) => PURSUITS.filter((row) => matches(row, where)),
      create: fake.write,
      update: fake.write,
      updateMany: fake.write,
    },
  },
}));
vi.mock("@/lib/actions/bidPursuits", () => ({
  createBidPursuit: fake.createBidPursuit,
  setBidPursuitStage: fake.setBidPursuitStage,
}));

const { addBidPursuitCommand, setPursuitStageCommand, readStage } = await import("./pursuits");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER" as const, jobFunction: null }, today: "2026-09-18" };
const line = (result: { preview?: { label: string; value: string }[] }, label: string) =>
  result.preview?.find((l) => l.label === label)?.value;

beforeEach(() => {
  PURSUITS = [
    { id: "p1", companyId: "co-1", projectName: "Northgate Medical", stage: "WATCHING", bidInvitationId: null },
    { id: "p2", companyId: "co-2", projectName: "Northgate Medical", stage: "WATCHING", bidInvitationId: null },
    { id: "p3", companyId: "co-1", projectName: "St. Mary's east wing", stage: "INVITED", bidInvitationId: "inv-1" },
  ];
  fake.createBidPursuit.mockReset();
  fake.setBidPursuitStage.mockReset();
  fake.write.mockClear();
});

describe("readStage", () => {
  it("maps the person's word, or an enum from a chip, and nothing else", () => {
    expect(readStage("contacted")).toBe("CONTACTED");
    expect(readStage("Expecting an invite")).toBe("EXPECTING_INVITE");
    expect(readStage("EXPECTING_INVITE")).toBe("EXPECTING_INVITE");
    expect(readStage("dead")).toBe("DROPPED");
    expect(readStage("we talked to them")).toBeNull();
    expect(readStage("")).toBeNull();
  });
});

describe("add_bid_pursuit", () => {
  it("asks for the project when none was given, and writes nothing", async () => {
    expect(await addBidPursuitCommand.resolve(ctx, {})).toEqual({ kind: "need", missing: expect.stringContaining("project") });
    expect(fake.createBidPursuit).not.toHaveBeenCalled();
  });

  it("builds a card from the person's words — Watching unless they named a stage — and does NOT call the action", async () => {
    const result = await addBidPursuitCommand.resolve(ctx, {
      projectName: "Cedar Park Clinic",
      expectedGcs: "Turner and Skanska",
      expectedBidDate: "October 3",
      estimatedValue: "250,000",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.existing).toBeUndefined();
    expect(line(result, "Stage")).toBe("Watching");
    expect(line(result, "GC(s) expected")).toBe("Turner and Skanska");
    expect(line(result, "Expected bid date")).toMatch(/Oct 3, 2026/);
    expect(result.resolved).toMatchObject({ projectName: "Cedar Park Clinic", stage: "WATCHING", expectedBidDate: "2026-10-03", estimatedValue: "250000" });
    expect(fake.createBidPursuit).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
  });

  it("runs the action's own value parser early: a bad figure is a question, not a card", async () => {
    const result = await addBidPursuitCommand.resolve(ctx, { projectName: "Cedar Park Clinic", estimatedValue: "1,2,3" });
    expect(result).toEqual({ kind: "need", missing: expect.stringMatching(/Estimated value must be a number/) });
  });

  it("offers all five stages for a word it cannot read, never a guess", async () => {
    const result = await addBidPursuitCommand.resolve(ctx, { projectName: "Cedar Park Clinic", stage: "warm" });
    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") expect(result.options.map((o) => o.value)).toEqual(["WATCHING", "CONTACTED", "EXPECTING_INVITE", "INVITED", "DROPPED"]);
  });

  it("links to a pursuit THIS company is already chasing, and ignores the other company's twin", async () => {
    const mine = await addBidPursuitCommand.resolve(ctx, { projectName: "northgate medical" });
    expect(mine.kind === "ready" && mine.existing?.href).toBe("/pipeline");

    const other = await addBidPursuitCommand.resolve({ ...ctx, companyId: "co-3" }, { projectName: "Northgate Medical" });
    expect(other.kind === "ready" && other.existing).toBeUndefined();
  });

  it("executes through createBidPursuit with the form's own fields, only on the tap", async () => {
    fake.createBidPursuit.mockResolvedValue({ ok: true });
    const result = await addBidPursuitCommand.execute(ctx, {
      projectName: "Cedar Park Clinic",
      stage: "WATCHING",
      owner: null,
      architect: null,
      expectedGcs: "Turner",
      expectedBidDate: "2026-10-03",
      estimatedValue: "250000",
      note: null,
    });
    expect(result.ok).toBe(true);
    const form = fake.createBidPursuit.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(form.entries())).toEqual({
      projectName: "Cedar Park Clinic",
      stage: "WATCHING",
      expectedGcs: "Turner",
      expectedBidDate: "2026-10-03",
      estimatedValue: "250000",
    });
  });

  it("puts the action's refusal on the card", async () => {
    fake.createBidPursuit.mockResolvedValue({ ok: false, error: "Estimating isn't part of your job function." });
    const result = await addBidPursuitCommand.execute(ctx, { projectName: "X", stage: "WATCHING", expectedBidDate: null });
    expect(result).toEqual({ ok: false, error: "Estimating isn't part of your job function." });
  });
});

describe("set_pursuit_stage", () => {
  it("moves THIS company's pursuit, found by name, and does not call the action until the tap", async () => {
    const result = await setPursuitStageCommand.resolve(ctx, { projectName: "Northgate", stage: "contacted" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.resolved).toEqual({ pursuitId: "p1", projectName: "Northgate Medical", from: "WATCHING", stage: "CONTACTED" });
    expect(line(result, "Stage now")).toBe("Watching");
    expect(line(result, "Moves to")).toBe("Contacted");
    expect(fake.setBidPursuitStage).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
  });

  it("asks for the stage rather than choosing one", async () => {
    expect(await setPursuitStageCommand.resolve(ctx, { projectName: "Northgate" })).toEqual({
      kind: "need",
      missing: "which stage to move Northgate Medical to",
    });
  });

  it("refuses a pursuit that matches nothing, one already there, and a linked one leaving Invited", async () => {
    expect((await setPursuitStageCommand.resolve(ctx, { projectName: "Cedar", stage: "dropped" })).kind).toBe("refuse");
    expect(await setPursuitStageCommand.resolve(ctx, { projectName: "Northgate", stage: "watching" })).toMatchObject({
      kind: "refuse",
      reason: expect.stringContaining("already at Watching"),
    });
    expect(await setPursuitStageCommand.resolve(ctx, { projectName: "St. Mary", stage: "dropped" })).toMatchObject({
      kind: "refuse",
      reason: expect.stringContaining("linked to a logged bid invitation"),
    });
  });

  it("re-asserts a chip's pursuit id in-company", async () => {
    const forged = await setPursuitStageCommand.resolve(ctx, { pursuitId: "p2", stage: "dropped" });
    expect(forged.kind).toBe("refuse");
  });

  it("executes through setBidPursuitStage with the stored id and stage", async () => {
    fake.setBidPursuitStage.mockResolvedValue({ ok: true });
    const result = await setPursuitStageCommand.execute(ctx, { pursuitId: "p1", projectName: "Northgate Medical", stage: "CONTACTED" });
    expect(result).toMatchObject({ ok: true, message: "Moved Northgate Medical to Contacted." });
    expect(fake.setBidPursuitStage).toHaveBeenCalledWith("p1", "CONTACTED");
  });
});
