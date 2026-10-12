import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fold: the digest's invocation also runs the bid watcher, on the time
 * the digest left, and the watcher's outcome counts toward the status. See
 * lib/agents/cron.ts for why the watcher has no cron entry of its own.
 */
const runDigests = vi.hoisted(() => vi.fn());
const runScheduledAgent = vi.hoisted(() => vi.fn());
const loadDigestRecipients = vi.hoisted(() => vi.fn());

vi.mock("@/lib/notification-run", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/notification-run")>()),
  runDigests,
}));
vi.mock("@/lib/notification-run-query", () => ({ loadDigestRecipients }));
vi.mock("@/lib/notification-dispatch", () => ({ dispatchAlertDigest: vi.fn() }));
vi.mock("@/lib/notification-push", () => ({ dispatchAlertPush: vi.fn() }));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-10-12" }));
vi.mock("@/lib/agents/cron", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/agents/cron")>()),
  runScheduledAgent,
}));
vi.mock("@/lib/agents/all", () => ({}));
vi.mock("@/lib/agents/run", () => ({ runAgent: vi.fn() }));
vi.mock("@prova/db", () => ({ prisma: {} }));

import { DIGEST_INVOCATION_BUDGET_MS } from "@/lib/agents/cron";
import { GET } from "./route";

const cleanReport = {
  considered: 1,
  sent: 1,
  nothingDue: 0,
  alreadyClaimed: 0,
  failed: 0,
  notAttempted: 0,
  stopped: null,
  push: { sent: 0, skipped: 0, nothingDue: 1, failed: 0, unconfigured: 0 },
};
const cleanAgents = { companies: 2, ran: 2, paused: 0, skipped: 0, failed: 0, notAttempted: 0 };
const req = () => new Request("https://app.example/api/notifications/digest", { headers: { authorization: "Bearer s3cret" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("NOTIFY_BASE_URL", "https://app.example");
  vi.spyOn(console, "log").mockImplementation(() => {});
  loadDigestRecipients.mockResolvedValue([]);
  runDigests.mockResolvedValue(cleanReport);
  runScheduledAgent.mockResolvedValue(cleanAgents);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/notifications/digest runs the watcher too", () => {
  it("after the digest, with the time the digest left, and reports its counts", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(runDigests).toHaveBeenCalledTimes(1);
    expect(runScheduledAgent).toHaveBeenCalledTimes(1);
    const call = runScheduledAgent.mock.calls[0]![0] as { agent: string; budgetMs: number };
    expect(call.agent).toBe("BID_WATCHER");
    expect(call.budgetMs).toBeGreaterThan(0);
    expect(call.budgetMs).toBeLessThanOrEqual(DIGEST_INVOCATION_BUDGET_MS);
    expect(runScheduledAgent.mock.invocationCallOrder[0]!).toBeGreaterThan(runDigests.mock.invocationCallOrder[0]!);
    expect(await res.json()).toMatchObject({ ok: true, agents: cleanAgents });
  });

  it("is a 500 when the watcher failed a company or ran out of time, with a clean digest", async () => {
    runScheduledAgent.mockResolvedValue({ ...cleanAgents, ran: 1, notAttempted: 1 });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, sent: 1, agents: { notAttempted: 1 } });
  });

  it("never reaches the watcher when the secret is wrong or unset", async () => {
    expect((await GET(new Request("https://app.example/api/notifications/digest"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req())).status).toBe(503);
    expect(runScheduledAgent).not.toHaveBeenCalled();
    expect(runDigests).not.toHaveBeenCalled();
  });
});
