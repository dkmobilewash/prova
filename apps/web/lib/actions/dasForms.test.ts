import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The DAS writes, and the four rules that make these records evidence rather
 * than notes.
 *
 *   1. MANAGE_COMPLIANCE, RETURNED and never thrown, before anything is read.
 *      Production redacts a thrown Server Action message, so a refusal that
 *      throws reaches a real user as a digest.
 *   2. IDENTITY IS LOCKED. `craftName` is snapshotted from the committee at
 *      creation and never re-read through the relation, so renaming a
 *      committee's craft cannot rewrite what a committee was told.
 *   3. SENT CORRESPONDENCE CLOSES, NEVER DELETES — owner included — and once
 *      sent, only the notes may change. Everything else was on the paper.
 *   4. THE SENT DATE IS RECORDED ONCE. It is the whole of the ten-day and
 *      72-hour tests, and a compliance date that can be quietly edited
 *      afterwards is not evidence of anything.
 *
 * A HAND-ROLLED PRISMA STUB rather than `FakeDb`, deliberately: these actions
 * read with a nested tenant predicate (`{ id, job: { companyId } }`) and with
 * `_count`, and `FakeDb` matches a `where` by top-level equality. Passing it a
 * nested object would make every read miss, and a test where every read
 * returns null would pass against an action with no guards at all — the
 * "answering a question nobody asked" shape CLAUDE.md keeps paying for. So the
 * stub is explicit about what it returns and records every write.
 */

type Row = Record<string, unknown>;

const store: {
  committee: Row | null;
  job: Row | null;
  notice: Row | null;
  request: Row | null;
  duplicateOnWrite: boolean;
  writes: { table: string; op: string; data?: Row }[];
} = {
  committee: null,
  job: null,
  notice: null,
  request: null,
  duplicateOnWrite: false,
  writes: [],
};

const context = {
  company: { id: "co_A" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function uniqueError() {
  const error = new Error("Unique constraint failed");
  (error as Error & { code?: string }).code = "P2002";
  return error;
}

function writer(table: string, row: () => Row | null) {
  return {
    findFirst: async () => row(),
    findUnique: async () => row(),
    create: async ({ data }: { data: Row }) => {
      if (store.duplicateOnWrite) throw uniqueError();
      store.writes.push({ table, op: "create", data });
      return { id: `${table}_1`, ...data };
    },
    update: async ({ data }: { data: Row }) => {
      if (store.duplicateOnWrite) throw uniqueError();
      store.writes.push({ table, op: "update", data });
      return { ...(row() ?? {}), ...data };
    },
    delete: async () => {
      store.writes.push({ table, op: "delete" });
      return row();
    },
  };
}

vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: {
    job: writer("job", () => store.job),
    apprenticeshipCommittee: writer("apprenticeshipCommittee", () => store.committee),
    craftClassification: { findFirst: async () => ({ id: "craft_1", companyId: "co_A" }) },
    das140Notice: writer("das140Notice", () => store.notice),
    das142Request: writer("das142Request", () => store.request),
  },
}));

const actions = await import("./dasForms");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const COMMITTEE = {
  id: "cm_1",
  companyId: "co_A",
  name: "Central Valley Drywall/Lathing JATC",
  craftName: "Drywall/Lathers",
  geographicArea: "Fresno county",
  _count: { das140Notices: 0, das142Requests: 0 },
};

const GOOD_140 = {
  committeeId: "cm_1",
  election: "APPROVED_TO_TRAIN",
  contractExecutedOn: "2026-09-01",
  estimatedJourneymanHours: "1800",
  estimatedApprenticeHours: "360",
  projectIdentifier: "CUSD-2026-114",
};

const GOOD_142 = {
  committeeId: "cm_1",
  apprenticesRequested: "2",
  neededFrom: "2026-09-30",
  projectIdentifier: "CUSD-2026-114",
};

beforeEach(() => {
  store.committee = { ...COMMITTEE };
  store.job = { id: "job_1", companyId: "co_A" };
  store.notice = null;
  store.request = null;
  store.duplicateOnWrite = false;
  store.writes = [];
  context.role = "OWNER";
  context.jobFunction = null;
});

