import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";
import type { ActionResult } from "./shared";

/**
 * What this module promises, pinned where a person cannot click it.
 *
 * Three claims, and each has a way of being quietly false:
 *
 *   1. **Every refusal is RETURNED, never thrown.** Production replaces a
 *      thrown Server Action message with React's own "omitted in
 *      production builds" boilerplate, so "You already have a phase code
 *      04112" reads perfectly in `next dev` and reaches a real user as a
 *      dead button. `refusal()` below fails loudly on a throw rather than
 *      accepting it, the same way punchLists.test.ts does.
 *   2. **A duplicate code never escapes as a raw P2002.** The read-then-
 *      write check catches the ordinary case, and the constraint error
 *      catches the race — which is the half that actually reached a user
 *      in #224, where two concurrent submits read the same number and the
 *      second collided on a unique index.
 *   3. **NOTHING HERE DELETES.** A phase code with priced work against it
 *      is the evidence of how that work was coded on jobs that may
 *      already be invoiced, and the foreign key is ON DELETE SET NULL, so
 *      a delete would not even fail loudly — it would silently uncode
 *      every line the phase was on.
 */

let db = new FakeDb();

/** Swapped in for the one case a FakeDb cannot produce: a real unique-index
 * collision arriving from the database AFTER the read-then-write check has
 * already looked and found nothing. */
let collideOnWrite: "create" | "update" | null = null;

const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    const client = db.client() as unknown as Record<string, Record<string, unknown>>;
    if (!collideOnWrite) return client as never;
    const failing = collideOnWrite;
    return new Proxy(client, {
      get(target, property) {
        const model = target[property as string];
        if (property !== "phaseCode") return model;
        return {
          ...model,
          [failing]: () => {
            // The shape isUniqueConstraintError actually checks. It reads
            // `.code` rather than using `instanceof`, because that
            // instanceof is FALSE at runtime in this app — see the helper's
            // own note in shared.ts.
            const error = new Error("Unique constraint failed on the fields: (`companyId`,`code`)");
            (error as Error & { code?: string }).code = "P2002";
            throw error;
          },
        };
      },
    }) as never;
  },
}));

const { createPhaseCode, setPhaseCodeActive, updatePhaseCode } = await import("./phase-codes");
const phaseCodeModule = await import("./phase-codes");

