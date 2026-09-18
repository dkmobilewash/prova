import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pursuit list's writes, pinned where a person cannot click them.
 *
 *   1. Every refusal is RETURNED, never thrown — production redacts a thrown
 *      Server Action message, so a thrown "only the owner" is a dead button.
 *   2. Delete is OWNER-ONLY, and a refused delete deletes nothing.
 *   3. Every write is scoped by company IN THE WHERE: another company's
 *      pursuit with the same id is never matched. The fake below honours
 *      `companyId` — a fake that ignored it would pass the unscoped version.
 *   4. Linking an invitation moves the stage to INVITED in the same write,
 *      refuses another company's invitation, and turns the unique-index
 *      collision into a sentence rather than a redacted digest.
 *   5. A linked pursuit cannot be moved off INVITED without unlinking first,
 *      so the link and the stage never state two facts that disagree.
 */

type Pursuit = { id: string; companyId: string; stage: string; bidInvitationId: string | null; projectName: string };
type Invitation = { id: string; companyId: string };

let pursuits: Pursuit[] = [];
let invitations: Invitation[] = [];
let collideOnLink = false;
let betweenReadAndWrite: (() => void) | null = null;
const deleted: string[] = [];

const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([key, value]) => row[key] === value);

vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: {
    bidPursuit: {
      create: async ({ data }: { data: Pursuit }) => {
        const row = { ...data, id: `p_${pursuits.length + 1}`, bidInvitationId: null };
        pursuits.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        pursuits.find((row) => matches(row, where)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Pursuit> }) => {
        // Somebody else's write landing between this action's read and its
        // write — the window a read-then-write guard leaves open.
        const interleave = betweenReadAndWrite;
        betweenReadAndWrite = null;
        interleave?.();
        if (collideOnLink && data.bidInvitationId) {
          const error = new Error("Unique constraint failed on the fields: (`bidInvitationId`)");
          (error as Error & { code?: string }).code = "P2002";
          throw error;
        }
        const hit = pursuits.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const hit = pursuits.filter((row) => matches(row, where));
        pursuits = pursuits.filter((row) => !hit.includes(row));
        deleted.push(...hit.map((row) => row.id));
        return { count: hit.length };
      },
    },
    bidInvitation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        invitations.find((row) => matches(row, where)) ?? null,
    },
  },
}));

async function actions() {
  return import("./bidPursuits");
}

beforeEach(() => {
  pursuits = [
    { id: "mine", companyId: "co_1", stage: "WATCHING", bidInvitationId: null, projectName: "St. Mary's" },
    { id: "theirs", companyId: "co_2", stage: "WATCHING", bidInvitationId: null, projectName: "Not yours" },
  ];
  invitations = [
    { id: "inv_mine", companyId: "co_1" },
    { id: "inv_theirs", companyId: "co_2" },
  ];
  collideOnLink = false;
  betweenReadAndWrite = null;
  deleted.length = 0;
  context.role = "OWNER";
  context.jobFunction = null;
});

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("creating a pursuit", () => {
  it("stores the entered bid date at UTC midnight and the value as typed, minus the $ and commas", async () => {
    const { createBidPursuit } = await actions();
    const result = await createBidPursuit(
      form({ projectName: "Harbor lofts", expectedBidDate: "2026-11-02", estimatedValue: "$1,250,000", stage: "CONTACTED" }),
    );
    expect(result).toEqual({ ok: true });
    const row = pursuits.find((p) => p.projectName === "Harbor lofts") as unknown as Record<string, unknown>;
    expect(row.companyId).toBe("co_1");
    expect(row.createdByUserId).toBe("user_1");
    expect((row.expectedBidDate as Date).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(row.estimatedValue).toBe("1250000");
    expect(row.stage).toBe("CONTACTED");
  });

  it("returns, rather than throws, a missing name or a bad value", async () => {
    const { createBidPursuit } = await actions();
    expect(await createBidPursuit(form({ projectName: " " }))).toEqual({ ok: false, error: "Give the project a name." });
    const bad = await createBidPursuit(form({ projectName: "X", estimatedValue: "a lot" }));
    expect(bad.ok).toBe(false);
  });
});

describe("deleting a pursuit", () => {
  it("refuses a non-owner in words, and deletes nothing", async () => {
    context.role = "MEMBER";
    context.jobFunction = "ESTIMATOR";
    const { deleteBidPursuit } = await actions();
    const result = await deleteBidPursuit("mine");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Only the account owner/);
    expect(deleted).toEqual([]);
  });

  it("lets the owner delete their own — and never another company's with the same id", async () => {
    const { deleteBidPursuit } = await actions();
    expect(await deleteBidPursuit("theirs")).toEqual({ ok: false, error: "That pursuit is no longer on your list." });
    expect(deleted).toEqual([]);
    expect(await deleteBidPursuit("mine")).toEqual({ ok: true });
    expect(deleted).toEqual(["mine"]);
  });
});

