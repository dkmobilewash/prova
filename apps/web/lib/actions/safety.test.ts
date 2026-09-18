import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * One injury must produce one OSHA case (#111).
 *
 * `createSafetyIncident` had no barrier against being run twice. The
 * schema's only relevant constraint is
 * `@@unique([companyId, caseYear, caseNumber])`, and the counter hands the
 * second run a FRESH number — so the duplicate is unique by construction
 * and the database has no reason to refuse it. One injury becomes two
 * recordable cases in the count a GC reads at prequalification.
 *
 * Cleaning it up afterwards is worse than leaving it. `SafetyCaseCounter`
 * only ever increments, deliberately, so deleting the duplicate retires
 * its number for good — and the filed log then has a gap in the sequence
 * with nothing on the document to explain it.
 *
 * These assert on ROWS and on the counter, because neither is visible in a
 * return value: this action returns void, so a run that filed a second
 * case and a run that refused to look identical from the caller.
 */

let db = new FakeDb();
const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
  // Mutated by the capability cases below. ACCOUNTING is the job function
  // that holds no MANAGE_FIELD — see BY_FUNCTION in lib/permissions.ts.
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
    return db.client();
  },
}));

const {
  createSafetyIncident,
  updateSafetyIncident,
  createToolboxTalk,
  deleteToolboxTalk,
  deleteSafetyIncident,
} = await import("./safety");

/** One report of one injury, exactly as the form submits it. */
function report(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    occurredAt: "2026-08-14",
    employeeName: "Marco Ruiz",
    jobTitle: "Framer",
    location: "3rd floor east corridor",
    description: "Fell from a stilt walking backwards over a track offcut.",
    classification: "INJURY",
    outcome: "DAYS_AWAY",
    daysAway: "3",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

/** One toolbox talk, exactly as ToolboxTalkForm submits it. */
function talkForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    heldOn: "2026-08-14",
    topic: "Silica exposure when cutting board",
    presenter: "Ray Delgado",
    attendees: "Whole crew, per the sign-in sheet",
    notes: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function incidents() {
  return db.rows("safetyIncident");
}

function caseNumbers() {
  return incidents()
    .map((incident) => incident.caseNumber as number)
    .sort((a, b) => a - b);
}

/** How far the counter has been wound on. The gap in a filed log is made
 * here, not by the delete that exposes it. */
function counter() {
  const rows = db.rows("safetyCaseCounter");
  return rows.length === 0 ? 0 : (rows[0].lastCaseNumber as number);
}

beforeEach(() => {
  db = new FakeDb();
  context.role = "OWNER";
  context.jobFunction = null;
});

describe("createSafetyIncident files one case per injury", () => {
  it("issues case number 1 for the first report", async () => {
    await createSafetyIncident(report());

    expect(incidents()).toHaveLength(1);
    expect(caseNumbers()).toEqual([1]);
    expect(counter()).toBe(1);
  });

  it("files one case when the same injury is submitted twice", async () => {
    await createSafetyIncident(report());
    await createSafetyIncident(report());

    expect(incidents()).toHaveLength(1);
    expect(caseNumbers()).toEqual([1]);
  });

  it("does not burn a case number on the report it refuses", async () => {
    await createSafetyIncident(report());
    await createSafetyIncident(report());

    // The whole reason to refuse BEFORE the counter is touched. A guard
    // that ran after would leave the log numbered 1, 3, 4 — the same gap
    // as the deletion it was meant to make unnecessary.
    expect(counter()).toBe(1);
  });

  it("still files a second, genuinely different injury for the same person that day", async () => {
    await createSafetyIncident(report());
    await createSafetyIncident(
      report({ description: "Cut a hand on a stud track later the same shift." }),
    );

    // What happened is what identifies the case. Two different injuries to
    // one person on one day are two recordable cases, and a guard that
    // matched only on the person and the date would silently swallow the
    // second one.
    expect(incidents()).toHaveLength(2);
    expect(caseNumbers()).toEqual([1, 2]);
  });

  it("still files the same injury reported for a different person", async () => {
    await createSafetyIncident(report());
    await createSafetyIncident(report({ employeeName: "Dana Whitfield" }));

    expect(incidents()).toHaveLength(2);
    expect(caseNumbers()).toEqual([1, 2]);
  });
});

/* ------------------------------------------------------------------ *
 * Refusals the person filing can actually read
 * ------------------------------------------------------------------ */

/**
 * Four of the five actions in this module refused by THROWING.
 *
 * Production redacts the message of anything thrown out of a Server Action
 * (CLAUDE.md, verified 2026-08-27 on a real production build), and both
 * forms rendered `err.message` inside a `catch` — which in production is
 * React's "the specific message is omitted in production builds" paragraph
 * rather than the sentence the action wrote. So leaving the employee's name
 * blank on an injury report produced no usable reason, on the one form in
 * this app whose output is a document an OSHA inspector reads.
 *
 * Nothing in the suite could see it: the tests above assert on ROWS, which
 * is the right assertion for the duplicate-case guard and says nothing at
 * all about what comes back to the caller. `throw` and `return fail(...)`
 * leave identical rows.
 *
 * So these assert on the RETURN VALUE, and a revert to `throw` fails them
 * rather than passing them.
 */

/** Calls an action and reports what came back, so a throw is a VALUE this
 * file can assert on rather than a rejection that aborts the test before
 * it can say what it expected. */
async function outcome(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    return { threw: err instanceof Error ? err.message : String(err) };
  }
}