describe("the capability gate", () => {
  const gated: [string, () => Promise<unknown>][] = [
    ["createApprenticeshipCommittee", () => actions.createApprenticeshipCommittee(form({ name: "x" }))],
    ["updateApprenticeshipCommittee", () => actions.updateApprenticeshipCommittee("cm_1", form({ name: "x" }))],
    ["deleteApprenticeshipCommittee", () => actions.deleteApprenticeshipCommittee("cm_1")],
    ["createDas140Notice", () => actions.createDas140Notice("job_1", form(GOOD_140))],
    ["updateDas140Notice", () => actions.updateDas140Notice("n_1", form(GOOD_140))],
    ["recordDas140Sent", () => actions.recordDas140Sent("n_1", form({ sentOn: "2026-09-02" }))],
    ["deleteDas140Notice", () => actions.deleteDas140Notice("n_1")],
    ["createDas142Request", () => actions.createDas142Request("job_1", form(GOOD_142))],
    ["updateDas142Request", () => actions.updateDas142Request("r_1", form(GOOD_142))],
    ["recordDas142Sent", () => actions.recordDas142Sent("r_1", form({ requestedOn: "2026-09-02" }))],
    ["recordDas142Response", () => actions.recordDas142Response("r_1", form({}))],
    ["deleteDas142Request", () => actions.deleteDas142Request("r_1")],
  ];

  it.each(gated)("%s refuses a job function without MANAGE_COMPLIANCE, and writes nothing", async (_name, run) => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    const result = (await run()) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/part of your job function/);
    expect(store.writes).toEqual([]);
  });

  it("names the reason rather than throwing it, on every one", async () => {
    // Production redacts a thrown message to a digest. A returned sentence is
    // the only kind a real user ever reads.
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    for (const [, run] of gated) {
      await expect(run()).resolves.toMatchObject({ ok: false });
    }
  });
});

