import { afterEach, describe, expect, it, vi } from "vitest";
import { planProcessMaxBytes, planTooLargeProblem } from "@/lib/document-uploads";

vi.mock("@prova/db", () => ({ prisma: { takeoffPlan: { findFirst: async () => ({ fileUrl: "https://store/plans/job_1/set.pdf", jobId: "job_1" }) } } }));
vi.mock("@/lib/document-uploads", async (actual) => ({ ...(await actual<object>()), documentUrlProblem: () => null }));
const { readPlanBytes } = await import("./planBytes");

const MB = 1024 * 1024;

describe("a plan set too large for the server to read", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is 350 MB by default (Diego, 2026-11-07), lowered by NEXT_PUBLIC_PLAN_PROCESS_MAX_MB but never past the 350 MB upload ceiling", () => {
    expect(planProcessMaxBytes(undefined)).toBe(350 * MB);
    expect(planProcessMaxBytes("100")).toBe(100 * MB);
    // The knob cannot raise it past what the upload accepts.
    expect(planProcessMaxBytes("1024")).toBe(350 * MB);
    expect(planProcessMaxBytes("351")).toBe(350 * MB);
    expect(planProcessMaxBytes("nonsense")).toBe(350 * MB);
    // ELEVEN03 (342 MB) is read now; exactly 350 MB is accepted; 351 MB is refused with the sentence.
    expect(planTooLargeProblem(342 * MB)).toBeNull();
    expect(planTooLargeProblem(350 * MB)).toBeNull();
    expect(planTooLargeProblem(351 * MB)).toBe(
      "This set is too large to process on the current plan; split it or contact support. (It is 351.0 MB; the current limit is 350.0 MB.)",
    );
  });

  it("IS REFUSED FROM THE SIZE HEADER, BEFORE THE BODY IS DOWNLOADED, with the sentence that says what to do", async () => {
    let bodyRead = false;
    const body = new ReadableStream({ pull: () => { bodyRead = true; } }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", async () => new Response(body, { headers: { "content-length": String(351 * MB) } }));
    const read = await readPlanBytes("plan_1", "co_1");
    expect(read).toEqual({ ok: false, error: expect.stringContaining("too large to process on the current plan; split it or contact support") });
    expect(bodyRead).toBe(false);
  });

  it("a set under the limit is read as before", async () => {
    vi.stubGlobal("fetch", async () => new Response("%PDF-1.7", { headers: { "content-length": "8" } }));
    const read = await readPlanBytes("plan_1", "co_1");
    expect(read.ok && read.bytes.toString()).toBe("%PDF-1.7");
  });
});