function talks() {
  return db.rows("toolboxTalk");
}

/** One filed case to edit or delete, already in the database. */
function seedIncident(overrides: Record<string, unknown> = {}) {
  return db.seed("safetyIncident", {
    id: "inc_1",
    companyId: "co_1",
    jobId: null,
    caseYear: 2026,
    caseNumber: 1,
    occurredAt: new Date("2026-08-14T00:00:00.000Z"),
    employeeName: "Marco Ruiz",
    jobTitle: "Framer",
    location: null,
    description: "Fell from a stilt walking backwards over a track offcut.",
    classification: "INJURY",
    outcome: "FIRST_AID_ONLY",
    daysAway: null,
    daysRestricted: null,
    reportedByUserId: "user_1",
    ...overrides,
  });
}

function seedTalk(overrides: Record<string, unknown> = {}) {
  return db.seed("toolboxTalk", {
    id: "talk_1",
    companyId: "co_1",
    jobId: null,
    heldOn: new Date("2026-08-14T00:00:00.000Z"),
    topic: "Silica exposure when cutting board",
    presenter: null,
    attendees: null,
    notes: null,
    recordedByUserId: "user_1",
    ...overrides,
  });
}

describe("createSafetyIncident returns its validation failures", () => {
  it("returns the missing-name sentence instead of throwing it", async () => {
    expect(await outcome(() => createSafetyIncident(report({ employeeName: "" })))).toEqual({
      ok: false,
      error: "Employee name is required",
    });
    // And nothing was filed — a refusal that half-wrote a case would be
    // worse than the digest it replaces.
    expect(incidents()).toHaveLength(0);
    expect(counter()).toBe(0);
  });

  it("returns the missing-description sentence", async () => {
    expect(await outcome(() => createSafetyIncident(report({ description: "" })))).toEqual({
      ok: false,
      error: "Description is required",
    });
  });

  it("returns the missing-date sentence", async () => {
    expect(await outcome(() => createSafetyIncident(report({ occurredAt: "" })))).toEqual({
      ok: false,
      error: "Date is required",
    });
  });

  it("returns the bad-outcome sentence, naming what is allowed", async () => {
    const result = (await outcome(() =>
      createSafetyIncident(report({ outcome: "SPRAINED_ANKLE" })),
    )) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("DAYS_AWAY");
  });

  it("returns the day-count sentence when days away is not a whole number", async () => {
    const result = (await outcome(() => createSafetyIncident(report({ daysAway: "-2" })))) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("whole number of days");
  });

  it("returns ok on a valid report, and files the case", async () => {
    expect(await outcome(() => createSafetyIncident(report()))).toEqual({ ok: true });
    expect(incidents()).toHaveLength(1);
  });

  it("returns ok on the duplicate it silently declines to file a second time", async () => {
    await createSafetyIncident(report());
    // Truthfully ok: the case IS on the log. The guard above is not a
    // failure to report to the person who resubmitted.
    expect(await outcome(() => createSafetyIncident(report()))).toEqual({ ok: true });
    expect(incidents()).toHaveLength(1);
  });
});

