import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The phone's incident POST and a near miss.
 *
 * The web action took NEAR_MISS with no case number; this route's outcome
 * list stopped at FIRST_AID_ONLY, so the phone's near miss came back 400
 * "outcome must be a valid value" — and had it got through, the route bumped
 * the OSHA case counter unconditionally, which the DB's CHECK constraint
 * (caseNumber IS NULL exactly when NEAR_MISS) would then refuse.
 */

const context = { company: { id: "co_1" }, companyId: "co_1", id: "user_1", role: "OWNER", jobFunction: null };

vi.mock("@/lib/auth", () => ({
  requireApiContext: async () => context,
  requireCompanyContext: async () => context,
}));

const upsert = vi.fn(async () => ({ lastCaseNumber: 7 }));
const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
  id: "inc_1",
  createdAt: new Date(),
  ...data,
}));

vi.mock("@prova/db", () => {
  const tx = {
    safetyIncident: { findFirst: async () => null, create },
    safetyCaseCounter: { upsert },
  };
  return {
    prisma: {
      job: { findUnique: async () => ({ id: "job_1", companyId: "co_1" }) },
      safetyIncident: { findUnique: async () => null },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

const { POST } = await import("./route");

function post(outcome: string) {
  const request = new NextRequest("http://test/api/v1/jobs/job_1/incidents", {
    method: "POST",
    body: JSON.stringify({
      employeeName: "Marco Silva",
      description: "Board slid off the cart, missed him.",
      occurredAt: "2026-10-01",
      classification: "INJURY",
      outcome,
    }),
    headers: { "content-type": "application/json" },
  });
  return POST(request, { params: Promise.resolve({ id: "job_1" }) });
}

beforeEach(() => {
  upsert.mockClear();
  create.mockClear();
});

describe("a near miss filed from the phone", () => {
  it("is accepted and takes no case number", async () => {
    const response = await post("NEAR_MISS");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ outcome: "NEAR_MISS", caseNumber: null });
    expect(upsert, "a near miss burned an OSHA case number").not.toHaveBeenCalled();
  });

  it("a real case still gets its number (control)", async () => {
    const response = await post("FIRST_AID_ONLY");
    expect(response.status).toBe(201);
    expect((await response.json()).caseNumber).toBe(7);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
