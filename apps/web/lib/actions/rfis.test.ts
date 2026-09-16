import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";
import type { ActionResult } from "./shared";

/**
 * Every refusal this module makes must be RETURNED, not thrown.
 *
 * THIS IS THE MODULE THE RULE WAS WRITTEN FOR. Eleven guards, every one a
 * sentence somebody sat down and wrote for a person who may end up quoting
 * this log in a dispute — "Send this RFI before recording an answer", "The
 * answer can't have come back before the RFI was sent" — and every one of
 * them thrown. Production replaces a thrown Server Action message with
 * React's own boilerplate (the installed react-server-dom-webpack's
 * production `emitErrorChunk(request, id, digest)` takes no error argument;
 * the browser's `resolveErrorProd()` takes none either and builds a fixed
 * "the specific message is omitted in production builds" Error), so not one
 * of these sentences has ever been read by a user of the RFI page.
 *
 * `refusal()` therefore treats a throw as a FAILURE rather than as a pass.
 * A test written `expect(...).rejects.toThrow("Send this RFI…")` would have
 * been green for the whole of the time this defect existed, which is exactly
 * why it is not written that way.
 */

let db = new FakeDb();

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
    return db.client();
  },
}));

const { createRfi, updateRfi, markRfiSent, answerRfi, setRfiClosed, deleteRfi } = await import(
  "./rfis"
);

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

/** A complete, valid raise-an-RFI submission, so each case below changes
 * exactly one thing. */
function raise(overrides: Record<string, string> = {}) {
  return form({
    jobId: "job_1",
    subject: "Corridor header detail",
    question: "Which detail governs at the corridor head — A5.1/3 or the RCP?",
    sentOn: "2026-09-01",
    ...overrides,
  });
}

function rfis() {
  return db.rows("rfi");
}