describe("updateSafetyIncident returns its validation failures", () => {
  it("returns the missing-name sentence instead of throwing it", async () => {
    seedIncident();
    expect(await outcome(() => updateSafetyIncident("inc_1", report({ employeeName: "" })))).toEqual(
      { ok: false, error: "Employee name is required" },
    );
    // The stored case is untouched, not half-edited.
    expect(incidents()[0].employeeName).toBe("Marco Ruiz");
  });

  it("returns a sentence for a case that is not this company's", async () => {
    seedIncident({ companyId: "co_2" });
    const result = (await outcome(() => updateSafetyIncident("inc_1", report()))) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no longer exists");
  });

  it("returns ok on a valid edit, and saves it", async () => {
    seedIncident();
    expect(await outcome(() => updateSafetyIncident("inc_1", report({ jobTitle: "Taper" })))).toEqual(
      { ok: true },
    );
    expect(incidents()[0].jobTitle).toBe("Taper");
  });
});

describe("createToolboxTalk returns its validation failures", () => {
  it("returns the missing-topic sentence instead of throwing it", async () => {
    expect(await outcome(() => createToolboxTalk(talkForm({ topic: "" })))).toEqual({
      ok: false,
      error: "Topic is required",
    });
    expect(talks()).toHaveLength(0);
  });

  it("returns the missing-date sentence", async () => {
    expect(await outcome(() => createToolboxTalk(talkForm({ heldOn: "" })))).toEqual({
      ok: false,
      error: "Date is required",
    });
    expect(talks()).toHaveLength(0);
  });

  it("returns ok on a valid talk, and logs it", async () => {
    expect(await outcome(() => createToolboxTalk(talkForm()))).toEqual({ ok: true });
    expect(talks()).toHaveLength(1);
  });
});

describe("deleteToolboxTalk returns its refusals", () => {
  it("returns the owner refusal instead of throwing it", async () => {
    seedTalk();
    context.role = "MEMBER";
    const result = (await outcome(() => deleteToolboxTalk("talk_1"))) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Only the account owner can remove a toolbox talk");
    expect(talks()).toHaveLength(1);
  });

  it("returns a sentence for a talk that is not this company's", async () => {
    seedTalk({ companyId: "co_2" });
    const result = (await outcome(() => deleteToolboxTalk("talk_1"))) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no longer exists");
    expect(talks()).toHaveLength(1);
  });

  it("returns ok for the owner, and removes it", async () => {
    seedTalk();
    expect(await outcome(() => deleteToolboxTalk("talk_1"))).toEqual({ ok: true });
    expect(talks()).toHaveLength(0);
  });
});

/**
 * The capability refusal, RETURNED.
 *
 * `lib/action-capability-guards.test.ts` already proves each of these
 * refuses somebody without MANAGE_FIELD, and it deliberately accepts a
 * throw or a return — it is asking whether the endpoint is open, which is a
 * different question. This asks the one that file does not: does the
 * refusal come back as a value the form can render.
 */
describe("the capability refusal comes back as a value, not a throw", () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["createSafetyIncident", () => createSafetyIncident(report())],
    ["updateSafetyIncident", () => updateSafetyIncident("inc_1", report())],
    ["createToolboxTalk", () => createToolboxTalk(talkForm())],
    ["deleteToolboxTalk", () => deleteToolboxTalk("talk_1")],
    ["deleteSafetyIncident", () => deleteSafetyIncident("inc_1")],
  ];

  for (const [name, call] of cases) {
    it(`${name} returns the refusal to an ACCOUNTING member`, async () => {
      seedIncident();
      seedTalk();
      context.role = "MEMBER";
      context.jobFunction = "ACCOUNTING";

      const result = (await outcome(call)) as { ok?: boolean; error?: string };
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/part of your job function/);
      // The guard runs before anything is written, not after.
      expect(db.writes).toEqual([]);
    });
  }

  it("lets a FIELD member through, so the cases above are not refusing everyone", async () => {
    // The control. Without it, an action that refused every caller would
    // satisfy every assertion above perfectly.
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect(await outcome(() => createSafetyIncident(report()))).toEqual({ ok: true });
    expect(incidents()).toHaveLength(1);
  });
});