async function refusal(pending: Promise<ActionResult>): Promise<string> {
  let result: ActionResult;
  try {
    result = await pending;
  } catch (err) {
    throw new Error(
      `THREW instead of returning: "${err instanceof Error ? err.message : String(err)}". ` +
        `A thrown Server Action message is redacted in production, so this sentence would ` +
        `never reach the user. Return it as { ok: false, error } instead.`,
    );
  }
  if (result.ok) throw new Error("the action SUCCEEDED — expected it to refuse");
  return result.error;
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function phaseCodes() {
  return db.rows("phaseCode");
}

function seedPhaseCode(over: Record<string, unknown> = {}) {
  return db.seed("phaseCode", {
    id: "pc_1",
    companyId: "co_1",
    code: "04112",
    name: "Plywood - SF",
    unit: "SF",
    tracksLabor: true,
    isActive: true,
    sortOrder: 0,
    ...over,
  });
}

beforeEach(() => {
  db = new FakeDb();
  collideOnWrite = null;
  context.role = "OWNER";
  context.jobFunction = null;
});

describe("what a phase code needs", () => {
  it("refuses a blank code with a sentence that says what a good one looks like", async () => {
    const message = await refusal(createPhaseCode(form({ code: "  ", name: "Plywood - SF" })));
    expect(message).toMatch(/code is required/i);
    expect(message).toContain("04112");
    expect(phaseCodes()).toHaveLength(0);
  });

  it("refuses a blank name the same way", async () => {
    const message = await refusal(createPhaseCode(form({ code: "04112", name: "" })));
    expect(message).toMatch(/what is this phase called/i);
    expect(phaseCodes()).toHaveLength(0);
  });

  it("refuses a sort order that is not a whole number", async () => {
    const message = await refusal(
      createPhaseCode(form({ code: "04112", name: "Plywood", sortOrder: "first" })),
    );
    expect(message).toMatch(/whole number/i);
    expect(phaseCodes()).toHaveLength(0);
  });

  it("stores the code and name trimmed, and an empty unit as null rather than ''", async () => {
    const result = await createPhaseCode(
      form({ code: "  04112 ", name: " Plywood - SF ", unit: "  " }),
    );
    expect(result).toEqual({ ok: true });
    expect(phaseCodes()[0]).toMatchObject({
      companyId: "co_1",
      code: "04112",
      name: "Plywood - SF",
      unit: null,
      sortOrder: 0,
    });
  });

  it("reads an unchecked 'tracks labour' box as false, not as the schema default", async () => {
    // An unchecked checkbox sends nothing at all. Defaulting absence to the
    // schema's `true` would make the box impossible to clear on the edit
    // form — it would silently re-tick itself on every save.
    await createPhaseCode(form({ code: "01000", name: "General conditions" }));
    expect(phaseCodes()[0].tracksLabor).toBe(false);

    await createPhaseCode(form({ code: "04112", name: "Plywood", tracksLabor: "on" }));
    expect(phaseCodes()[1].tracksLabor).toBe(true);
  });

  it("takes any free text as a code — nothing is checked against MasterFormat", async () => {
    // "We can rename our phase codes just so the way they appear in our
    // budget, they look the same." A product that refuses a code for not
    // being in a standard list is one nobody can enter their own budget
    // into.
    const result = await createPhaseCode(form({ code: "DW-ROCK/2", name: "Hang & finish" }));
    expect(result).toEqual({ ok: true });
    expect(phaseCodes()[0].code).toBe("DW-ROCK/2");
  });
});

describe("a duplicate code", () => {
  it("comes back as a sentence naming the code, and writes nothing", async () => {
    seedPhaseCode();
    const message = await refusal(createPhaseCode(form({ code: "04112", name: "Something else" })));
    expect(message).toContain("04112");
    expect(message).toMatch(/already have/i);
    expect(phaseCodes()).toHaveLength(1);
    expect(db.writes).not.toContain("phaseCode.create");
  });

  it("is still a sentence when the collision arrives from the database instead", async () => {
    // The race: two submits read the same empty result and the second one
    // loses on `@@unique([companyId, code])`. Nothing has looked at this
    // path in the app before #224, where the equivalent collision threw a
    // Prisma message that production redacts to nothing at all.
    collideOnWrite = "create";
    const message = await refusal(createPhaseCode(form({ code: "04112", name: "Plywood" })));
    expect(message).toContain("04112");
    expect(message).toMatch(/already have/i);
    expect(message).not.toMatch(/unique constraint/i);
  });

  it("does not count the row against ITSELF when its own code is unchanged", async () => {
    seedPhaseCode();
    const result = await updatePhaseCode("pc_1", form({ code: "04112", name: "Plywood — renamed" }));
    expect(result).toEqual({ ok: true });
    expect(phaseCodes()[0].name).toBe("Plywood — renamed");
  });

  it("refuses an edit that would collide with a DIFFERENT row", async () => {
    seedPhaseCode();
    seedPhaseCode({ id: "pc_2", code: "09220", name: "Metal framing" });
    const message = await refusal(updatePhaseCode("pc_2", form({ code: "04112", name: "Framing" })));
    expect(message).toContain("04112");
    expect(phaseCodes().find((row) => row.id === "pc_2")?.code).toBe("09220");
  });
});

describe("another company's phase code", () => {
  it("cannot be edited", async () => {
    seedPhaseCode({ companyId: "co_other" });
    const message = await refusal(updatePhaseCode("pc_1", form({ code: "99999", name: "Theirs" })));
    expect(message).toMatch(/no longer exists/i);
    expect(phaseCodes()[0].code).toBe("04112");
    expect(db.writes).not.toContain("phaseCode.update");
  });

  it("cannot be retired", async () => {
    seedPhaseCode({ companyId: "co_other" });
    const message = await refusal(setPhaseCodeActive("pc_1", false));
    expect(message).toMatch(/no longer exists/i);
    expect(phaseCodes()[0].isActive).toBe(true);
    expect(db.writes).not.toContain("phaseCode.update");
  });
});

describe("retiring", () => {
  it("flips the flag and leaves the row — a phase code is never deleted", async () => {
    seedPhaseCode();
    const result = await setPhaseCodeActive("pc_1", false);
    expect(result).toEqual({ ok: true });
    expect(phaseCodes()).toHaveLength(1);
    expect(phaseCodes()[0].isActive).toBe(false);
    // The claim that matters: the history coded to this phase survives.
    // ON DELETE SET NULL means a delete here would silently uncode every
    // line the phase was on rather than failing.
    expect(db.writes).not.toContain("phaseCode.delete");
    expect(db.writes).not.toContain("phaseCode.deleteMany");
  });

  it("is reversible in one call, because nothing was destroyed", async () => {
    seedPhaseCode({ isActive: false });
    expect(await setPhaseCodeActive("pc_1", true)).toEqual({ ok: true });
    expect(phaseCodes()[0].isActive).toBe(true);
  });

  it("has no delete action to reach for in the first place", async () => {
    // Structural, and deliberately not a comment: the rule is that this
    // module exports no delete, so the test is that it exports no delete.
    const exported = Object.keys(phaseCodeModule);
    expect(exported.sort()).toEqual(["createPhaseCode", "setPhaseCodeActive", "updatePhaseCode"]);
    expect(exported.filter((name) => /delete|remove|destroy/i.test(name))).toEqual([]);
  });
});

describe("who may do any of it", () => {
  it("refuses somebody whose job function does not include company settings", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    const message = await refusal(createPhaseCode(form({ code: "04112", name: "Plywood" })));
    expect(message).toMatch(/part of your job function/i);
    expect(phaseCodes()).toHaveLength(0);
  });

  it("checks the capability BEFORE the owner check, so the refusal names the real reason", async () => {
    // Someone who cannot reach this feature at all should be told that,
    // not told they are not the owner — the second sentence sends them to
    // ask an owner for something the owner cannot give them either.
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect(await refusal(setPhaseCodeActive("pc_1", false))).toMatch(/job function/i);

    context.jobFunction = "PAYROLL_COMPLIANCE"; // holds MANAGE_COMPLIANCE
    expect(await refusal(setPhaseCodeActive("pc_1", false))).toMatch(/account owner/i);
  });

  it("refuses a member who holds the capability but is not the owner, before writing", async () => {
    seedPhaseCode();
    context.role = "MEMBER";
    context.jobFunction = "PAYROLL_COMPLIANCE";
    const message = await refusal(updatePhaseCode("pc_1", form({ code: "04112", name: "Nope" })));
    expect(message).toMatch(/account owner/i);
    expect(phaseCodes()[0].name).toBe("Plywood - SF");
    expect(db.writes).not.toContain("phaseCode.update");
  });
});