describe("creating a DAS 140", () => {
  it("snapshots the craft off the committee rather than joining to it", async () => {
    const result = await actions.createDas140Notice("job_1", form(GOOD_140));
    expect(result).toEqual({ ok: true });
    expect(store.writes[0].data).toMatchObject({
      jobId: "job_1",
      committeeId: "cm_1",
      craftName: "Drywall/Lathers",
      election: "APPROVED_TO_TRAIN",
    });
  });

  it("stores the contract date at UTC midnight, never stamped from now", async () => {
    await actions.createDas140Notice("job_1", form(GOOD_140));
    const stored = store.writes[0].data!.contractExecutedOn as Date;
    expect(stored.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("refuses without a box ticked, and picks none for you", async () => {
    const result = await actions.createDas140Notice("job_1", form({ ...GOOD_140, election: "" }));
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/Tick one of the three boxes/);
    expect(store.writes).toEqual([]);
  });

  it("refuses without the contract date, because the deadline runs from it", async () => {
    const result = await actions.createDas140Notice(
      "job_1",
      form({ ...GOOD_140, contractExecutedOn: "" }),
    );
    expect((result as { error: string }).error).toMatch(/ten-day clock starts there/);
    expect(store.writes).toEqual([]);
  });

  it("leaves blank hour estimates null rather than defaulting them to zero", async () => {
    await actions.createDas140Notice(
      "job_1",
      form({ ...GOOD_140, estimatedJourneymanHours: "", estimatedApprenticeHours: "" }),
    );
    expect(store.writes[0].data).toMatchObject({
      estimatedJourneymanHours: null,
      estimatedApprenticeHours: null,
    });
  });

  it("refuses another company's committee", async () => {
    store.committee = null;
    const result = await actions.createDas140Notice("job_1", form(GOOD_140));
    expect((result as { error: string }).error).toMatch(/isn't one of yours/);
    expect(store.writes).toEqual([]);
  });

  it("refuses another company's job", async () => {
    store.job = null;
    const result = await actions.createDas140Notice("job_1", form(GOOD_140));
    expect((result as { error: string }).error).toMatch(/isn't on this company/);
    expect(store.writes).toEqual([]);
  });

  it("reads a duplicate back as a sentence, not a redacted throw", async () => {
    store.duplicateOnWrite = true;
    const result = await actions.createDas140Notice("job_1", form(GOOD_140));
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/already recorded on this job/);
  });
});

describe("a DAS 140 that has been sent", () => {
  const SENT = {
    id: "n_1",
    jobId: "job_1",
    sentOn: new Date("2026-09-05T00:00:00.000Z"),
    note: "old",
    proofNote: null,
  };

  it("cannot be deleted, by the OWNER", async () => {
    store.notice = { ...SENT };
    const result = await actions.deleteDas140Notice("n_1");
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/cannot\s+be removed, by anyone/);
    expect(store.writes).toEqual([]);
  });

  it("cannot have its sent date changed", async () => {
    store.notice = { ...SENT };
    const result = await actions.recordDas140Sent(
      "n_1",
      form({ sentOn: "2026-09-02", sentMethod: "FAX" }),
    );
    expect((result as { error: string }).error).toMatch(/already recorded as sent on 2026-09-05/);
    expect((result as { error: string }).error).toMatch(/cannot be edited/);
    expect(store.writes).toEqual([]);
  });

  it("accepts only the two notes on an edit, and touches nothing else", async () => {
    store.notice = { ...SENT };
    const result = await actions.updateDas140Notice(
      "n_1",
      form({ ...GOOD_140, contractExecutedOn: "2026-01-01", note: "new", proofNote: "fax slip" }),
    );
    expect(result).toEqual({ ok: true });
    expect(store.writes).toHaveLength(1);
    // The contract date in the form is IGNORED. A sent notice's substance is
    // what went to the committee.
    expect(store.writes[0].data).toEqual({ note: "new", proofNote: "fax slip" });
  });
});

describe("a DAS 140 that has not been sent", () => {
  beforeEach(() => {
    store.notice = { id: "n_1", jobId: "job_1", sentOn: null, note: null, proofNote: null };
  });

  it("can be deleted by the owner", async () => {
    const result = await actions.deleteDas140Notice("n_1");
    expect(result).toEqual({ ok: true });
    expect(store.writes).toEqual([{ table: "das140Notice", op: "delete" }]);
  });

  it("cannot be deleted by anybody else, and the refusal is a sentence", async () => {
    context.role = "MEMBER";
    context.jobFunction = "PAYROLL_COMPLIANCE";
    const result = await actions.deleteDas140Notice("n_1");
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toBe("Only the account owner can remove a DAS 140.");
    expect(store.writes).toEqual([]);
  });

  it("takes a full edit — the substance is still editable before it goes out", async () => {
    const result = await actions.updateDas140Notice(
      "n_1",
      form({ ...GOOD_140, contractExecutedOn: "2026-09-02" }),
    );
    expect(result).toEqual({ ok: true });
    const data = store.writes[0].data!;
    expect((data.contractExecutedOn as Date).toISOString()).toBe("2026-09-02T00:00:00.000Z");
    // And never the identity fields.
    expect(data).not.toHaveProperty("jobId");
    expect(data).not.toHaveProperty("committeeId");
    expect(data).not.toHaveProperty("craftName");
  });

  it("records the send, with the date and the method, and needs both", async () => {
    const noDate = await actions.recordDas140Sent("n_1", form({ sentMethod: "FAX" }));
    expect((noDate as { error: string }).error).toMatch(/not today/);
    const noMethod = await actions.recordDas140Sent("n_1", form({ sentOn: "2026-09-04" }));
    expect((noMethod as { error: string }).error).toMatch(/Proof of transmission/);
    expect(store.writes).toEqual([]);

    const ok = await actions.recordDas140Sent(
      "n_1",
      form({ sentOn: "2026-09-04", sentMethod: "FAX", proofNote: "confirmation in folder" }),
    );
    expect(ok).toEqual({ ok: true });
    expect((store.writes[0].data!.sentOn as Date).toISOString()).toBe("2026-09-04T00:00:00.000Z");
    expect(store.writes[0].data).toMatchObject({ sentMethod: "FAX" });
  });
});

describe("a DAS 142", () => {
  it("snapshots the craft and the count it was given", async () => {
    const result = await actions.createDas142Request("job_1", form(GOOD_142));
    expect(result).toEqual({ ok: true });
    expect(store.writes[0].data).toMatchObject({
      craftName: "Drywall/Lathers",
      apprenticesRequested: 2,
    });
    expect((store.writes[0].data!.neededFrom as Date).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("refuses a count it cannot read, and a comma is not an error", async () => {
    const blank = await actions.createDas142Request(
      "job_1",
      form({ ...GOOD_142, apprenticesRequested: "" }),
    );
    expect((blank as { error: string }).error).toMatch(/How many apprentices/);
    const words = await actions.createDas142Request(
      "job_1",
      form({ ...GOOD_142, apprenticesRequested: "two" }),
    );
    expect(words).toMatchObject({ ok: false });
    expect(store.writes).toEqual([]);
  });

  it("refuses a date range that runs backwards", async () => {
    const result = await actions.createDas142Request(
      "job_1",
      form({ ...GOOD_142, neededTo: "2026-09-20" }),
    );
    expect((result as { error: string }).error).toMatch(/cannot be before the first/);
    expect(store.writes).toEqual([]);
  });

  it("refuses without the day somebody is needed, because the lead time counts back from it", async () => {
    const result = await actions.createDas142Request("job_1", form({ ...GOOD_142, neededFrom: "" }));
    expect((result as { error: string }).error).toMatch(/72-hour lead time counts back/);
  });

  it("freezes the needed-from date once sent", async () => {
    store.request = {
      id: "r_1",
      jobId: "job_1",
      requestedOn: new Date("2026-09-24T00:00:00.000Z"),
      note: null,
      proofNote: null,
    };
    const result = await actions.updateDas142Request(
      "r_1",
      form({ ...GOOD_142, neededFrom: "2026-11-30", note: "chased them" }),
    );
    expect(result).toEqual({ ok: true });
    // Moving the anchor would turn a short-notice request into a timely one.
    expect(store.writes[0].data).toEqual({ note: "chased them", proofNote: null });
  });

  it("cannot be deleted once sent, owner included", async () => {
    store.request = { id: "r_1", jobId: "job_1", requestedOn: new Date("2026-09-24T00:00:00.000Z") };
    const result = await actions.deleteDas142Request("r_1");
    expect((result as { error: string }).error).toMatch(/shows you asked/);
    expect(store.writes).toEqual([]);
  });

  it("will not record a reply to a request that never went", async () => {
    store.request = { id: "r_1", jobId: "job_1", requestedOn: null };
    const result = await actions.recordDas142Response("r_1", form({ outcome: "DISPATCHED" }));
    expect((result as { error: string }).error).toMatch(/cannot answer one that never went/);
    expect(store.writes).toEqual([]);
  });

  it("records a reply, and keeps 'nothing recorded' apart from 'no reply'", async () => {
    store.request = { id: "r_1", jobId: "job_1", requestedOn: new Date("2026-09-24T00:00:00.000Z") };
    await actions.recordDas142Response(
      "r_1",
      form({ respondedOn: "2026-09-26", outcome: "UNABLE_TO_DISPATCH", outcomeNote: "none available" }),
    );
    expect(store.writes[0].data).toMatchObject({
      outcome: "UNABLE_TO_DISPATCH",
      outcomeNote: "none available",
    });

    store.writes = [];
    await actions.recordDas142Response("r_1", form({}));
    // Cleared back to null — "nobody has recorded a reply" — never to
    // NO_RESPONSE, which is the claim that somebody checked.
    expect(store.writes[0].data).toMatchObject({ outcome: null, respondedOn: null });
  });

  it("is editable in full before it goes out, identity excepted", async () => {
    store.request = { id: "r_1", jobId: "job_1", requestedOn: null, note: null, proofNote: null };
    await actions.updateDas142Request("r_1", form({ ...GOOD_142, apprenticesRequested: "3" }));
    const data = store.writes[0].data!;
    expect(data).toMatchObject({ apprenticesRequested: 3 });
    expect(data).not.toHaveProperty("committeeId");
    expect(data).not.toHaveProperty("craftName");
    expect(data).not.toHaveProperty("jobId");
  });
});

describe("the committee directory", () => {
  it("records exactly what was typed, and invents no contact detail", async () => {
    store.committee = null; // no duplicate on file
    const result = await actions.createApprenticeshipCommittee(
      form({
        name: "Central Valley Drywall/Lathing JATC",
        craftName: "Drywall/Lathers",
        geographicArea: "Fresno county",
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(store.writes[0].data).toMatchObject({
      companyId: "co_A",
      addressLine1: null,
      city: null,
      email: null,
      fax: null,
      programSponsorNumber: null,
      // The third state: nobody said whether they approved us to train, and
      // 8 CCR 230(a) branches on it, so it must not default to false.
      approvedToTrainUs: null,
    });
  });

  it("keeps 'not recorded' apart from 'no' on approved-to-train", async () => {
    store.committee = null;
    for (const [input, stored] of [["yes", true], ["no", false], ["", null]] as const) {
      store.writes = [];
      await actions.createApprenticeshipCommittee(
        form({ name: "n", craftName: "c", geographicArea: "g", approvedToTrainUs: input }),
      );
      expect(store.writes[0].data!.approvedToTrainUs, input).toBe(stored);
    }
  });

  it("insists on the three fields that decide who gets a notice", async () => {
    store.committee = null;
    for (const [missing, pattern] of [
      ["name", /Name the committee/],
      ["craftName", /a notice goes per craft/],
      ["geographicArea", /whether this committee gets the notice/],
    ] as const) {
      const values: Record<string, string> = {
        name: "n",
        craftName: "c",
        geographicArea: "g",
      };
      values[missing] = "";
      const result = await actions.createApprenticeshipCommittee(form(values));
      expect((result as { error: string }).error, missing).toMatch(pattern);
    }
    expect(store.writes).toEqual([]);
  });

  it("never lets an edit rewrite the craft the notices already carry", async () => {
    const result = await actions.updateApprenticeshipCommittee(
      "cm_1",
      form({ name: "Renamed JATC", craftName: "Something Else", geographicArea: "Fresno county" }),
    );
    expect(result).toEqual({ ok: true });
    expect(store.writes[0].data).toMatchObject({ name: "Renamed JATC" });
    expect(store.writes[0].data).not.toHaveProperty("craftName");
  });

  it("refuses to remove a committee that notices point at, and names the counts", async () => {
    store.committee = { ...COMMITTEE, _count: { das140Notices: 2, das142Requests: 1 } };
    const result = await actions.deleteApprenticeshipCommittee("cm_1");
    expect(result).toMatchObject({ ok: false });
    const error = (result as { error: string }).error;
    expect(error).toContain("2 DAS 140 notices");
    expect(error).toContain("1 DAS 142 request");
    expect(store.writes).toEqual([]);
  });

  it("removes one nothing points at", async () => {
    const result = await actions.deleteApprenticeshipCommittee("cm_1");
    expect(result).toEqual({ ok: true });
    expect(store.writes).toEqual([{ table: "apprenticeshipCommittee", op: "delete" }]);
  });

  it("is owner-only to remove, and the refusal RETURNS", async () => {
    context.role = "MEMBER";
    context.jobFunction = "PAYROLL_COMPLIANCE";
    const result = await actions.deleteApprenticeshipCommittee("cm_1");
    expect(result).toEqual({
      ok: false,
      error: "Only the account owner can remove a committee.",
    });
    expect(store.writes).toEqual([]);
  });

  it("reads a duplicate entry back as a sentence", async () => {
    // store.committee is the existing row, so the duplicate guard finds it.
    const result = await actions.createApprenticeshipCommittee(
      form({
        name: "Central Valley Drywall/Lathing JATC",
        craftName: "Drywall/Lathers",
        geographicArea: "Fresno county",
      }),
    );
    expect((result as { error: string }).error).toMatch(/already recorded for this craft and area/);
    expect(store.writes).toEqual([]);
  });
});