/**
 * The guard that would have caught this in the first place.
 *
 * Every assertion above names an action, so a SIXTH action added to this
 * module tomorrow with a `throw` in it passes the whole suite — which is
 * how four of the five got here. This derives the set from the source
 * instead, and asserts its SIZE against a count the parser cannot shrink
 * with it: a pattern matching nothing would otherwise satisfy "every parsed
 * action returns ActionResult" vacuously, the way
 * scratch-cleanup-order.test.ts stayed green at 180 of 181 foreign keys.
 */
describe("every exported action in this module promises a readable refusal", () => {
  const source = readFileSync(fileURLToPath(new URL("./safety.ts", import.meta.url)), "utf8");

  /** name -> the text between the closing paren and the body brace. */
  const declared = [
    ...source.matchAll(/export\s+async\s+function\s+(\w+)\s*\([^)]*\)\s*([^{]*)\{/g),
  ];

  it("parses every exported action the file contains", () => {
    const independent = (source.match(/export\s+async\s+function\s+\w+\s*\(/g) ?? []).length;
    expect(declared.length).toBe(independent);
    // The literal, so adding or removing an action is a deliberate edit to
    // this line rather than a number that drifts silently.
    expect(declared.length).toBe(5);
  });

  it("declares Promise<ActionResult> on every one of them", () => {
    const wrong = declared
      .filter((match) => !/Promise<ActionResult>/.test(match[2]))
      .map((match) => match[1]);
    expect(
      wrong,
      `These actions do not promise a refusal the form can render, so their failures ` +
        `are thrown and production redacts them to a digest: ${wrong.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The other half, and the half that reaches the person.
   *
   * An action returning `{ ok: false, error }` to a form that still wraps it
   * in `try/catch` and renders `err.message` fixes nothing: the catch never
   * runs, and the form closes as though the save succeeded. So the
   * components are checked too — derived from the source, and size-asserted,
   * because a scan that found no safety components would otherwise pass
   * every assertion under it.
   */
  const componentsDir = fileURLToPath(new URL("../../components", import.meta.url));
  const ACTIONS = [
    "createSafetyIncident",
    "updateSafetyIncident",
    "deleteSafetyIncident",
    "createToolboxTalk",
    "deleteToolboxTalk",
  ];

  /** Comments are stripped before anything is matched. #185 is the version
   * of this where a comment quoting a pattern DISARMED a census; this is the
   * same hazard from the other side — the comments these components now
   * carry explain the defect by naming `err.message`, and a scan that read
   * them would fail on the very files it was written to bless. */
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const callers = readdirSync(componentsDir)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => ({
      name,
      text: stripComments(readFileSync(join(componentsDir, name), "utf8")),
    }))
    .filter((file) => ACTIONS.some((action) => file.text.includes(`${action}(`)));

  it("finds every component that calls one of these actions", () => {
    expect(callers.map((f) => f.name).sort()).toEqual([
      "SafetyIncidentForm.tsx",
      "SafetyIncidentRow.tsx",
      "ToolboxTalkForm.tsx",
      "ToolboxTalkRow.tsx",
    ]);
  });

  for (const { name } of callers) {
    it(`${name} renders the returned refusal rather than a caught throw`, () => {
      const text = callers.find((f) => f.name === name)!.text;
      expect(text).toContain("result.ok");
      // `err.message` here is React's production redaction paragraph, not
      // anything this app wrote.
      expect(text).not.toContain("err.message");
      expect(text).not.toContain("instanceof Error");
    });
  }

  it("leaves no bare `throw new Error` for the user to never read", () => {
    // `InputError` is the permitted throw: runAction converts it to a
    // returned failure at the boundary. A bare Error is a genuine bug, and
    // this module has none — so any appearance of one is a regression to
    // the shape this change removed.
    expect(source.match(/throw new Error\(/g) ?? []).toEqual([]);
    // And the permitted kind is really there, so the check above is not
    // passing on a file that simply stopped validating anything.
    expect((source.match(/throw new InputError\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