describe("linking the invitation it became", () => {
  it("links, and moves the stage to INVITED in the same write", async () => {
    const { linkBidPursuitToInvitation } = await actions();
    expect(await linkBidPursuitToInvitation("mine", "inv_mine")).toEqual({ ok: true });
    expect(pursuits[0]).toMatchObject({ bidInvitationId: "inv_mine", stage: "INVITED" });
  });

  it("refuses another company's invitation in the same words as a missing one", async () => {
    const { linkBidPursuitToInvitation } = await actions();
    const result = await linkBidPursuitToInvitation("mine", "inv_theirs");
    expect(result).toEqual({ ok: false, error: "That bid invitation is not on your account." });
    expect(pursuits[0].bidInvitationId).toBeNull();
  });

  it("turns the unique-index collision into a sentence", async () => {
    collideOnLink = true;
    const { linkBidPursuitToInvitation } = await actions();
    const result = await linkBidPursuitToInvitation("mine", "inv_mine");
    expect(result.ok === false && result.error).toMatch(/already linked to another pursuit/);
  });

  it("unlinks with an empty id and leaves the stage alone", async () => {
    pursuits[0].bidInvitationId = "inv_mine";
    pursuits[0].stage = "INVITED";
    const { linkBidPursuitToInvitation } = await actions();
    expect(await linkBidPursuitToInvitation("mine", "")).toEqual({ ok: true });
    expect(pursuits[0]).toMatchObject({ bidInvitationId: null, stage: "INVITED" });
  });
});

describe("the stage and the link cannot disagree", () => {
  it("refuses to move a linked pursuit off INVITED", async () => {
    pursuits[0].bidInvitationId = "inv_mine";
    pursuits[0].stage = "INVITED";
    const { setBidPursuitStage, updateBidPursuit } = await actions();
    const quick = await setBidPursuitStage("mine", "WATCHING");
    expect(quick.ok === false && quick.error).toMatch(/Unlink the invitation first/);
    const full = await updateBidPursuit("mine", form({ projectName: "St. Mary's", stage: "DROPPED" }));
    expect(full.ok === false && full.error).toMatch(/Unlink the invitation first/);
    expect(pursuits[0].stage).toBe("INVITED");
  });

  it("moves an unlinked pursuit freely, and only this company's", async () => {
    const { setBidPursuitStage } = await actions();
    expect(await setBidPursuitStage("mine", "DROPPED")).toEqual({ ok: true });
    expect(pursuits[0].stage).toBe("DROPPED");
    expect(await setBidPursuitStage("theirs", "DROPPED")).toEqual({ ok: false, error: "That pursuit is no longer on your list." });
    expect(pursuits[1].stage).toBe("WATCHING");
  });
});

describe("a write that lands between the read and the write", () => {
  const linkedByAnotherUser = () => {
    pursuits[0].bidInvitationId = "inv_mine";
    pursuits[0].stage = "INVITED";
  };
  const deletedByAnotherUser = () => {
    pursuits = pursuits.filter((p) => p.id !== "mine");
  };

  it("does not move a pursuit off INVITED that somebody linked a moment ago (quick stage change)", async () => {
    betweenReadAndWrite = linkedByAnotherUser;
    const { setBidPursuitStage } = await actions();
    const result = await setBidPursuitStage("mine", "DROPPED");
    expect(result.ok === false && result.error).toMatch(/Unlink the invitation first/);
    expect(pursuits[0]).toMatchObject({ bidInvitationId: "inv_mine", stage: "INVITED" });
  });

  it("does not move a pursuit off INVITED that somebody linked a moment ago (edit form)", async () => {
    betweenReadAndWrite = linkedByAnotherUser;
    const { updateBidPursuit } = await actions();
    const result = await updateBidPursuit("mine", form({ projectName: "St. Mary's", stage: "WATCHING" }));
    expect(result.ok === false && result.error).toMatch(/Unlink the invitation first/);
    expect(pursuits[0]).toMatchObject({ bidInvitationId: "inv_mine", stage: "INVITED" });
  });

  it("still lets a linked pursuit be edited while it stays INVITED", async () => {
    linkedByAnotherUser();
    const { updateBidPursuit, setBidPursuitStage } = await actions();
    expect(await updateBidPursuit("mine", form({ projectName: "St. Mary's, renamed", stage: "INVITED" }))).toEqual({
      ok: true,
    });
    expect(pursuits[0]).toMatchObject({ projectName: "St. Mary's, renamed", bidInvitationId: "inv_mine" });
    expect(await setBidPursuitStage("mine", "INVITED")).toEqual({ ok: true });
  });

  it("says the pursuit is gone, rather than ok, when it was deleted a moment ago", async () => {
    const { setBidPursuitStage, linkBidPursuitToInvitation } = await actions();
    const gone = { ok: false, error: "That pursuit is no longer on your list." };

    betweenReadAndWrite = deletedByAnotherUser;
    expect(await setBidPursuitStage("mine", "CONTACTED")).toEqual(gone);

    beforeEachReset();
    betweenReadAndWrite = deletedByAnotherUser;
    expect(await linkBidPursuitToInvitation("mine", "inv_mine")).toEqual(gone);

    beforeEachReset();
    pursuits[0].bidInvitationId = "inv_mine";
    betweenReadAndWrite = deletedByAnotherUser;
    expect(await linkBidPursuitToInvitation("mine", "")).toEqual(gone);
  });
});

function beforeEachReset() {
  pursuits = [
    { id: "mine", companyId: "co_1", stage: "WATCHING", bidInvitationId: null, projectName: "St. Mary's" },
    { id: "theirs", companyId: "co_2", stage: "WATCHING", bidInvitationId: null, projectName: "Not yours" },
  ];
}
