import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ company: { findMany: vi.fn() } }));
const runAgent = vi.hoisted(() => vi.fn());

vi.mock("@prova/db", () => ({ prisma: db }));
vi.mock("@/lib/agents/all", () => ({}));
vi.mock("@/lib/agents/run", () => ({ runAgent }));

import { GET } from "./route";

const req = (auth?: string, query = "") =>
  new Request(`https://app.example/api/agents/run${query}`, auth ? { headers: { authorization: auth } } : undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.spyOn(console, "log").mockImplementation(() => {});
  db.company.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }]);
  runAgent
    .mockResolvedValueOnce({ ran: true, runId: "r1", summary: "s" })
    .mockResolvedValueOnce({ ran: false, runId: "r2", status: "PAUSED_CAP", note: "Paused" })
    .mockResolvedValueOnce({ ran: false, runId: "r3", status: "SKIPPED", note: "off" })
    .mockResolvedValueOnce({ ran: true, runId: "r4", summary: "s" });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/agents/run", () => {
  it("fails closed with 503 when CRON_SECRET is unset, reading nothing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(503);
    expect(db.company.findMany).not.toHaveBeenCalled();
  });

  it("401s a wrong or missing secret, reading nothing", async () => {
    expect((await GET(req("Bearer nope!"))).status).toBe(401);
    expect((await GET(req())).status).toBe(401);
    expect(db.company.findMany).not.toHaveBeenCalled();
  });

  it("runs the watcher for every company with it on or unset, and counts outcomes", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      agent: "BID_WATCHER",
      companies: 4,
      ran: 2,
      paused: 1,
      skipped: 1,
      failed: 0,
      notAttempted: 0,
    });
    expect(db.company.findMany.mock.calls[0]![0].where).toEqual({
      OR: [{ agentSettings: null }, { agentSettings: { watcherEnabled: true } }],
    });
    expect(runAgent).toHaveBeenCalledWith({ companyId: "c1", agent: "BID_WATCHER", trigger: "cron" });
  });

  it("runs RECOMMENDATIONS on ?agent=, and refuses agents that are never scheduled", async () => {
    const res = await GET(req("Bearer s3cret", "?agent=RECOMMENDATIONS"));
    expect(res.status).toBe(200);
    expect(runAgent.mock.calls[0]![0]).toMatchObject({ agent: "RECOMMENDATIONS" });
    expect(db.company.findMany.mock.calls[0]![0].where.OR[1]).toEqual({ agentSettings: { recommendationsEnabled: true } });

    runAgent.mockClear();
    for (const agent of ["BID_RESEARCH", "ESTIMATE_CHECK", "toString"]) {
      expect((await GET(req("Bearer s3cret", `?agent=${agent}`))).status).toBe(400);
    }
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("is a 500 when any company failed, and keeps going past it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runAgent.mockReset();
    runAgent.mockRejectedValueOnce(new Error("db down")).mockResolvedValue({ ran: true, runId: "r", summary: "s" });
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, failed: 1, ran: 3 });
  });
});