/** A UTC-midnight date, the way this module stores every date. */
function day(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

beforeEach(() => {
  db = new FakeDb();
  context.role = "OWNER";
  context.jobFunction = null;
  db.seed("job", { id: "job_1", companyId: "co_1" });
  // Another company's job, so "Job not found" cannot pass merely because
  // the row is absent.
  db.seed("job", { id: "job_other", companyId: "co_2" });
});

describe("createRfi returns its refusals", () => {
  it("says the job is required", async () => {
    expect(await refusal(createRfi(raise({ jobId: "" })))).toBe("Job is required");
    expect(rfis()).toHaveLength(0);
  });

  it("says the job was not found when it belongs to another company", async () => {
    expect(await refusal(createRfi(raise({ jobId: "job_other" })))).toBe("Job not found");
    expect(rfis()).toHaveLength(0);
  });

  it("says the subject is required", async () => {
    expect(await refusal(createRfi(raise({ subject: "   " })))).toBe("Subject is required");
    expect(rfis()).toHaveLength(0);
  });

  it("says the question is required", async () => {
    expect(await refusal(createRfi(raise({ question: "" })))).toBe("Question is required");
    expect(rfis()).toHaveLength(0);
  });

  it("says a date is not valid, and issues no number for it", async () => {
    expect(await refusal(createRfi(raise({ dueBy: "2026-13-45" })))).toBe("Date is not valid");
    expect(rfis()).toHaveLength(0);
    // The counter must not have been wound on — a refused RFI that consumed
    // a number leaves a permanent hole in the GC's numbering.
    expect(db.rows("rfiCounter")).toHaveLength(0);
  });

  it("returns the job-function refusal rather than throwing it", async () => {
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING"; // holds no MANAGE_JOBS
    expect(await refusal(createRfi(raise()))).toMatch(/part of your job function/);
    expect(rfis()).toHaveLength(0);
  });

  // The control. Every assertion above is satisfied by an action that
  // refuses everything, so one submission has to get all the way through.
  it("still raises the RFI when the form is right", async () => {
    expect(await createRfi(raise())).toEqual({ ok: true });
    expect(rfis()).toHaveLength(1);
    expect(rfis()[0].number).toBe(1);
    expect(rfis()[0].status).toBe("SENT");
  });
});

describe("updateRfi returns its refusals", () => {
  it("says it was not found when it belongs to another company", async () => {
    db.seed("rfi", { id: "rfi_other", companyId: "co_2", jobId: "job_1", status: "DRAFT" });
    expect(await refusal(updateRfi("rfi_other", raise()))).toBe("RFI not found");
  });

  it("refuses to turn a sent RFI back into a draft, and says why", async () => {
    db.seed("rfi", {
      id: "rfi_1",
      companyId: "co_1",
      jobId: "job_1",
      status: "SENT",
      sentOn: day("2026-09-01"),
      answeredOn: null,
    });

    // Clearing the sent date is the whole bypass: a draft can be deleted,
    // and a sent RFI is correspondence the GC also holds.
    expect(await refusal(updateRfi("rfi_1", raise({ sentOn: "" })))).toBe(
      "This RFI has already been sent, so it can't go back to being a draft",
    );
    expect(rfis()[0].sentOn).toEqual(day("2026-09-01"));
    expect(rfis()[0].status).toBe("SENT");
  });

  it("refuses a sent date after the answer came back", async () => {
    db.seed("rfi", {
      id: "rfi_1",
      companyId: "co_1",
      jobId: "job_1",
      status: "ANSWERED",
      sentOn: day("2026-09-01"),
      answeredOn: day("2026-09-05"),
    });

    expect(await refusal(updateRfi("rfi_1", raise({ sentOn: "2026-09-09" })))).toBe(
      "The sent date can't be after the date the answer came back",
    );
    expect(rfis()[0].sentOn).toEqual(day("2026-09-01"));
  });

  it("says the subject is required", async () => {
    db.seed("rfi", {
      id: "rfi_1",
      companyId: "co_1",
      jobId: "job_1",
      status: "DRAFT",
      sentOn: null,
      answeredOn: null,
      subject: "Original",
    });

    expect(await refusal(updateRfi("rfi_1", raise({ subject: "", sentOn: "" })))).toBe(
      "Subject is required",
    );
    expect(rfis()[0].subject).toBe("Original");
  });

  it("still saves the edit when it is legal", async () => {
    db.seed("rfi", {
      id: "rfi_1",
      companyId: "co_1",
      jobId: "job_1",
      status: "SENT",
      sentOn: day("2026-09-01"),
      answeredOn: null,
      subject: "Original",
    });

    expect(await updateRfi("rfi_1", raise({ subject: "Corrected subject" }))).toEqual({ ok: true });
    expect(rfis()[0].subject).toBe("Corrected subject");
  });
});

describe("markRfiSent returns its refusals", () => {
  it("says it was not found", async () => {
    expect(await refusal(markRfiSent("nope"))).toBe("RFI not found");
  });

  it("says it has already been sent", async () => {
    db.seed("rfi", {
      id: "rfi_1",
      companyId: "co_1",
      jobId: "job_1",
      status: "SENT",
      sentOn: day("2026-09-01"),
    });

    expect(await refusal(markRfiSent("rfi_1"))).toBe("This RFI has already been sent");
    // And the original send date survives, which is the evidence the log
    // exists to hold.
    expect(rfis()[0].sentOn).toEqual(day("2026-09-01"));
  });

  it("still sends a draft", async () => {
    db.seed("rfi", { id: "rfi_1", companyId: "co_1", jobId: "job_1", status: "DRAFT", sentOn: null });
    expect(await markRfiSent("rfi_1")).toEqual({ ok: true });
    expect(rfis()[0].status).toBe("SENT");
  });
});

describe("answerRfi returns its refusals", () => {
  it("says it was not found", async () => {
    expect(await refusal(answerRfi("nope", form({ answer: "Use A5.1/3." })))).toBe("RFI not found");
  });

  it("says to send the RFI before recording an answer", async () => {
    db.seed("rfi", { id: "rfi_1", companyId: "co_1", jobId: "job_1", status: "DRAFT", sentOn: null });

    expect(await refusal(answerRfi("rfi_1", form({ answer: "Use A5.1/3." })))).toBe(
      "Send this RFI before recording an answer",
    );
    expect(rfis()[0].status).toBe("DRAFT");
  });

  it("refuses an answer dated before the RFI was sent", async () => {
    db.seed("rfi", {
      id: "rfi_1",
      companyId: "co_1",
      jobId: "job_1",
      status: "SENT",
      sentOn: day("2026-09-05"),
      answeredOn: null,
    });

    expect(
      await refusal(answerRfi("rfi_1", form({ answer: "Use A5.1/3.", answeredOn: "2026-09-01" }))),
    ).toBe("The answer can't have come back before the RFI was sent");
    expect(rfis()[0].status).toBe("SENT");
    expect(rfis()[0].answer).toBeUndefined();
  });

  it("says the answer itself is required", async () => {
    db.seed("rfi", {
      id: "rfi_1",
      companyId: "co_1",
      jobId: "job_1",
      status: "SENT",
      sentOn: day("2026-09-01"),
      answeredOn: null,
    });

    expect(await refusal(answerRfi("rfi_1", form({ answer: "   ", answeredOn: "2026-09-05" })))).toBe(
      "Answer is required",
    );
    expect(rfis()[0].status).toBe("SENT");
  });

  it("still records a legal answer", async () => {
    db.seed("rfi", {
      id: "rfi_1",
      companyId: "co_1",
      jobId: "job_1",
      status: "SENT",
      sentOn: day("2026-09-01"),
      answeredOn: null,
    });

    expect(await answerRfi("rfi_1", form({ answer: "Use A5.1/3.", answeredOn: "2026-09-05" }))).toEqual(
      { ok: true },
    );
    expect(rfis()[0].status).toBe("ANSWERED");
    expect(rfis()[0].answeredOn).toEqual(day("2026-09-05"));
  });
});

describe("setRfiClosed returns its refusals", () => {
  it("says it was not found", async () => {
    expect(await refusal(setRfiClosed("nope", true))).toBe("RFI not found");
  });

  it("says an unsent RFI can be deleted, not closed", async () => {
    db.seed("rfi", { id: "rfi_1", companyId: "co_1", jobId: "job_1", status: "DRAFT", sentOn: null });

    expect(await refusal(setRfiClosed("rfi_1", true))).toBe(
      "An unsent RFI can be deleted, not closed",
    );
    expect(rfis()[0].status).toBe("DRAFT");
  });

  it("still closes an answered RFI", async () => {
    db.seed("rfi", {
      id: "rfi_1",
      companyId: "co_1",
      jobId: "job_1",
      status: "ANSWERED",
      sentOn: day("2026-09-01"),
      answeredOn: day("2026-09-05"),
    });

    expect(await setRfiClosed("rfi_1", true)).toEqual({ ok: true });
    expect(rfis()[0].status).toBe("CLOSED");
  });
});

describe("deleteRfi returns its refusals", () => {
  beforeEach(() => {
    db.seed("rfi", { id: "rfi_1", companyId: "co_1", jobId: "job_1", status: "DRAFT", sentOn: null });
  });

  it("returns the owner-only refusal rather than throwing it", async () => {
    context.role = "MEMBER";
    // FIELD holds MANAGE_JOBS, so the capability check passes and only the
    // owner check can refuse — the one `assertOwner` used to throw.
    context.jobFunction = "FIELD";
    expect(await refusal(deleteRfi("rfi_1"))).toBe("Only the account owner can delete an RFI draft");
    expect(rfis()).toHaveLength(1);
  });

  it("says it was not found", async () => {
    expect(await refusal(deleteRfi("nope"))).toBe("RFI not found");
  });

  it("refuses to delete a sent RFI and points at closing it instead", async () => {
    db.seed("rfi", {
      id: "rfi_2",
      companyId: "co_1",
      jobId: "job_1",
      status: "SENT",
      sentOn: day("2026-09-01"),
    });

    expect(await refusal(deleteRfi("rfi_2"))).toBe(
      "Only an unsent draft can be deleted. Close this RFI instead.",
    );
    expect(rfis().map((row) => row.id).sort()).toEqual(["rfi_1", "rfi_2"]);
  });

  it("still deletes an unsent draft for an owner", async () => {
    expect(await deleteRfi("rfi_1")).toEqual({ ok: true });
    expect(rfis()).toHaveLength(0);
  });
});
